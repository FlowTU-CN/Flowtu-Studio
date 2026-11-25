import {deleteScoringRegion} from "./scoring-model"
import {cutWithCrossfade} from "./crossfades"
import {AudioRegionBoxAdapter,AudioUnitBoxAdapter,type TrackBoxAdapter} from '@opendaw/studio-adapters'
import type {Project} from '@opendaw/studio-core'
import {endTick,intersectsAudioRange,type AudioTimeRange} from './audio-range'

/** One native undo transaction, source files untouched. Adjacent clips and gaps retain their timing. */
export function editTrackAudioRange(project:Project,track:TrackBoxAdapter,range:AudioTimeRange,action:'split'|'delete', editorRegion?:AudioRegionBoxAdapter):AudioRegionBoxAdapter[] {
    return editAudioRanges(project,[track],range,action,editorRegion)
}

export function editAudioRanges(project:Project, tracks:readonly TrackBoxAdapter[], range:AudioTimeRange, action:'split'|'delete', editorRegion?:AudioRegionBoxAdapter):AudioRegionBoxAdapter[] {
    if(!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||range.end<=range.start)throw new Error('Drag a time range inside an audio lane first.')
    const regions=tracks.flatMap(track=>{
        if(!track.box.isAttached()) throw new Error('This track is no longer available.')
        const candidates = editorRegion ? [editorRegion] : track.regions.collection.asArray()
        const matches=candidates.filter((r):r is AudioRegionBoxAdapter=>r instanceof AudioRegionBoxAdapter && r.box.isAttached() && r.trackBoxAdapter.contains(track) && intersectsAudioRange(r.position,r.complete,range))
        if(matches.length && track.optAudioUnit.mapOr(unit=>project.audioUnitFreeze.isFrozen(project.boxAdapters.adapterFor(unit,AudioUnitBoxAdapter)),false)) throw new Error('Unfreeze this track first.')
        return matches
    })
    if(!regions.length)throw new Error('The selected time range contains no audio.')
    return project.editing.modify(()=>{
        const fragments:AudioRegionBoxAdapter[]=[]
        for(const region of regions){
            const wholeClip = range.start <= region.position && range.end >= endTick(region.position,region.complete)
            // Cut the right edge first so the original remains the left/middle fragment.
            if(range.end<endTick(region.position,region.complete))cutWithCrossfade(project, region,range.end,true)
            const middle=range.start>region.position?cutWithCrossfade(project, region,range.start,true).unwrap('Unable to split the range start'):region
            if(action==='delete')deleteScoringRegion(project,middle,wholeClip)
            else fragments.push(middle)
        }
        project.regionSelection.deselectAll()
        if (fragments.length) {
            project.regionSelection.select(...fragments)
            if (fragments.length === 1) project.timelineFocus.focusRegion(fragments[0])
            if (editorRegion) project.userEditingManager.timeline.edit(fragments[0].box)
        }
        return fragments
    },true).unwrap('No range edit was applied')
}
