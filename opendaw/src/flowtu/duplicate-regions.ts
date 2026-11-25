import {AudioUnitBoxAdapter,type AnyRegionBoxAdapter} from '@opendaw/studio-adapters'
import type {Project} from '@opendaw/studio-core'

export function duplicateRegions(project:Project,regions:ReadonlyArray<AnyRegionBoxAdapter>) {
    if (!regions.length || regions.some(region=>!region.box.isAttached() || region.trackBoxAdapter.flatMap(track=>track.optAudioUnit)
        .mapOr(box=>project.audioUnitFreeze.isFrozen(project.boxAdapters.adapterFor(box,AudioUnitBoxAdapter)),false))) return
    // Move the entire selection as one block, preserving rests and cross-track alignment.
    let offset=Math.ceil(Math.max(...regions.map(r=>r.complete))-Math.min(...regions.map(r=>r.position)))
    let collision=true
    while(collision){
        collision=false
        for(const r of regions){
            const track=r.trackBoxAdapter.unwrap('trackBoxAdapter')
            const start=Math.ceil(r.position+offset),end=r.resolveComplete(start)
            const occupied=track.regions.collection.asArray().find(other=>other.position<end&&other.complete>start)
            if(occupied){offset=Math.max(offset+1,Math.ceil(occupied.complete-r.position));collision=true;break}
        }
    }
    project.editing.modify(()=>{
        const copies:AnyRegionBoxAdapter[]=[]
        for(const r of regions)project.api.duplicateRegion(r,{position:r.position+offset}).ifSome(c=>copies.push(c))
        project.regionSelection.deselectAll();project.regionSelection.select(...copies)
    },true)
}
