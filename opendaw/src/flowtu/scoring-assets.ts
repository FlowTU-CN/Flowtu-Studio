import {AudioRegionBoxAdapter, AudioUnitBoxAdapter, MetaData, NoteRegionBoxAdapter, TrackBoxAdapter, TrackType, InstrumentFactories} from '@opendaw/studio-adapters'
import {AudioFileBox} from '@opendaw/studio-boxes'
import {AudioContentFactory, type Project} from '@opendaw/studio-core'
import {Progress, UUID} from '@opendaw/lib-std'
import {WavFile} from '@opendaw/lib-dsp'
import type {StudioService} from '../service/StudioService'
import {deleteScoringRegion, generationReferenceOrigin, readScoring, takeMembers, takeRegion, writeScoring} from './scoring-model'
import {mediaSourceOrigin} from './media-retention'
import {renderAsset} from './take-audition'
import {assetLaneOrigin, copyAssetTo, displayTrack, isAssetLane} from './playback-lanes'
import {settleAudioOverlap} from './crossfades'

export {copyAssetTo} from './playback-lanes'
export {retainDeletedTrackMedia} from './media-retention'

/** Remove this project entry. Other placements and other projects may share its source file. */
export function deleteProjectAsset(project:Project,id:string) {
    const region=takeRegion(project,id)
    if (!region) return false
    const lane=region.trackBoxAdapter.unwrapOrUndefined()
    // Studio media is project-scoped. Undo and other projects may still need the cached PCM.
    if (region instanceof AudioRegionBoxAdapter) region.box.file.targetAddress.ifSome(file=>project.keepSampleInStorage(file.uuid))
    project.editing.modify(()=>{
        deleteScoringRegion(project,region,false)
        if (lane && isAssetLane(lane) && lane.box.regions.pointerHub.incoming().length===0 && lane.box.clips.pointerHub.incoming().length===0) lane.box.delete()
    },true)
    return true
}

/** A take may contain several independently edited pieces. Keep their spacing in one undo step. */
export function placeAssetParts(project: Project, ids: readonly string[], target: TrackBoxAdapter, start: number): boolean {
    if (!ids.length || !Number.isFinite(start) || !target.box.isAttached() || isAssetLane(target)) return false
    const track = displayTrack(target)
    if (project.audioUnitFreeze.isFrozen(project.boxAdapters.adapterFor(track.audioUnit, AudioUnitBoxAdapter))) return false
    const parts: (AudioRegionBoxAdapter | NoteRegionBoxAdapter)[] = []
    for (const id of new Set(ids)) {
        const region = takeRegion(project,id)
        if (!region || region.trackBoxAdapter.unwrapOrNull()?.type !== track.type) return false
        parts.push(region)
    }
    const first = Math.min(...parts.map(region=>region.position))
    project.editing.modify(()=>{
        const copies = parts.map(region=>{
            const position = Math.max(0,Math.round(start)) + region.position - first
            let destination = track
            if (track.type === TrackType.Notes && track.regions.collection.asArray().some(r=>r.position < position + region.duration && r.complete > position)) {
                destination = project.boxAdapters.adapterFor(project.api.createNoteTrack(track.audioUnit),TrackBoxAdapter)
            }
            const copy = copyAssetTo(region,destination,position)
            const sourceKey = MetaData.read(region.box,mediaSourceOrigin)
            MetaData.store(copy.box,typeof sourceKey === 'string' ? sourceKey : UUID.toString(region.uuid),mediaSourceOrigin)
            copy.box.mute.setValue(false)
            if (copy instanceof AudioRegionBoxAdapter) settleAudioOverlap(project,copy,track)
            return copy
        })
        project.regionSelection.deselectAll()
        project.regionSelection.select(...copies)
        project.timelineFocus.focusTrack(track)
    },true)
    return true
}

export type ProjectAsset = {id:string; name:string; kind:'Audio'|'MIDI'; seconds:number; cue?:string; stored:boolean; sourceName?:string}
export function projectAssets(project:Project): ProjectAsset[] {
    const owners = new Map(readScoring(project).cues.flatMap(cue => (cue.takes ?? []).flatMap(id => takeMembers(cue,id).map(part => [part,cue.name ?? ''] as const))))
    return project.rootBoxAdapter.audioUnits.adapters().flatMap(unit => unit.tracks.values().flatMap(track => {
        if (track.type !== TrackType.Audio && track.type !== TrackType.Notes) return []
        const stored = isAssetLane(track)
        return track.regions.collection.asArray().flatMap(r => {
            if (!(r instanceof AudioRegionBoxAdapter || r instanceof NoteRegionBoxAdapter)) return []
            const id = UUID.toString(r.uuid)
            const ref = MetaData.read(r.box,generationReferenceOrigin)
            const sourceName = ref && typeof ref === 'object' && !Array.isArray(ref) && typeof ref.name === 'string' ? ref.name : undefined
            return [{id, name:r.label, kind:r instanceof AudioRegionBoxAdapter ? 'Audio' as const : 'MIDI' as const,
                seconds:project.tempoMap.ppqnToSeconds(r.complete)-project.tempoMap.ppqnToSeconds(r.position), cue:owners.get(id), stored,sourceName}]
        })
    }))
}

export function renameAsset(project: Project, id: string, name: string) {
    const region = takeRegion(project,id)
    if (!region) throw new Error('This asset is no longer in the project.')
    const title = name.trim()
    if (!title || title.length > 128) throw new Error('Use a name between 1 and 128 characters.')
    project.editing.modify(() => region.box.label.setValue(title))
}

// Call inside the edit that creates the asset. Keep alternate versions in the project graph without playing them.
export function reserveAssetLane(project: Project, source:TrackBoxAdapter, start:number, end:number) {
    const unit = project.boxAdapters.adapterFor(source.audioUnit,AudioUnitBoxAdapter)
    const available = unit.tracks.values().find(t=>t.type===source.type && isAssetLane(t) && t.regions.collection.asArray().every(r=>r.complete<=start || r.position>=end))
    if (available) return available
    const track = source.type === TrackType.Audio ? project.api.createAudioTrack(unit.box) : project.api.createNoteTrack(unit.box)
    track.enabled.setValue(false)
    MetaData.store(track,true,assetLaneOrigin)
    return project.boxAdapters.adapterFor(track,TrackBoxAdapter)
}

export async function bounceAsset(service:StudioService, id:string, signal:AbortSignal) {
    const project = service.project, region = takeRegion(project,id)
    if (!(region instanceof NoteRegionBoxAdapter)) throw new Error('Choose a MIDI performance to render.')
    const title = region.label + ' · Audio', start = region.position
    const audio = await renderAsset(project,id,service.audioContext.sampleRate,signal)
    signal.throwIfAborted()
    const sample = await service.sampleService.importFile({name:title,bpm:0,arrayBuffer:WavFile.encodeFloats(audio),progressHandler:Progress.Empty})
    await service.sampleManager.getAudioData(UUID.parse(sample.uuid))
    signal.throwIfAborted()
    if (!service.hasProfile || service.project!==project || !takeRegion(project,id)) throw new Error('The source asset or project changed during rendering.')
    return project.editing.modify(() => {
        const uuid = UUID.parse(sample.uuid)
        const file = project.boxGraph.findBox<AudioFileBox>(uuid).unwrapOrElse(()=>AudioFileBox.create(project.boxGraph,uuid,box=>{
            box.fileName.setValue(title); box.endInSeconds.setValue(sample.duration)
        }))
        project.trackUserCreatedSample(uuid)
        const firstAudio = project.rootBoxAdapter.audioUnits.adapters().flatMap(u=>u.tracks.values()).find(t=>t.type===TrackType.Audio)
        const owner = firstAudio ?? project.boxAdapters.adapterFor(project.api.createInstrument(InstrumentFactories.Tape).trackBox,TrackBoxAdapter)
        const end = project.tempoMap.secondsToPPQN(project.tempoMap.ppqnToSeconds(start)+sample.duration)
        const lane = reserveAssetLane(project,owner,start,end)
        const printed = AudioContentFactory.createNotStretchedRegion({boxGraph:project.boxGraph,targetTrack:lane.box,audioFileBox:file,sample,position:start,name:title})
        const output = UUID.toString(printed.address.uuid)
        const state = readScoring(project), cue = state.cues.find(c=>c.takes?.includes(id))
        if (cue) {cue.takes = [...cue.takes!,output]; writeScoring(project,state)}
        return output
    }).unwrap()
}
