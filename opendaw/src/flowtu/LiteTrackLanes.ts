import {AudioRegionBoxAdapter, TrackType} from '@opendaw/studio-adapters'
import {Terminator} from '@opendaw/lib-std'
import type {Project} from '@opendaw/studio-core'
import {editingTool} from './editing-state'
import {drawLiteFade,fadeShape,paintLiteClip,type FadePart} from './lite-clip-paint'
import {liteTracks, liteTrimBoundary, reorderLiteTrack, transferLiteClip, trimLiteClip} from './lite-track-edit'
import {crossfades, crossfadeCurveMode} from './crossfades'
import {editCurves, plot as plotCrossfade} from './CrossfadeZones'
import {gainFader} from './ClipGain'
import {fitFade} from './fades'
import {smartEdgeWidth, smartMoveBoundary} from './audio-range'
import {getExplicitTimelineSelection, setTimelineSelection, clearAudioRange} from './timeline-selection'
import {applyLiteToolbarEdit} from './lite-clip-edit'
import {assertAudioEditorRegion,changeAudioEditorRegion} from './editor-audio-actions'
import {tr} from './studio-language'
import {seekTimeline} from './timeline-seek'
import type {LiteLaneGesture} from './lite-timeline-gestures'
import './lite-tracks.css'

type Track = ReturnType<typeof liteTracks>[number]
type Clip = Track['clips'][number]
type Op = 'move'|'copy'|'range'|'trim-start'|'trim-end'|FadePart|'cut'|'erase'|'mute'|'reorder'
interface Options {
    container: HTMLElement
    project(): Project|undefined
    extent(): number
    snap(p: Project,pulse: number): number
    selected(): string|undefined
    pick(p: Project,clip: Clip): void
    changed(id?: string): void
    run(f: () => void): void
    copyDrag(): boolean
    clock(s: number): string
}
export function createLiteTrackLanes(o: Options) {
    const thumbnails = new Terminator(), expanded = new Set<string>()
    const {container} = o
    let tracks: Track[] = [], current: Project|undefined
    let drag: {project: Project; row: Track; clip?: Clip; op: Op; x: number; y: number; at: number; rect: DOMRect; target?:HTMLElement; moved: boolean}|undefined
    const overlays: HTMLElement[] = []
    const clearOverlay = () => {overlays.splice(0).forEach(el => el.remove())}
    const rowAt = (el: Element|null) => tracks.find(row => row.id === el?.closest<HTMLElement>('[data-lite-track]')?.dataset.liteTrack)
    const laneFor = (row: Track) => container.querySelector<HTMLElement>(`[data-lite-track="${row.id}"] .ft-lite-clip-lane`)
    function timeAt(p: Project,x: number,rect: DOMRect,bypass=false) {
        const pulse=p.tempoMap.secondsToPPQN(Math.max(0,(x-rect.left)/Math.max(1,rect.width))*o.extent())
        return bypass?Math.round(pulse):o.snap(p,pulse)
    }
    function band(lane: HTMLElement,left: number,right: number,cls: string) {
        const overlay = document.createElement('i')
        overlay.className = cls
        overlay.style.left = `${left/o.extent()*100}%`; overlay.style.width = `${(right-left)/o.extent()*100}%`
        lane.append(overlay);return overlay
    }
    function paintSelection() {
        container.querySelectorAll('.ft-lite-time-range').forEach(el => el.remove())
        const p = o.project(), range = p && getExplicitTimelineSelection(p)
        if(!p || !range || range.end<=range.start) return
        const row = range.track ? tracks.find(r => r.track === range.track || r.clips.some(c => c.region.trackBoxAdapter.contains(range.track!))) : tracks.find(r=>r.clips.some(c=>c.id===o.selected()))
        const lane = row && laneFor(row)
        if(lane) band(lane,p.tempoMap.ppqnToSeconds(range.start),p.tempoMap.ppqnToSeconds(range.end),'ft-lite-time-range')
    }
    function draw(rows: Track[]) {
        const p = o.project()
        if (current !== p) {expanded.clear();current=p}
        tracks = rows
        // Keep capture and feedback intact while a pointer is down.
        if (drag || container.querySelector('.ft-clip-gain.dragging')) return
        const focusedGain=document.activeElement instanceof HTMLElement ? document.activeElement.dataset.liteGain : undefined
        thumbnails.terminate(); container.replaceChildren()
        const pairs=p?crossfades(p):[]
        for (const row of rows) {
            const wrapper = document.createElement('section'), head = document.createElement('div')
            const toggle = document.createElement('button'), grip = document.createElement('button'), lane = document.createElement('div')
            const large = expanded.has(row.id), step = large ? 76 : 45
            wrapper.dataset.liteTrack=row.id;wrapper.className='ft-lite-track';head.className='ft-lite-track-head'
            toggle.type=grip.type='button';grip.className='ft-lite-track-grip';grip.textContent='⠿';grip.title=tr('Drag to reorder track')
            grip.setAttribute('aria-label',grip.title)
            toggle.textContent=`${large ? '▾' : '▸'}  ${row.label || (row.track.type===TrackType.Audio ? 'Audio' : 'MIDI')}`
            toggle.setAttribute('aria-expanded',String(large))
            toggle.title=row.label || (row.track.type===TrackType.Audio ? 'Audio' : 'MIDI')
            toggle.onclick=()=>{if(large)expanded.delete(row.id);else expanded.add(row.id);row.track.box.isAttached() && p?.timelineFocus.focusTrack(row.track);draw(tracks)}
            head.append(grip,toggle);lane.className='ft-lite-clip-lane'
            const ends: number[]=[]
            for(const clip of row.clips) {
                const button=document.createElement('button'), canvas=document.createElement('canvas'), caption=document.createElement('small')
                button.type='button';button.className='ft-lite-clip';button.dataset.regionId=clip.id;button.dataset.muted=String(clip.region.mute)
                button.dataset.kind=clip.region instanceof AudioRegionBoxAdapter?'Audio':'MIDI'
                button.setAttribute('aria-pressed',String(p?.regionSelection.isSelected(clip.region)));caption.textContent=clip.region.box.label.getValue() || clip.region.label
                button.title=`${caption.textContent} · ${o.clock(clip.start)} – ${o.clock(clip.end)}`;canvas.setAttribute('aria-hidden','true')
                let i=ends.findIndex(end=>end<=clip.start+.000001)
                if(i<0)i=ends.length
                ends[i]=clip.end
                button.style.cssText=`left:${clip.start/o.extent()*100}%;width:${(clip.end-clip.start)/o.extent()*100}%;top:${step*i}px;height:${step-4}px`
                button.append(canvas,caption);lane.append(button)
                button.onclick=event=>{if(!event.detail && p){o.pick(p,clip);o.changed(clip.id)}}
                if(p)paintLiteClip(button,canvas,p,clip.region,thumbnails)
                if (p && clip.region instanceof AudioRegionBoxAdapter && o.selected()===clip.id) {
                    const {control}=gainFader(p,clip.region,thumbnails,()=>p.timelineFocus.focusTrack(row.track))
                    control.dataset.liteGain=clip.id
                    control.setAttribute('aria-label',tr('Clip gain')+' · '+caption.textContent)
                    control.disabled=p.audioUnitFreeze.isFrozen(row.unit)
                    control.style.left=`calc(${100*clip.end/o.extent()}% - 8px)`
                    control.style.width=`clamp(0px, calc(${100*(clip.end-clip.start)/o.extent()}% - 18px), 54px)`
                    control.style.top=(step*(i+1)-22)+'px'
                    control.addEventListener('pointerdown',e=>e.stopPropagation())
                    lane.append(control)
                }
            }
            if(p) for(const pair of pairs) {
                if(!row.clips.some(c=>c.region===pair.a || c.region===pair.b))continue
                const marker=document.createElement('button'), start=p.tempoMap.ppqnToSeconds(pair.b.position), end=p.tempoMap.ppqnToSeconds(pair.a.complete)
                marker.type='button';marker.className='ft-lite-crossfade';marker.setAttribute('aria-label',tr('Edit crossfade'))
                marker.title=tr('Edit crossfade')+' · '+Math.round(1000*(end-start))+' ms'
                marker.style.left=(100*start/o.extent())+'%';marker.style.width=(100*(end-start)/o.extent())+'%'
                marker.disabled=p.audioUnitFreeze.isFrozen(row.unit)
                marker.append(plotCrossfade(pair.b.fading.inSlope,pair.a.fading.outSlope,crossfadeCurveMode(p,pair)==='constant-power'))
                marker.onclick=()=>editCurves(p,pair)
                lane.append(marker)
            }
            lane.style.height=`${Math.max(1,ends.length)*step}px`;wrapper.append(head,lane);container.append(wrapper)
        }
        paintSelection()
        if(focusedGain)container.querySelector<HTMLElement>(`[data-lite-gain="${focusedGain}"]`)?.focus({preventScroll:true})
    }
    function operation(e:PointerEvent,target:HTMLElement,clip:Clip):Op {
        const box=target.getBoundingClientRect(), top=e.clientY-box.top, left=e.clientX-box.left, mode=editingTool.getValue()
        if(e.altKey || o.copyDrag())return 'copy'
        if(mode==='cut'||mode==='erase'||mode==='mute')return mode
        const part=(e.target as Element).closest<HTMLElement>('[data-clip-edge]')?.dataset.clipEdge as FadePart|'trim-start'|'trim-end'|undefined
        if(e.pointerType!=='touch' && (mode==='select'||mode==='fade') && part && (mode==='select'||!part.startsWith('trim')))return part
        if(mode==='trim')return left<box.width/2?'trim-start':'trim-end'
        if(mode==='fade' && clip.region instanceof AudioRegionBoxAdapter)return left<box.width/2?'fade-in':'fade-out'
        if(mode==='select'){
            if(e.pointerType!=='touch'){
                const edge=smartEdgeWidth(box.width)
                if(left<=edge)return 'trim-start'
                if(left>=box.width-edge)return 'trim-end'
            }
            if(top<=smartMoveBoundary(box.height,15))return 'move'
        }
        return 'range'
    }
    function hover(e:PointerEvent) {
        if(drag || e.pointerType==='touch' || !(e.target instanceof Element))return
        const button=e.target.closest<HTMLElement>('[data-region-id]'), row=rowAt(e.target)
        const clip=button && row?.clips.find(c=>c.id===button.dataset.regionId)
        if(button && clip)button.dataset.operation=operation(e,button,clip)
    }
    container.addEventListener('pointermove',hover)
    function begin(e: PointerEvent) {
        const el = e.target instanceof Element ? e.target : null, row=rowAt(el), p=o.project()
        if (!row || !p || el?.closest('.ft-lite-crossfade')) return false
        const target=el?.closest<HTMLElement>('[data-region-id]'), id=target?.dataset.regionId, clip=row.clips.find(c=>c.id===id)
        const reordering=!!el?.closest('.ft-lite-track-grip')
        if (!reordering && !el?.closest('.ft-lite-clip-lane')) return false
        const rect=laneFor(row)!.getBoundingClientRect()
        let op: Op='range'
        if (reordering) op='reorder'
        else if (clip && target)op=operation(e,target,clip)
        drag={project:p,row,clip,op,x:e.clientX,y:e.clientY,at:timeAt(p,e.clientX,rect,e.shiftKey),rect,target:target??undefined,moved:false}
        if(target)target.dataset.operation=op
        return true
    }
    function destination(e:PointerEvent) {
        const at = rowAt(document.elementFromPoint(e.clientX,e.clientY))
        return at && (drag?.op==='reorder'||at.track.type===drag?.row.track.type) ? at : undefined
    }
    function placedStart(e: PointerEvent) {
        const {project:p,rect,clip,x}=drag!
        const delta=(e.clientX-x)/Math.max(1,rect.width)*o.extent()
        const pos=p.tempoMap.secondsToPPQN(Math.max(0,clip!.start+delta))
        return e.shiftKey?Math.round(pos):o.snap(p,pos)
    }
    function fadeValue(region:AudioRegionBoxAdapter,op:Op,e:PointerEvent,at:number) {
        if(op==='curve-in'||op==='curve-out'){
            const delta=(drag!.y-e.clientY)/Math.max(1,drag!.target?.clientHeight??1)
            return Math.max(.01,Math.min(.99,op==='curve-in'?region.fading.inSlope+delta:region.fading.outSlope-delta))
        }
        return Math.max(0,op==='fade-in'?at-region.position:region.complete-at)
    }
    function move(e:PointerEvent){
        if (!drag || (!drag.moved && Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<5)) return
        drag.moved=true;clearOverlay()
        const {op,project:p,clip,row,at,rect}=drag, dest=destination(e)
        const end=timeAt(p,e.clientX,rect,e.shiftKey), sec=(pulse:number)=>p.tempoMap.ppqnToSeconds(pulse)
        if(clip && (op==='trim-start'||op==='trim-end')){
            const limit=sec(liteTrimBoundary(clip.region,op,end))
            const ghost=band(laneFor(row)!,op==='trim-start'?limit:clip.start,op==='trim-end'?limit:clip.end,'ft-lite-trim-ghost')
            ghost.textContent=o.clock(limit);overlays.push(ghost)
        }
        if(clip?.region instanceof AudioRegionBoxAdapter && (op.startsWith('fade-')||op.startsWith('curve-'))){
            const layer=drag.target?.querySelector<HTMLElement>('.ft-lite-fades'), shape=fadeShape(clip.region), value=fadeValue(clip.region,op,e,end)
            if(op==='curve-in')shape.slopeIn=value
            else if(op==='curve-out')shape.slopeOut=value
            else{
                const incoming=op==='fade-in', fit=fitFade(clip.region.duration,value,incoming?shape.fadeOut:shape.fadeIn)
                shape.fadeIn=incoming?fit.value:fit.opposite; shape.fadeOut=incoming?fit.opposite:fit.value
            }
            if(layer)drawLiteFade(layer,clip.region,p,shape)
        }
        if(op==='range') overlays.push(band(laneFor(row)!,sec(Math.min(at,end)),sec(Math.max(at,end)),'ft-lite-preview-range'))
        if((op==='move'||op==='copy')&&dest&&clip){
            const start=placedStart(e), finish=clip.region instanceof AudioRegionBoxAdapter ? clip.region.resolveComplete(start):start+clip.region.duration
            overlays.push(band(laneFor(dest)!,sec(start),sec(finish),'ft-lite-clip-ghost'))
        }
        if(op==='reorder'&&dest){
            const el=laneFor(dest)!.parentElement!, box=el.getBoundingClientRect(), line=document.createElement('i')
            line.className='ft-lite-track-insert';line.style[e.clientY>(box.top+box.bottom)/2?'bottom':'top']='0';el.append(line);overlays.push(line)
        }
    }
    function cancel(){
        const layer=drag?.target?.querySelector<HTMLElement>('.ft-lite-fades'), region=drag?.clip?.region
        if(layer && drag && region instanceof AudioRegionBoxAdapter && region.box.isAttached())drawLiteFade(layer,region,drag.project,fadeShape(region))
        clearOverlay();drag=undefined
    }
    function end(e:PointerEvent) {
        if(!drag)return
        const {op,clip,row,at,rect,project:p,moved}=drag, dest=destination(e), end=timeAt(p,e.clientX,rect,e.shiftKey)
        const value=clip?.region instanceof AudioRegionBoxAdapter?fadeValue(clip.region,op,e,end):0
        const start=clip ? placedStart(e):0
        cancel()
        if(p!==o.project())return
        o.run(()=>{
            if(op==='reorder'){
                if(moved&&dest){const box=laneFor(dest)!.parentElement!.getBoundingClientRect();reorderLiteTrack(p,row.track,dest.track,e.clientY>(box.top+box.bottom)/2)}
                return
            }
            if(clip)o.pick(p,clip)
            else {p.regionSelection.deselectAll();p.timelineFocus.focusTrack(row.track)}
            let next: string|undefined=clip?.id
            if(moved && (op==='move'||op==='copy') && clip){
                if(!dest)throw new Error(tr('Choose a track of the same type.'))
                next=transferLiteClip(p,clip.id,dest.track,start,op==='copy'||e.altKey)
                clearAudioRange(p)
            } else if(moved && op==='range' && at!==end){
                const source=clip?.region.trackBoxAdapter.unwrapOrNull()??row.track
                setTimelineSelection(p,{start:Math.min(at,end),end:Math.max(at,end)},source)
                seekTimeline(p,Math.min(at,end))
            } else if(clip && (op==='cut'||op==='erase')){
                next=applyLiteToolbarEdit(p,clip.id,op==='cut'?'split':'delete',end)
            } else if(clip && moved && (op==='trim-start'||op==='trim-end')){
                trimLiteClip(p,clip.region,op,end)
            } else if(clip?.region instanceof AudioRegionBoxAdapter && moved && (op==='fade-in'||op==='fade-out')){
                changeAudioEditorRegion(p,clip.region,op,value)
            } else if(clip?.region instanceof AudioRegionBoxAdapter && moved && (op==='curve-in'||op==='curve-out')){
                const r=clip.region
                assertAudioEditorRegion(p,r)
                p.editing.modify(()=>(op==='curve-in'?r.fading.inSlopeField:r.fading.outSlopeField).setValue(value),true)
            } else if(clip && op==='mute'){
                p.editing.modify(()=>clip.region.box.mute.setValue(!clip.region.mute),true)
            } else {clearAudioRange(p);seekTimeline(p,end)}
            o.changed(next)
        })
    }
    const gesture:LiteLaneGesture={begin,move,end,cancel}
    return {gesture, draw, paintSelection, dispose(){container.removeEventListener('pointermove',hover);cancel();expanded.clear();thumbnails.terminate()}}
}
