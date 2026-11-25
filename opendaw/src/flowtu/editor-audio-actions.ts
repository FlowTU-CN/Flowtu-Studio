import {deleteScoringRegion} from "./scoring-model"
import {cutWithCrossfade, moveIntoCrossfade} from "./crossfades"
import {AudioRegionBoxAdapter,AudioUnitBoxAdapter} from '@opendaw/studio-adapters'
import type {Project} from '@opendaw/studio-core'
import {mod} from '@opendaw/lib-std'
import {fitFade} from './fades'

/** Bottom-editor actions always address its reader, never an unrelated arrangement selection. */
export function assertAudioEditorRegion(project:Project,region:AudioRegionBoxAdapter):void {
    if(!region.box.isAttached())throw new Error('This audio clip is no longer available.')
    if(region.trackBoxAdapter.flatMap(track=>track.optAudioUnit).mapOr(unit=>project.audioUnitFreeze.isFrozen(project.boxAdapters.adapterFor(unit,AudioUnitBoxAdapter)),false))throw new Error('Unfreeze this track first.')
}
export function selectAudioEditorRegion(project:Project,region:AudioRegionBoxAdapter):void {
    assertAudioEditorRegion(project,region)
    project.regionSelection.deselectAll();project.regionSelection.select(region)
    project.timelineFocus.focusRegion(region)
}
export function splitAudioEditorRegion(project:Project,region:AudioRegionBoxAdapter,position:number):AudioRegionBoxAdapter {
    assertAudioEditorRegion(project,region)
    const pulse=Math.round(position)
    if(pulse<=region.position||pulse>=region.complete)throw new Error('Place the cursor inside the audio clip to split it.')
    return project.editing.modify(()=>{
        const right=cutWithCrossfade(project, region,pulse,true).unwrap('Unable to split this clip') as AudioRegionBoxAdapter
        selectAudioEditorRegion(project,right)
        project.userEditingManager.timeline.edit(right.box)
        return right
    },true).unwrap()
}
export function duplicateAudioEditorRegion(project:Project,region:AudioRegionBoxAdapter):AudioRegionBoxAdapter {
    assertAudioEditorRegion(project,region)
    return project.editing.modify(()=>{
        // The explicit-position API resolves overlaps by trimming existing clips. Free-space duplication preserves them.
        const copy=project.api.duplicateRegion(region,{findFreeSpace:true}).unwrap('Unable to duplicate this clip') as AudioRegionBoxAdapter
        selectAudioEditorRegion(project,copy)
        project.userEditingManager.timeline.edit(copy.box)
        return copy
    },true).unwrap()
}
export function changeAudioEditorRegion(project:Project,region:AudioRegionBoxAdapter,action:'move'|'trim-start'|'trim-end'|'fade-in'|'fade-out'|'mute'|'erase',value=0):void {
    assertAudioEditorRegion(project,region)
    if(!Number.isFinite(value))throw new Error('Choose a valid audio position.')
    if(action==='move' && moveIntoCrossfade(project,region,region.trackBoxAdapter.unwrap(),Math.max(0,Math.round(value))))return
    const start=region.position,end=region.complete,offset=region.loopOffset
    project.editing.modify(()=>{
        switch(action){
            case 'move':region.position=Math.max(0,Math.round(value));break
            case 'trim-start':{
                // Restrict this quick trim to the existing clip; source extension stays in the detailed editor.
                const next=Math.max(start,Math.min(Math.round(value),Math.floor(end)-1))
                region.position=next;region.duration=end-next;region.loopOffset=mod(offset+next-start,region.loopDuration)
                break
            }
            case 'trim-end':region.duration=Math.max(1,Math.min(end,Math.round(value))-start);break
            case 'fade-in':{
                const fit=fitFade(region.duration,Math.max(0,value),region.fading.out)
                region.fading.inField.setValue(fit.value);region.fading.outField.setValue(fit.opposite);break
            }
            case 'fade-out':{
                const fit=fitFade(region.duration,Math.max(0,value),region.fading.in)
                region.fading.outField.setValue(fit.value);region.fading.inField.setValue(fit.opposite);break
            }
            case 'mute':region.box.mute.setValue(!region.mute);break
            case 'erase':deleteScoringRegion(project,region);break
        }
        if(action==='trim-start'||action==='trim-end'){
            const fit=fitFade(region.duration,region.fading.in,region.fading.out)
            region.fading.inField.setValue(fit.value);region.fading.outField.setValue(fit.opposite)
        }
    },true)
}
