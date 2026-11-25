import {navigateWithProfile} from './profile-navigation'
import {clipDragSnap} from "../ui/timeline/AudioClipSnap"
import {AudioRegionBoxAdapter} from '@opendaw/studio-adapters'
import type {Project,TimelineRange} from '@opendaw/studio-core'
import type {Snapping} from '../ui/timeline/Snapping'
import type {AudioEventOwnerReader} from '../ui/timeline/editors/EventOwnerReader'
import {endTick, smartEdgeWidth, smartMoveBoundary} from './audio-range'
import {seekTimeline} from './timeline-seek'
import {fadeCurveDrag, hitFadeHandle} from './FadeHandles'
import {crossfades} from './crossfades'
import {editingTool} from './editing-state'
import {toolForKey, keyProfile, toolKeyLabel, onKeyProfileChange, splitKeyLabel, profileSplit} from './tool-shortcuts'
import {assertAudioEditorRegion,changeAudioEditorRegion,duplicateAudioEditorRegion,selectAudioEditorRegion,splitAudioEditorRegion} from './editor-audio-actions'
import {getAudioRange,clearAudioRange,handleRangeBlade,performAudioRangeEdit,copySelectedAudioRange,locateScoringRange} from './RangeSelection'
import {finishTimelineRangeGesture, getExplicitTimelineSelection, rememberTimelineSelection, setTimelineSelection, subscribeTimelineSelection} from './timeline-selection'
import {editClipboard} from './editing-clipboard'
import {formatTimelineTime,getFrameRate} from './time-format'
import {timeSettings} from './time-settings'
import './editor-audio.css'

/** Arrangement audio editors use shared tools; launcher clips keep their native source editor. */
export function installAudioEditorTools(canvas:HTMLCanvasElement,project:Project,range:TimelineRange,snapping:Snapping,reader:AudioEventOwnerReader){
    const region=reader.audioContent
    if(!(region instanceof AudioRegionBoxAdapter))return {terminate(){}}
    const panel=canvas.closest<HTMLElement>('[data-scope=content-editor]')!
    const wrapper=canvas.parentElement!
    wrapper.classList.add('flowtu-audio-editing')
    canvas.dataset.audioEditor='waveform'
    const selection=document.createElement('div');selection.className='flowtu-editor-range';selection.hidden=true
    const notice=document.createElement('output');notice.className='flowtu-editor-notice';notice.setAttribute('role','status')
    wrapper.append(selection,notice)
    let cancelDrag:(()=>void)|undefined
    const tell=(message:string)=>{notice.textContent=message;notice.title=message}
    const seek=(position:number)=>{
        if(project.env.audioContext.state==='suspended')void project.env.audioContext.resume().catch(()=>tell('Press Play once to enable audio.'))
        seekTimeline(project, Math.max(0,position))
    }
    const boundedRange=()=>{
        const selected=getAudioRange(project)
        return selected&&selected.track===region.trackBoxAdapter.unwrapOrUndefined()&&selected.start>=region.position&&selected.end<=endTick(region.position,region.complete)?selected:undefined
    }
    const focus=()=>{
        selectAudioEditorRegion(project,region)
        if(!boundedRange())clearAudioRange(project)
        canvas.focus({preventScroll:true})
    }
    const paint=()=>{
        const time = getExplicitTimelineSelection(project)
        const visible = time && (!('track' in time) || time.track === region.trackBoxAdapter.unwrapOrUndefined())
        const start = visible ? Math.max(time.start,region.position) : 0
        const end = visible ? Math.min(time.end,region.complete) : 0
        selection.hidden = end <= start
        if (!selection.hidden) {
            selection.style.left = `${range.unitToX(start)}px`
            selection.style.width = `${Math.max(1,range.unitToX(end)-range.unitToX(start))}px`
        }
    }
    const run=(action:()=>void)=>{try{action();paint()}catch(error){tell(error instanceof Error?error.message:String(error))}}
    const hint=()=>{
        const mode=editingTool.getValue()
        delete canvas.dataset.fadeHandle
        canvas.style.cursor=mode==='cut'?'crosshair':mode==='range'?'text':mode==='trim'?'ew-resize':mode==='fade'?'crosshair':mode==='erase'?'not-allowed':'default'
        if (keyProfile() !== 'flowtu') {
            const keys = [toolKeyLabel('select') + ' Smart', toolKeyLabel('range') + ' Range', splitKeyLabel() + ' Split', 'Space Play']
            notice.title = keys.join(' · '); tell(notice.title); return
        }
        tell('B Split range / Blade · R Range · Space Play')
        notice.title='A/V Smart: top moves, center selects · B Split range / Blade · R Range · T Trim · F Fade · 5 Mute · M Mark cue · E Erase · Cmd/Ctrl+A Select clip · Cmd/Ctrl+D Duplicate · Cmd/Ctrl+B Split · Alt-drag Slip'
    }
    const keydown=(event:KeyboardEvent)=>{
        if(event.defaultPrevented||event.isComposing||document.querySelector('dialog[open]')||!(event.target instanceof Element)||event.target.closest('input,select,textarea,[contenteditable]:not([contenteditable=false]),[role=slider]'))return
        // Marker lanes retain their native clipboard, Delete and arrow editing.
        if(event.target!==canvas&&event.target!==panel&&!event.target.closest('.time-axis'))return
        const command=event.metaKey||event.ctrlKey,key=event.key.toLowerCase()
        if(command&&key==='z'){cancelDrag?.();return}
        if(event.key==='Escape'&&cancelDrag){event.preventDefault();event.stopImmediatePropagation();cancelDrag();return}
        if(navigateWithProfile(event,project,range))return
        if(handleRangeBlade(event,project,run,region))return
        const tool=toolForKey(event.key,event)
        if(tool){event.preventDefault();event.stopImmediatePropagation();editingTool.setValue(tool);return}
        const split = profileSplit(event.key,event) || (command && key === 'b' && !event.altKey && !event.shiftKey)
        if (!split && (event.altKey || event.shiftKey)) return
        if(!split && !(command&&['a','b','c','d','x','v'].includes(key))&&!['delete','backspace','escape'].includes(key))return
        event.preventDefault();event.stopImmediatePropagation();cancelDrag?.()
        run(()=>{
            assertAudioEditorRegion(project,region)
            if(key==='escape'){clearAudioRange(project);return}
            if(split){
                if (event.repeat) return
                if(boundedRange())performAudioRangeEdit(project,'split',region)
                else splitAudioEditorRegion(project,region,snapping.round(project.engine.position.getValue()))
                tell('Audio split');return
            }
            const selected=boundedRange()
            selectAudioEditorRegion(project,region)
            if(command&&key==='a'){
                setTimelineSelection(project,{start:region.position,end:endTick(region.position,region.complete)},region.trackBoxAdapter.unwrap())
                locateScoringRange(project)
                tell('Entire audio clip selected');return
            }
            if(command&&key==='d'){
                clearAudioRange(project)
                const next=Math.ceil(region.complete),copy=duplicateAudioEditorRegion(project,region)
                const message=copy.position===next?'Audio duplicated':'Duplicated at next free position'
                tell(message)
                // Opening the duplicate replaces this canvas; keep its destination notice visible in the workspace.
                const workspaceStatus=document.querySelector<HTMLElement>('.flowtu-status')
                if(workspaceStatus){workspaceStatus.textContent=message;workspaceStatus.title=message}
                return
            }
            if(command&&['c','x'].includes(key)){
                if(selected)copySelectedAudioRange(project,key==='x')
                else editClipboard(key==='x'?'cut':'copy')
                tell(key==='x'?'Audio cut':'Audio copied');return
            }
            if(command&&key==='v'){
                const before=new Set(project.regionSelection.selected())
                editClipboard('paste')
                const pasted=project.regionSelection.selected().find(candidate=>candidate instanceof AudioRegionBoxAdapter&&!before.has(candidate))
                if(pasted)project.userEditingManager.timeline.edit(pasted.box)
                return
            }
            if(selected)performAudioRangeEdit(project,'delete')
            else changeAudioEditorRegion(project,region,'erase')
        })
    }
    const fadeHandleAt = (event: PointerEvent, rect: DOMRect) => {
        const mode = editingTool.getValue()
        if (mode !== 'select' && mode !== 'fade') return
        return hitFadeHandle(range, region.fading, {top: 0, bottom: rect.height}, region.position, region.complete,
            event.clientX - rect.left, event.clientY - rect.top)
    }
    let rangeBody: boolean | undefined
    const smartOperation = (x: number, y: number, height: number) => {
        const left = range.unitToX(region.position), right = range.unitToX(region.complete)
        const edge = smartEdgeWidth(right - left)
        if (Math.abs(x - left) <= edge) return 'trim-start'
        if (Math.abs(x - right) <= edge) return 'trim-end'
        const tolerance = rangeBody === undefined ? 0 : rangeBody ? -2 : 2
        rangeBody = y >= smartMoveBoundary(height, 0) + tolerance
        return rangeBody ? 'range' : 'move'
    }
    const hover = (event: PointerEvent) => {
        if (cancelDrag) return
        const rect = canvas.getBoundingClientRect()
        const handle = fadeHandleAt(event, rect)
        if (handle) canvas.dataset.fadeHandle = handle.startsWith('curve') ? 'curve' : 'length'
        else delete canvas.dataset.fadeHandle
        if (editingTool.getValue() !== 'select') return
        const x = event.clientX - rect.left
        if (x < range.unitToX(region.position) || x > range.unitToX(region.complete)) {
            rangeBody = undefined
            canvas.style.cursor = 'default'
            return
        }
        const operation = smartOperation(x, event.clientY - rect.top, rect.height)
        canvas.style.cursor = operation === 'range' ? 'text' : operation === 'move' ? 'grab' : 'ew-resize'
    }
    const pointerdown=(event:PointerEvent)=>{
        if(event.button!==0||event.altKey||event.metaKey||event.ctrlKey)return
        event.preventDefault();event.stopImmediatePropagation();cancelDrag?.()
        run(()=>{
            const restoreSelection = rememberTimelineSelection(project)
            focus()
            const rect=canvas.getBoundingClientRect(),mode=editingTool.getValue()
            const pulse=(e:PointerEvent)=>e.shiftKey?Math.round(range.xToUnit(e.clientX-canvas.getBoundingClientRect().left)):snapping.round(range.xToUnit(e.clientX-canvas.getBoundingClientRect().left))
            const startPulse=pulse(event),start=region.position,end=region.complete
            const handle = fadeHandleAt(event, rect)
            const inside=!!handle || (startPulse>=start&&startPulse<=end)
            if(!inside){clearAudioRange(project);seek(startPulse);tell('Outside this clip · Click its waveform to edit');return}
            if(mode==='cut'){clearAudioRange(project);splitAudioEditorRegion(project,region,startPulse);return}
            if(mode==='mute'||mode==='erase'){clearAudioRange(project);changeAudioEditorRegion(project,region,mode);return}
            const left=startPulse<(start+end)/2
            const x=event.clientX-rect.left
            const curve = handle === 'curve-in' || handle === 'curve-out'
            const operation = handle === 'fade-in' || handle === 'curve-in' ? 'fade-in'
                : handle === 'fade-out' || handle === 'curve-out' ? 'fade-out'
                : mode==='trim'?(left?'trim-start':'trim-end'):mode==='fade'?(left?'fade-in':'fade-out'):mode==='select'?smartOperation(x,event.clientY-rect.top,rect.height):'range'
            if ((operation === 'fade-in' || operation === 'fade-out') && crossfades(project).some(
                pair => (operation === 'fade-in' ? pair.b : pair.a) === region)) {
                tell('Click the overlap on the timeline to edit this crossfade.')
                return
            }
            const shape = curve ? fadeCurveDrag(project, region, operation === 'fade-in', event.clientY, rect.height) : undefined
            const edge = operation === 'move' ? 'move' : operation === 'trim-start' ? 'start' : operation === 'trim-end' ? 'end' : null
            const snapDrag = edge && clipDragSnap(project, snapping, [region], region, edge, range.xToUnit(x))
            let lastPulse=startPulse,moved=false,delta=0
            if(operation==='range')clearAudioRange(project)
            const update=(e:PointerEvent)=>{
                if (shape) {shape.update(e); return}
                lastPulse=pulse(e);moved ||= Math.abs(e.clientX-event.clientX)>3
                if(snapDrag)delta=snapDrag(e.clientX-canvas.getBoundingClientRect().left,e.shiftKey)
                if(operation==='range'){
                    const a=Math.max(start,Math.min(end,startPulse)),b=Math.max(start,Math.min(end,lastPulse))
                    setTimelineSelection(project,{start:Math.min(a,b),end:Math.max(a,b)},region.trackBoxAdapter.unwrap());paint()
                    tell(`Range ${formatTimelineTime(project.tempoMap.intervalToSeconds(Math.min(a,b),Math.max(a,b)),timeSettings.display,getFrameRate(timeSettings.fps))} · Delete, Copy or Cmd/Ctrl+B`)
                }else tell(`${operation.replace('-',' ')} · Release to apply · Escape to cancel`)
            }
            const cleanup=()=>{
                window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',cancel,true);window.removeEventListener('blur',restore)
                canvas.removeEventListener('lostpointercapture',lost)
                if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId)
                snapping.guide.setValue(null)
                cancelDrag=undefined
            }
            const restore=()=>{cleanup();shape?.cancel?.();restoreSelection();paint();hint()}
            const move=(e:PointerEvent)=>{if(e.pointerId!==event.pointerId)return;e.preventDefault();e.stopImmediatePropagation();if(!region.box.isAttached()){restore();return}update(e)}
            const up=(e:PointerEvent)=>{
                if(e.pointerId!==event.pointerId)return;e.preventDefault();e.stopImmediatePropagation();update(e);cleanup()
                run(()=>{
                    if (shape) {shape.approve?.(); hint(); return}
                    if(!moved){clearAudioRange(project);seek(startPulse);return}
                    if(operation==='range'){locateScoringRange(project);finishTimelineRangeGesture(project);return}
                    clearAudioRange(project)
                    const value=operation==='move'||operation==='trim-start'?start+delta:operation==='trim-end'?end+delta:operation==='fade-in'?Math.max(0,lastPulse-start):Math.max(0,end-lastPulse)
                    changeAudioEditorRegion(project,region,operation,value);hint()
                })
            }
            const cancel=(e:PointerEvent)=>{if(e.pointerId===event.pointerId)restore()}
            const lost=(e:PointerEvent)=>{if(e.pointerId===event.pointerId&&cancelDrag)restore()}
            cancelDrag=restore;canvas.setPointerCapture(event.pointerId)
            window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',cancel,true);window.addEventListener('blur',restore);canvas.addEventListener('lostpointercapture',lost)
        })
    }
    canvas.addEventListener('pointermove',hover)
    canvas.addEventListener('pointerdown',pointerdown,true);panel.addEventListener('keydown',keydown,true)
    const unwatchProfile = onKeyProfileChange(hint)
    const toolSubscription=editingTool.catchupAndSubscribe(hint),rangeSubscription=range.subscribe(paint),changes=subscribeTimelineSelection(project,paint)
    paint()
    return {terminate(){unwatchProfile();cancelDrag?.();changes.terminate();toolSubscription.terminate();rangeSubscription.terminate();canvas.removeEventListener('pointermove',hover);delete canvas.dataset.fadeHandle;canvas.removeEventListener('pointerdown',pointerdown,true);panel.removeEventListener('keydown',keydown,true);wrapper.classList.remove('flowtu-audio-editing');selection.remove();notice.remove()}}
}
