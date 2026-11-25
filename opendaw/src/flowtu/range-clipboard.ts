import {BoxGraph, type Box} from '@opendaw/lib-box'
import {TimeBase} from '@opendaw/lib-dsp'
import {ByteArrayInput, ByteArrayOutput, mod, Option, UUID} from '@opendaw/lib-std'
import {AudioRegionBoxAdapter, AudioUnitBoxAdapter, NoteRegionBoxAdapter, TrackType, type TrackBoxAdapter} from '@opendaw/studio-adapters'
import {AudioRegionBox, NoteRegionBox, BoxIO} from '@opendaw/studio-boxes'
import {ClipboardUtils, type ClipboardEntry, type Project} from '@opendaw/studio-core'

import {intersectsAudioRange} from './audio-range'

export type AudioClipboardRange = {readonly track: TrackBoxAdapter; readonly start: number; readonly end: number}

/** Crop a detached graph, never the live project or its undo history. */
export function copyAudioRange(project: Project, range: AudioClipboardRange): ClipboardEntry<'regions'> {
    if (range.track.type !== TrackType.Audio) throw new Error('Select a range on an audio track.')
    return copyTrackRange(project,range)
}

export function copyTrackRange(project: Project, range: AudioClipboardRange): ClipboardEntry<'regions'> {
    return copyTrackRanges(project,range,[range.track],[range.track])
}

export function copyTrackRanges(project:Project, range:AudioClipboardRange, tracks:readonly TrackBoxAdapter[], order:readonly TrackBoxAdapter[]):ClipboardEntry<'regions'> {
    const {track,start,end} = range
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
        throw new Error('Select a valid time range first.')
    }
    const regions = tracks.flatMap(row=>row.regions.collection.asArray()).filter((region): region is AudioRegionBoxAdapter | NoteRegionBoxAdapter =>
        (region instanceof AudioRegionBoxAdapter || region instanceof NoteRegionBoxAdapter) && intersectsAudioRange(region.position, region.complete, range))
    if (regions.length === 0) throw new Error(track.type === TrackType.Audio ? 'The selected range contains no audio.' : 'The selected range contains no MIDI clips.')

    // Match openDAW's region clipboard dependency rules. Resource UUIDs are kept so
    // pasting into the same project reuses audio files instead of duplicating them.
    const sourceBoxes = new Map<string, Box>()
    for (const region of regions) {
        sourceBoxes.set(UUID.toString(region.uuid), region.box)
        for (const box of project.boxGraph.dependenciesOf(region.box, {
            alwaysFollowMandatory: true, stopAtResources: true, excludeBox: box => box.ephemeral
        }).boxes) sourceBoxes.set(UUID.toString(box.address.uuid), box)
    }
    const detached: BoxGraph = new BoxGraph(Option.wrap(BoxIO.create))
    detached.beginTransaction()
    try {
        for (const box of sourceBoxes.values()) {
            const input = new ByteArrayInput(box.toArrayBuffer())
            detached.createBox(box.name, box.address.uuid, clone => clone.read(input))
        }
        for (const region of regions) {
            const clone = detached.findBox<AudioRegionBox | NoteRegionBox>(region.uuid).unwrap()
            const begin = Math.max(start, region.position)
            const complete = Math.min(end, region.complete)
            const duration = complete - begin
            clone.position.setValue(begin)
            clone.duration.setValue(region instanceof AudioRegionBoxAdapter && region.timeBase === TimeBase.Seconds
                ? project.tempoMap.intervalToSeconds(begin, complete) : duration)
            clone.loopOffset.setValue(mod(region.loopOffset + begin - region.position, region.loopDuration))
            // Follow the native region trim rule for fades on shortened clips.
            if (!(region instanceof AudioRegionBoxAdapter) || !(clone instanceof AudioRegionBox)) continue
            const totalFading = region.fading.in + region.fading.out
            if (totalFading > duration) {
                clone.fading.in.setValue(region.fading.in * duration / totalFading)
                clone.fading.out.setValue(region.fading.out * duration / totalFading)
            }
        }
        detached.endTransaction()
    } catch (error) {
        if (detached.inTransaction()) detached.abortTransaction()
        throw error
    }

    // Native RegionsClipboard metadata. The selection bounds (not clip bounds)
    // retain leading/trailing silence and gaps between clips when pasted.
    const metadata = ByteArrayOutput.create()
    metadata.writeFloat(start)
    metadata.writeFloat(end)
    const owners = new Set(regions.map(region=>region.trackBoxAdapter.unwrap()))
    const anchorIndex = order.indexOf(track)
    if (anchorIndex<0 || [...owners].some(row=>!order.includes(row))) throw new Error('The track order changed. Select the range again.')
    metadata.writeInt(owners.size)
    for (const owner of owners) {
        metadata.writeBytes(new Int8Array(owner.uuid))
        metadata.writeInt(order.indexOf(owner)-anchorIndex)
        metadata.writeInt(owner.type)
    }
    return {type: 'regions', data: ClipboardUtils.serializeBoxes(detached.boxes(), metadata.toArrayBuffer()), count: regions.length}
}

/** The native clipboard resolves every source row relative to the focused destination. Validate
 * secondary targets before the native overlap resolver is allowed to alter existing clips. */
export function checkPasteTracks(project:Project, entry:ClipboardEntry|undefined, order:readonly TrackBoxAdapter[], anchor:TrackBoxAdapter) {
    if (entry?.type !== 'regions' || !order.length) return
    const input = new ByteArrayInput(ClipboardUtils.extractMetadata(entry.data))
    input.readFloat(); input.readFloat()
    const count=input.readInt(), origin=order.indexOf(anchor)
    for(let i=0;i<count;i++) {
        input.readBytes(new Int8Array(16))
        const offset=input.readInt(), type=input.readInt(), target=order[origin+offset]
        if(origin<0 || !target || target.type!==type) throw new Error('The destination track order does not match the copied clips.')
        if(target.optAudioUnit.mapOr(unit=>project.audioUnitFreeze.isFrozen(project.boxAdapters.adapterFor(unit,AudioUnitBoxAdapter)),false)) {
            throw new Error('Unfreeze the destination track first.')
        }
    }
}
