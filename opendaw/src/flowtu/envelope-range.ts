import {LoopableRegion, type Interpolation} from '@opendaw/lib-dsp'
import {AudioUnitBoxAdapter, TrackBoxAdapter, TrackType, ValueRegionBoxAdapter} from '@opendaw/studio-adapters'
import {type Project} from '@opendaw/studio-core'
import {ValueRegionBox} from '@opendaw/studio-boxes'
import {ValueEventEditing} from '../ui/timeline/editors/value/ValueEventEditing'
import {checkRangeTracks, getEnvelopeRange, setTimelineSelection, timelineTrackOrder} from './timeline-selection'
import {getEditingClipboard, setEditingClipboard} from './editing-clipboard'
import {timelinePosition} from './timeline-seek'

const pointFormat = 'flowtu-automation-points'
type Point = {offset:number; index:number; value:number; interpolation:Interpolation}

function* rangePoints(track:TrackBoxAdapter, range:{start:number;end:number}) {
    for (const region of track.regions.collection.iterateRange(range.start,range.end)) {
        if (!(region instanceof ValueRegionBoxAdapter)) continue
        const collection = region.optCollection.unwrapOrUndefined()
        if (!collection) continue
        for (const pass of LoopableRegion.locateLoops(region,range.start,range.end)) {
            for (const node of collection.events.iterateRange(pass.resultStart-pass.rawStart,pass.resultEnd-pass.rawStart)) {
                const position = pass.rawStart + node.position
                if (position >= pass.resultStart && position < pass.resultEnd) yield {region, node, position}
            }
        }
    }
}
function checkEditable(project:Project,track:TrackBoxAdapter) {
    if (track.optAudioUnit.mapOr(unit=>project.audioUnitFreeze.isFrozen(project.boxAdapters.adapterFor(unit,AudioUnitBoxAdapter)),false))
        throw new Error('Unfreeze this track before editing automation.')
}

export class RepeatedAutomationError extends Error {}

// Repeated passes share stored events. Only edit a point in place when every occurrence belongs to the edit.
function checkOccurrences(region:ValueRegionBoxAdapter,at:number,start:number,end:number) {
    const period = region.loopDuration
    if (period <= 0 || period >= region.duration) return
    const first = at - Math.floor((at - region.position) / period) * period
    const last = at + Math.floor((region.complete - 1 - at) / period) * period
    if (first < start || last >= end) {
        throw new RepeatedAutomationError('This automation point repeats outside the selection. Flatten the loop before editing individual passes.')
    }
}

/** Keep clip edits and point edits distinct even for an empty selection inside an automation region. */
export function editEnvelopeRange(project:Project,action:'copy'|'cut'|'delete') {
    const range = getEnvelopeRange(project)
    if (!range) return false
    checkRangeTracks(project,range.tracks)
    const groups=range.tracks.map(track=>({track,hits:Array.from(rangePoints(track,range))}))
    const selected=groups.flatMap(group=>group.hits)
    if (!selected.length) throw new Error('No automation points in this range.')
    if (action !== 'copy') {
        for (const {track,hits} of groups) if (hits.length) checkEditable(project,track)
        for (const {region,position} of selected) checkOccurrences(region,position,range.start,range.end)
    }
    const copy=()=>{
        const visible = timelineTrackOrder(project).filter(t=>t.type===TrackType.Value)
        const anchor = visible.indexOf(range.track)
        const lanes = groups.filter(group=>group.hits.length).map(({track,hits})=>{
            if(range.tracks.length>1 && (anchor<0 || !visible.includes(track))) throw new Error('The track order changed. Select the range again.')
            return {
                offset:range.tracks.length===1 ? 0 : visible.indexOf(track)-anchor,
                target:track.targetName.unwrapOrUndefined(),
                points:hits.map(({node,position}):Point=>({offset:position-range.start,index:node.index,value:node.value,interpolation:node.interpolation}))
            }
        })
        const data=new TextEncoder().encode(JSON.stringify({duration:range.end-range.start,lanes,multi:range.tracks.length>1}))
        return {type:pointFormat,data:data.buffer,count:selected.length}
    }
    const clipboard = action==='delete' ? undefined : copy()
    if (action !== 'copy') {
        // Multiple visible loop passes may refer to one stored event. Delete the outgoing
        // member of each step first to retain the native incoming/outgoing index invariant.
        project.editing.modify(()=>{
            const regions = new Set(selected.map(p=>p.region))
            for (const region of regions) region.consolidate()
            const nodes = [...new Set(groups.flatMap(({track})=>Array.from(rangePoints(track,range),p=>p.node)))].sort((a,b)=>b.index-a.index)
            for (const node of nodes) ValueEventEditing.deleteEvent(node.collection.unwrap(),node)
        },true)
    }
    if (clipboard) setEditingClipboard(clipboard)
    return true
}

export function pasteEnvelopePoints(project:Project,track:TrackBoxAdapter, position = timelinePosition(project)) {
    const entry = getEditingClipboard()
    if (entry?.type !== pointFormat) return false
    if (track.type !== TrackType.Value) throw new Error('Choose an automation lane to paste points.')
    const decoded = JSON.parse(new TextDecoder().decode(entry.data)) as {
        duration:number; points?:Point[]; lanes?:{offset:number; target?:string; points:Point[]}[]; multi?:boolean
    }
    const {duration} = decoded
    const lanes = decoded.lanes ?? [{offset:0,points:decoded.points ?? [],target:undefined}]
    const start = Math.round(position), end = start + duration
    if (!Number.isSafeInteger(duration) || duration < 1 || !Number.isSafeInteger(start) || start<0 || end>0x7fffffff ||
        !Array.isArray(lanes) || !lanes.length || new Set(lanes.map(lane=>lane.offset)).size!==lanes.length) throw new Error('Invalid automation clipboard.')
    const visible=timelineTrackOrder(project).filter(row=>row.type===TrackType.Value)
    const anchor=visible.indexOf(track)
    const plans=lanes.map(lane=>{
        const {points}=lane
        if (!Number.isSafeInteger(lane.offset) || !Array.isArray(points) || !points.length ||
            points.some(p=>!Number.isSafeInteger(p.offset) || p.offset<0 || p.offset>=duration || ![0,1].includes(p.index) ||
                !Number.isFinite(p.value) || p.value<0 || p.value>1 || !p.interpolation ||
                !['none','linear','curve'].includes(p.interpolation.type) ||
                p.interpolation.type==='curve' && !Number.isFinite(p.interpolation.slope))) throw new Error('Invalid automation clipboard.')
        const destination=lane.offset===0 ? track : anchor>=0 ? visible[anchor+lane.offset] : undefined
        if (!destination || decoded.multi && lane.target !== destination.targetName.unwrapOrUndefined()) {
            throw new Error('Choose destination automation lanes in the same parameter order as the copied lanes.')
        }
        checkEditable(project,destination)
        return preparePaste(project,destination,start,end,points)
    })
    project.editing.modify(()=>{for(const plan of plans) plan.apply()},true)
    const destinations = [...new Set([track,...plans.map(plan=>plan.track)])].sort((a,b)=>visible.indexOf(a)-visible.indexOf(b))
    setTimelineSelection(project,{start,end},track,destinations)
    return true
}

function preparePaste(project:Project, track:TrackBoxAdapter, start:number, end:number, points:Point[]) {
    const regions = track.regions.collection.asArray().filter((r):r is ValueRegionBoxAdapter => r instanceof ValueRegionBoxAdapter)
    const regionAt = (at:number) => regions.find(r=>at>=r.position && at<r.complete)
    const destinations = new Set<ValueRegionBoxAdapter>()
    for (const point of points) {
        const at = start + point.offset, region = regionAt(at)
        if (!region) continue
        checkOccurrences(region,at,at,at+1)
        destinations.add(region)
    }
    return {track, apply() {
        for (const region of destinations) region.consolidate()
        for (const point of points) {
            const at = start + point.offset
            let region = regionAt(at)
            if (!region) {
                const stop = Math.min(end,...regions.filter(r=>r.position>at).map(r=>r.position))
                const box = project.api.createTrackRegion(track.box,at,stop-at,{name:track.targetName.unwrapOrUndefined() ?? 'Automation'}).unwrap() as ValueRegionBox
                region = project.boxAdapters.adapterFor(box,ValueRegionBoxAdapter)
                regions.push(region)
            }
            const collection = region.optCollection.unwrap(), position = LoopableRegion.globalToLocal(region,at)
            // The native collection also updates an existing point at the same tick and index.
            collection.createEvent({position,index:point.index,value:point.value,interpolation:point.interpolation})
        }
    }}
}
