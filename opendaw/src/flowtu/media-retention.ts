import type {Project} from '@opendaw/studio-core'
import {
    AudioClipBoxAdapter, AudioRegionBoxAdapter, InstrumentFactories, MetaData, NoteClipBoxAdapter,
    NoteRegionBoxAdapter, PresetDecoder, PresetEncoder, TrackBoxAdapter, TrackType
} from '@opendaw/studio-adapters'
import {AudioFileBox, AudioRegionBox, AudioUnitBox, NoteRegionBox} from '@opendaw/studio-boxes'
import {UUID} from '@opendaw/lib-std'
import {assetLaneOrigin,copyAssetTo,isAssetLane} from './playback-lanes'
import {presetResourceBoxes, retainedInstrumentOrigin} from './retained-preset-resources'

// The permanent output owns the disabled storage lanes. They survive deletion of any source channel.
function createStorage(project:Project, type:TrackType, preset?:string) {
    const owner = project.skeleton.mandatoryBoxes.primaryAudioUnitBox
    const box = type === TrackType.Notes ? project.api.createNoteTrack(owner) : project.api.createAudioTrack(owner)
    box.enabled.setValue(false)
    MetaData.store(box,true,assetLaneOrigin)
    if (preset) MetaData.store(box,preset,retainedInstrumentOrigin)
    return box
}

function encodePreset(project:Project, unit:AudioUnitBox) {
    const bytes = new Uint8Array(PresetEncoder.encode(unit,{includeTimeline:false}))
    for (const file of presetResourceBoxes(bytes.buffer)) {
        if (file instanceof AudioFileBox) project.keepSampleInStorage(file.address.uuid)
    }
    const chunks:string[] = []
    for (let i=0; i<bytes.length; i+=8192) chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)))
    return btoa(chunks.join(''))
}

// Placements made from Media share a source key, so erasing one need not make a second library item.
export const mediaSourceOrigin = 'flowtu:media-source'
export function retainTimelineClip(project:Project, region:AudioRegionBoxAdapter|NoteRegionBoxAdapter) {
    const lane = region.trackBoxAdapter.unwrapOrUndefined()
    if (!lane || isAssetLane(lane)) return
    const origin = MetaData.read(region.box,mediaSourceOrigin)
    const key = typeof origin === 'string' ? origin : UUID.toString(region.uuid)
    if (typeof origin === 'string' && project.boxGraph.findBox(UUID.parse(origin)).nonEmpty()) return
    const alreadyStored = project.primaryAudioUnitBoxAdapter.tracks.values().some(track =>
        isAssetLane(track) && track.regions.collection.asArray().some(item =>
            MetaData.read(item.box,mediaSourceOrigin) === key))
    if (alreadyStored) return
    const preset = region instanceof NoteRegionBoxAdapter ? encodePreset(project,lane.audioUnit) : undefined
    const storage = createStorage(project,lane.type,preset)
    const target = project.boxAdapters.adapterFor(storage,TrackBoxAdapter)
    const copy = copyAssetTo(region,target,region.position)
    MetaData.store(copy.box,key,mediaSourceOrigin)
}

/** Called within the same undo transaction that removes the tracks. Region IDs and cue references stay valid. */
export function retainDeletedTrackMedia(project:Project, lanes:readonly TrackBoxAdapter[]) {
    const presets = new Map<AudioUnitBox,string>()
    for (const lane of lanes) {
        if (lane.type !== TrackType.Audio && lane.type !== TrackType.Notes) continue
        const regions = [...lane.regions.collection.asArray()]
        const clips = lane.clips.collection.adapters()
        if (!regions.length && !clips.length) continue
        let preset:string|undefined
        if (lane.type === TrackType.Notes) {
            preset = presets.get(lane.audioUnit)
            if (!preset) {
                preset = encodePreset(project,lane.audioUnit)
                presets.set(lane.audioUnit,preset)
            }
        }
        if (regions.length) {
            const target = createStorage(project,lane.type,preset)
            for (const region of regions) region.box.regions.refer(target.regions)
        }
        // Launcher slots do not have a timeline position. Give each its own library entry at zero.
        for (const clip of clips) {
            if (!(clip instanceof AudioClipBoxAdapter || clip instanceof NoteClipBoxAdapter)) continue
            const target = createStorage(project,lane.type,preset)
            if (clip instanceof AudioClipBoxAdapter) {
                AudioRegionBox.create(project.boxGraph,UUID.generate(),box=>{
                    box.regions.refer(target.regions)
                    box.timeBase.setValue(clip.box.timeBase.getValue())
                    box.duration.setValue(clip.box.duration.getValue())
                    box.loopDuration.setValue(clip.box.duration.getValue())
                    box.label.setValue(clip.box.label.getValue())
                    box.hue.setValue(clip.hue)
                    box.mute.setValue(clip.mute)
                    box.gain.setValue(clip.gain.getValue())
                    box.playback.setValue(clip.box.playback.getValue())
                    box.waveformOffset.setValue(clip.box.waveformOffset.getValue())
                    clip.box.file.ifVertex(file=>box.file.refer(file))
                    clip.box.events.ifVertex(events=>box.events.refer(events))
                    clip.box.playMode.ifVertex(mode=>box.playMode.refer(mode))
                })
            } else {
                NoteRegionBox.create(project.boxGraph,UUID.generate(),box=>{
                    box.regions.refer(target.regions)
                    box.duration.setValue(clip.duration)
                    box.loopDuration.setValue(clip.duration)
                    box.label.setValue(clip.label)
                    box.hue.setValue(clip.hue)
                    box.mute.setValue(clip.mute)
                    clip.box.events.ifVertex(events=>box.events.refer(events))
                })
            }
        }
    }
}

/** Recreate a deleted instrument only in the offline audition copy. */
export function prepareStoredAudition(project:Project, regions:readonly (AudioRegionBoxAdapter|NoteRegionBoxAdapter)[]) {
    const targets = new Map<string,TrackBoxAdapter>()
    for (const region of regions) {
        const lane = region.trackBoxAdapter.unwrapOrUndefined()
        if (!lane || lane.audioUnit !== project.skeleton.mandatoryBoxes.primaryAudioUnitBox || MetaData.read(lane.box,assetLaneOrigin)!==true) continue
        const saved = MetaData.read(lane.box,retainedInstrumentOrigin)
        const key = typeof saved === 'string' ? saved : region.type
        let target = targets.get(key)
        if (!target) {
            if (typeof saved === 'string') {
                const bytes = Uint8Array.from(atob(saved),c=>c.charCodeAt(0))
                const [unit] = PresetDecoder.decode(bytes.buffer,project.skeleton)
                if (!unit) throw new Error('Unable to load the stored MIDI instrument.')
                target = project.boxAdapters.adapterFor(project.api.createNoteTrack(unit),TrackBoxAdapter)
            } else {
                const {trackBox} = region instanceof AudioRegionBoxAdapter
                    ? project.api.createInstrument(InstrumentFactories.Tape)
                    : project.api.createInstrument(InstrumentFactories.Vaporisateur)
                target = project.boxAdapters.adapterFor(trackBox,TrackBoxAdapter)
            }
            targets.set(key,target)
        }
        region.box.regions.refer(target.box.regions)
    }
}
