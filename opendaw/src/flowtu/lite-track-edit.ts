import {IndexedBox} from '@opendaw/lib-box'
import {mod, UUID} from '@opendaw/lib-std'
import {AudioRegionBoxAdapter, AudioUnitBoxAdapter, NoteRegionBoxAdapter, TrackBoxAdapter, TrackType} from '@opendaw/studio-adapters'
import type {Project} from '@opendaw/studio-core'
import {settleAudioOverlap} from './crossfades'
import {assertAudioEditorRegion} from './editor-audio-actions'
import {copyAssetTo, displayTrack, isAssetLane, playbackLanes} from './playback-lanes'
import {takeRegion} from './scoring-model'

export function liteTracks(project: Project) {
    return project.rootBoxAdapter.audioUnits.adapters().flatMap(unit => {
        const visible = unit.tracks.values().filter(track =>
            (track.type === TrackType.Audio || track.type === TrackType.Notes) && !isAssetLane(track) && displayTrack(track) === track)
        return visible.map((track,index) => ({
            id: UUID.toString(track.uuid), track, unit, label: visible.length > 1 ? `${unit.label} · ${index+1}` : unit.label,
            clips: playbackLanes(track).flatMap(lane => lane.regions.collection.asArray().flatMap(region =>
                region instanceof AudioRegionBoxAdapter || region instanceof NoteRegionBoxAdapter
                    ? [{id:UUID.toString(region.uuid), region, start:project.tempoMap.ppqnToSeconds(region.position), end:project.tempoMap.ppqnToSeconds(region.complete)}]
                    : [])).sort((a,b) => a.start-b.start)
        }))
    })
}

type Region=AudioRegionBoxAdapter|NoteRegionBoxAdapter
export type TrimEdge='trim-start'|'trim-end'

export function liteTrimBoundary(region:Region,edge:TrimEdge,pulse:number) {
    const end=Math.round(region.complete)
    const left=edge==='trim-start'
    let min=left ? 0 : region.position+1
    let max=left ? end-1 : 0x7fffffff
    // A standard recording can reveal its previously trimmed source. Existing looped clips keep the native loop behavior.
    if(region instanceof AudioRegionBoxAdapter && region.loopOffset+region.duration<=region.loopDuration+.5) {
        if(left) min=Math.max(min,region.position-region.loopOffset)
        else max=Math.min(max,region.position+region.loopDuration-region.loopOffset)
    }
    return Math.round(Math.min(max,Math.max(min,pulse)))
}

export function trimLiteClip(project:Project,region:Region,edge:TrimEdge,pulse:number) {
    const track=region.trackBoxAdapter.unwrap()
    if(region instanceof AudioRegionBoxAdapter) assertAudioEditorRegion(project,region)
    else if(project.audioUnitFreeze.isFrozen(project.boxAdapters.adapterFor(track.audioUnit,AudioUnitBoxAdapter))) throw new Error('Unfreeze this track first.')
    const start=region.position, end=region.complete, offset=region.loopOffset
    const next=liteTrimBoundary(region,edge,pulse)
    if(!Number.isFinite(next)) throw new Error('Choose a valid clip boundary.')
    if(next===Math.round(edge==='trim-start'?start:end))return
    project.editing.modify(()=>{
        if(edge==='trim-start') {
            const newOffset=mod(offset+next-start,region.resolveLoopDuration(next))
            region.position=next
            region.duration=end-next
            region.loopOffset=newOffset
        } else region.duration=next-start
        if(region instanceof AudioRegionBoxAdapter) settleAudioOverlap(project,region,track)
    },true)
}

export function transferLiteClip(project: Project, id: string, target: TrackBoxAdapter, start: number, copy: boolean) {
    const region = takeRegion(project,id), source = region?.trackBoxAdapter.unwrapOrNull()
    if (!region || !source || !target.box.isAttached() || target.type !== source.type || isAssetLane(target)) throw new Error('Choose a track of the same type.')
    if ([target,source].some(track => project.audioUnitFreeze.isFrozen(project.boxAdapters.adapterFor(track.audioUnit,AudioUnitBoxAdapter)))) throw new Error('Unfreeze this track first.')
    if (!Number.isFinite(start)) throw new Error('Invalid clip position.')
    start = Math.max(0,Math.round(start))
    if (!copy && displayTrack(source) === target && start === region.position) return id
    return project.editing.modify(() => {
        const end = region instanceof AudioRegionBoxAdapter ? region.resolveComplete(start) : start+region.duration
        let lane = target
        if (target.type===TrackType.Notes && target.regions.collection.asArray().some(other => (copy || other !== region) && other.complete > start && other.position < end)) {
            const box = project.api.createNoteTrack(target.audioUnit)
            lane = project.boxAdapters.adapterFor(box,TrackBoxAdapter)
        }
        const placed = copy ? copyAssetTo(region,lane,start) : region
        if (copy) placed.box.mute.setValue(region.mute)
        else {region.box.regions.refer(lane.box.regions); region.position = start}
        if (placed instanceof AudioRegionBoxAdapter) settleAudioOverlap(project,placed,target)
        project.regionSelection.deselectAll(); project.regionSelection.select(placed); project.timelineFocus.focusRegion(placed)
        return UUID.toString(placed.uuid)
    },true).unwrap()
}

export function reorderLiteTrack(project: Project, from: TrackBoxAdapter, to: TrackBoxAdapter, after: boolean) {
    if (from === to) return
    if (from.audioUnit === to.audioUnit) {
        const lanes = liteTracks(project).filter(row => row.unit.box === from.audioUnit).map(row => row.track)
        const slots = lanes.map(lane => lane.indexField.getValue())
        const order = lanes.filter(lane => lane !== from)
        order.splice(order.indexOf(to)+(after ? 1 : 0),0,from)
        project.editing.modify(() => order.forEach((lane,index) => lane.indexField.setValue(slots[index])),true)
        return
    }
    const unit = project.boxAdapters.adapterFor(from.audioUnit,AudioUnitBoxAdapter), index = unit.indexField.getValue()
    const [min,max] = unit.indicesLimit()
    const slot = Math.max(min,Math.min(max,to.audioUnit.index.getValue()+(after ? 1 : 0)))
    if (slot-index < 0 || slot-index > 1) project.editing.modify(() => IndexedBox.moveIndex(project.rootBox.audioUnits,index,slot-index),true)
}
