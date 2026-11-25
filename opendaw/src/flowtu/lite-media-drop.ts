import {TrackType, TrackBoxAdapter} from '@opendaw/studio-adapters'
import {TrackBox} from '@opendaw/studio-boxes'
import {UUID} from '@opendaw/lib-std'
import {DragAndDrop} from '../ui/DragAndDrop'
import type {StudioService} from '../service/StudioService'
import type {Project} from '@opendaw/studio-core'
import {importMedia,mediaKind} from './media-import'
import {takeRegion} from './scoring-model'
import {placeAssetParts} from './scoring-assets'
import {tr} from './studio-language'

export function installLiteMediaDrop(container:HTMLElement,service:StudioService,getExtent:()=>number,
                                     snap:(p:Project,tick:number)=>number,report:(message:string,error?:boolean)=>void) {
    const marker=document.createElement('i')
    marker.className='ft-lite-drop-point'
    marker.setAttribute('aria-hidden','true')
    function hit(event:DragEvent) {
        const target=event.target instanceof Element ? event.target : null
        const lane=target?.closest<HTMLElement>('.ft-lite-clip-lane')
        const id=lane?.closest<HTMLElement>('[data-lite-track]')?.dataset.liteTrack
        if(!lane || !id || !service.hasProfile) return
        const p=service.project,box=p.boxGraph.findBox(UUID.parse(id)).unwrapOrNull()
        if(!(box instanceof TrackBox)) return
        const track=p.boxAdapters.adapterFor(box,TrackBoxAdapter)
        const rect=lane.getBoundingClientRect(),extent=getExtent()
        const fraction=Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)))
        const tick=p.tempoMap.secondsToPPQN(extent*fraction)
        return {p,track,lane,id,extent,start:event.shiftKey?Math.round(tick):snap(p,tick)}
    }
    return DragAndDrop.installTarget(container,{
        enter(){}, leave(){marker.remove()},
        drag(event,data) {
            const dest=hit(event)
            if(!dest || (data.type!=='file' && data.type!=='project-asset')) {marker.remove();return false}
            if(data.type==='project-asset' && (data.project!==dest.p || takeRegion(dest.p,data.id)?.trackBoxAdapter.unwrapOrNull()?.type!==dest.track.type)) {
                marker.remove();return false
            }
            marker.style.left=(100*dest.p.tempoMap.ppqnToSeconds(dest.start)/dest.extent)+'%'
            if(marker.parentElement!==dest.lane)dest.lane.append(marker)
            return true
        },
        drop(event,data) {
            const dest=hit(event)
            marker.remove()
            if(!dest)return
            const {p,track,id,start}=dest
            const error=(reason:unknown)=>{if(service.hasProfile && service.project===p)report(reason instanceof Error?reason.message:String(reason),true)}
            if(data.type==='file') {
                const files=data.files,type=track.type===TrackType.Audio?'audio':'midi'
                if(files.some(f=>mediaKind(f)!==type)) {report(tr('Choose a track of the same type.'),true);return}
                void (async()=>{
                    let position=start
                    for(const file of files) {
                        if(!service.hasProfile || service.project!==p)return
                        const regionId=await importMedia(service,file,{kind:'existing',trackId:id,atPointer:true},position)
                        position=Math.ceil(takeRegion(p,regionId)!.complete)
                    }
                })().catch(error)
            } else if(data.type==='project-asset' && data.project===p) {
                try {
                    if(!placeAssetParts(p,data.parts ?? [data.id],track,start))throw new Error(tr('Choose a track of the same type.'))
                } catch(reason){error(reason)}
            }
        }
    })
}
