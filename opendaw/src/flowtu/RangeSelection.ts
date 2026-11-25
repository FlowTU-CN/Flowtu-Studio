import {tr} from './studio-language'
import {editEnvelopeRange} from './envelope-range'
import {isEnvelopeTrack} from './EnvelopeTools'
import {keyProfile, splitKeyLabel, onKeyProfileChange} from './tool-shortcuts'
import {seekTimeline} from './timeline-seek'
import {AudioRegionBoxAdapter,TrackType} from '@opendaw/studio-adapters'
import {type Lifecycle,Terminable} from '@opendaw/lib-std'
import {PPQN} from '@opendaw/lib-dsp'
import type {ElementCapturing,Project,TimelineRange} from '@opendaw/studio-core'
import type {StudioService} from '../service/StudioService'
import type {RegionCaptureTarget} from '../ui/timeline/tracks/audio-unit/regions/RegionCapturing'
import type {TracksManager} from '../ui/timeline/tracks/audio-unit/TracksManager'
import {RegionLabel} from '../ui/timeline/RegionLabel'
import {editingTool} from './editing-state'
import {normalizeAudioRange} from './audio-range'
import {editAudioRanges} from './range-edit'
import {copyTrackRanges} from './range-clipboard'
import {setEditingClipboard} from './editing-clipboard'
import {formatTimelineTime,parseTimelineTime,getFrameRate} from './time-format'
import {timeSettings,subscribeTimeSettings} from './time-settings'
import './range-selection.css'

import {
    bindTimelineTrackOrder, timelineTrackOrder, checkRangeTracks, clearAudioRange, finishTimelineRangeGesture, followSelectedClips, getAudioRange, getEnvelopeRange, getExplicitTimelineSelection, getTimelineSelection,
    loopTimelineSelection, rememberTimelineSelection, setTimelineSelection, subscribeTimelineSelection
} from './timeline-selection'

export {getAudioRange, clearAudioRange} from './timeline-selection'
export function setAudioRangeBounds(project:Project,start:number,end:number){
    const range=getTimelineSelection(project)
    if(!range)throw new Error('Select a time range first.')
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||Math.round(end)<=Math.round(start))throw new Error('Range end must be after its start.')
    const explicit = getExplicitTimelineSelection(project)
    setTimelineSelection(project,{start,end},explicit?.track,explicit?.tracks)
    locateScoringRange(project)
}
/** Once a waveform selection is committed, spot the picture at its first frame. */
export function locateScoringRange(project:Project) {
    if (!document.documentElement.classList.contains('ft-video-mode') || project.engine.isPlaying.getValue()) return
    const selection = getTimelineSelection(project)
    if (!selection) return
    const context = project.env.audioContext
    if (context.state === 'suspended') void context.resume().catch(() => showRangeNotice('Press Play once to enable audio.'))
    seekTimeline(project, selection.start)
}
function splitTrack(project: Project, editorRegion?: AudioRegionBoxAdapter) {
    const selection = getExplicitTimelineSelection(project)
    if (!selection || selection.end <= selection.start) return
    const editorTrack = editorRegion?.trackBoxAdapter.unwrapOrUndefined()
    if (editorRegion && (!editorTrack || (selection.track && editorTrack !== selection.track))) return
    const track = selection.track ?? editorTrack ?? project.timelineFocus.track.unwrapOrUndefined()
    return track?.type === TrackType.Audio ? track : undefined
}

export function performAudioRangeEdit(project: Project, action: 'split' | 'delete', editorRegion?: AudioRegionBoxAdapter) {
    const range = getExplicitTimelineSelection(project)
    const track = action === 'split' ? splitTrack(project, editorRegion) : getAudioRange(project)?.track
    if (!range || !track) throw new Error('Select a range on an audio track, or select its track header for a ruler range.')
    const owners=editorRegion ? [track] : range.tracks ?? [track]
    checkRangeTracks(project,owners)
    const fragments = editAudioRanges(project, owners, range, action, editorRegion)
    if (action === 'split') followSelectedClips(project)
    else clearAudioRange(project)
    return fragments
}

/** Bare B splits a drawn time range. A native whole-clip selection still allows B to pick the Blade tool. */
export function handleRangeBlade(event: KeyboardEvent, project: Project, run: (action: () => void) => void,
                                 editorRegion?: AudioRegionBoxAdapter): boolean {
    if (keyProfile() !== 'flowtu' || event.key.toLowerCase() !== 'b' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false
    const range = getExplicitTimelineSelection(project)
    if (!event.repeat && (!range || range.end <= range.start)) return false
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!event.repeat) run(() => performAudioRangeEdit(project, 'split', editorRegion))
    return true
}
export function copySelectedAudioRange(project:Project,cut=false){
    const value=getAudioRange(project);if(!value)throw new Error('Select an audio time range first.')
    checkRangeTracks(project,value.tracks)
    const entry=copyTrackRanges(project,value,value.tracks,value.tracks.length===1 ? value.tracks : timelineTrackOrder(project))
    if(cut)performAudioRangeEdit(project,'delete')
    setEditingClipboard(entry)
}
export const showRangeNotice=(source:string)=>{const text=tr(source);let output=document.querySelector<HTMLOutputElement>('.flowtu-range-notice');if(!output){output=document.createElement('output');output.className='flowtu-range-notice';output.setAttribute('role','status');document.body.append(output)}output.textContent=text;output.hidden=false;setTimeout(()=>{if(output?.textContent===text)output.hidden=true},5000)}
export function installRangeTools(service:StudioService,toolbar:HTMLElement){
    const group=document.createElement('div');group.className='flowtu-range-tools';group.setAttribute('role','group');group.setAttribute('aria-label','Time selection actions')
    const status=document.createElement('output');status.setAttribute('aria-label','Selected time range');status.textContent='No range';group.append(status)
    const makeField=(name:string)=>{const label=document.createElement('label');label.className='range-time-field';label.textContent=name;const input=document.createElement('input');input.type='text';input.spellcheck=false;input.setAttribute('aria-label',`Range ${name.toLowerCase()}`);label.append(input);group.append(label);return input}
    const startField=makeField('Start'),endField=makeField('End')
    const fields=[startField,endField]
    const commit=(input:HTMLInputElement)=>{
        if(!service.hasProfile)return
        const selection=getTimelineSelection(service.project);if(!selection)return
        const seconds=parseTimelineTime(input.value,timeSettings.display,getFrameRate(timeSettings.fps))
        try{
            if(seconds===null||seconds<0)throw new Error('Enter a valid non-negative time in the selected transport format.')
            const pulse=Math.round(service.project.tempoMap.secondsToPPQN(seconds))
            setAudioRangeBounds(service.project,input===startField?pulse:selection.start,input===endField?pulse:selection.end)
            input.removeAttribute('aria-invalid')
            input.value=formatTimelineTime(service.project.tempoMap.ppqnToSeconds(pulse),timeSettings.display,getFrameRate(timeSettings.fps))
        }catch(error){input.setAttribute('aria-invalid','true');showRangeNotice(error instanceof Error?error.message:String(error))}
    }
    fields.forEach(input=>{input.onchange=()=>commit(input);input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();commit(input);if(!input.hasAttribute('aria-invalid'))input.blur()}if(event.key==='Escape'){event.preventDefault();const range=service.hasProfile?getTimelineSelection(service.project):undefined;if(range)input.value=formatTimelineTime(service.project.tempoMap.ppqnToSeconds(input===startField?range.start:range.end),timeSettings.display,getFrameRate(timeSettings.fps));input.removeAttribute('aria-invalid');input.blur();refresh()}if(event.key!=='Tab')event.stopPropagation()}})
    const items:[string,()=>void][]=[['Split Range',()=>{performAudioRangeEdit(service.project,'split');showRangeNotice('Range separated into selected audio clips.')}],['Delete Range',()=>{if(editEnvelopeRange(service.project,'delete'))return;performAudioRangeEdit(service.project,'delete');showRangeNotice('Selected audio removed; later clips stay in place.')}],['Loop Range',()=>{loopTimelineSelection(service.project);showRangeNotice('Loop set to the selected range. Press Space to audition.')}],['Clear Range',()=>clearAudioRange(service.project)]]
    const buttons=items.map(([label,action])=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.editAction=label;button.onclick=()=>{try{action()}catch(error){showRangeNotice(error instanceof Error?error.message:String(error))}};group.append(button);return button})
    const updateSplitHint = () => {
        const profile = keyProfile()
        const label = profile === 'flowtu' ? 'B' : splitKeyLabel()
        buttons[0].title = 'Split at selection boundaries · ' + label
        buttons[0].setAttribute('aria-keyshortcuts', profile === 'cubase' ? 'Alt+X' : profile === 'video' ? 'Control+B Meta+B' : 'B')
    }
    updateSplitHint()
    const unsubscribeKeys = onKeyProfileChange(updateSplitHint)
    toolbar.append(group)
    const refresh=()=>{
        const range=service.hasProfile?getTimelineSelection(service.project):undefined
        const audio = service.hasProfile && !!getAudioRange(service.project)
        buttons[0].disabled = !service.hasProfile || !splitTrack(service.project)
        buttons[1].disabled = !(audio || service.hasProfile && getEnvelopeRange(service.project))
        buttons[2].disabled = buttons[3].disabled = !range
        fields.forEach(input=>input.disabled=!range)
        if(range){
            const seconds=service.project.tempoMap.ppqnToSeconds(range.start),end=service.project.tempoMap.ppqnToSeconds(range.end)
            status.textContent=`Length ${formatTimelineTime(end-seconds,timeSettings.display,getFrameRate(timeSettings.fps))}`;group.dataset.active='true'
            fields.forEach((input,i)=>{const value=i?end:seconds;input.title=`${value.toFixed(6)} seconds · Enter to apply, Escape to cancel`;if(document.activeElement!==input)input.value=formatTimelineTime(value,timeSettings.display,getFrameRate(timeSettings.fps))})
        }else{status.textContent='Drag on a ruler or waveform';group.dataset.active='false';fields.forEach(input=>{if(document.activeElement!==input)input.value='—'})}
    }
    let changes = Terminable.Empty
    const profile = service.projectProfileService.catchupAndSubscribe(() => {
        changes.terminate()
        changes = service.hasProfile ? Terminable.many(subscribeTimelineSelection(service.project, refresh),
            service.project.timelineFocus.track.subscribe(refresh)) : Terminable.Empty
        refresh()
    })
    const unsubscribe = subscribeTimeSettings(refresh)
    window.addEventListener('pagehide',()=>{profile.terminate();changes.terminate();unsubscribe();unsubscribeKeys()},{once:true})
}

export function installRangeSelection(element:HTMLElement,service:StudioService,capturing:ElementCapturing<RegionCaptureTarget>,range:TimelineRange,manager:TracksManager,lifecycle:Lifecycle){
    const project=service.project,overlay=document.createElement('div'),rectangle=document.createElement('div'),label=document.createElement('span')
    overlay.className='flowtu-range-overlay';rectangle.className='flowtu-range-rectangle';rectangle.append(label);overlay.append(rectangle);element.append(overlay);overlay.hidden=true
    lifecycle.own(bindTimelineTrackOrder(project,()=>manager.tracks().flatMap(row=>manager.playbackLanes(row.trackBoxAdapter))))
    const rectangles = [rectangle]
    let finishing:(()=>void)|undefined,cancelGesture:(()=>void)|undefined,dragging=false
    const paint=()=>{
        const selection = getExplicitTimelineSelection(project)
        if (!selection || selection.end <= selection.start) {overlay.hidden = true; return}
        const displayed = new Set(selection.tracks?.map(owner=>manager.displayTrack(owner)))
        const rows = selection.track ? manager.tracks().filter(row=>displayed.has(row.trackBoxAdapter)) : [undefined]
        overlay.hidden = !rows.length
        overlay.dataset.scope = selection.track ? 'waveform' : 'timeline'
        while (rectangles.length < rows.length) {
            const extra = document.createElement('div')
            extra.className = 'flowtu-range-rectangle'
            overlay.append(extra)
            rectangles.push(extra)
        }
        for (let i=0; i<rectangles.length; i++) {
            const rect = rectangles[i], row = rows[i]
            rect.hidden = i >= rows.length
            if (rect.hidden) continue
            rect.style.left = `${range.unitToX(selection.start)}px`
            rect.style.width = `${Math.max(1,range.unitToX(selection.end)-range.unitToX(selection.start))}px`
            rect.style.top = row ? `${row.position-manager.scrollableContainer.scrollTop+RegionLabel.labelHeight()}px` : '0'
            rect.style.height = row ? `${Math.max(1,row.size-RegionLabel.labelHeight())}px` : '100%'
        }
        const seconds=project.tempoMap.ppqnToSeconds(selection.end)-project.tempoMap.ppqnToSeconds(selection.start)
        label.textContent=seconds>0?`${formatTimelineTime(seconds,timeSettings.display,getFrameRate(timeSettings.fps))}`:''
    }
    const hit=(event:PointerEvent)=>{
        const mode=String(editingTool.getValue());if(mode!=='select'&&mode!=='range')return undefined
        const target=capturing.captureEvent(event)
        if (!target) return
        const region = target.type === 'region' ? target.region : undefined
        const lane = target.type === 'region' ? target.region.trackBoxAdapter.unwrap() : target.track.trackBoxAdapter
        if (mode==='select' && event.shiftKey && lane.type!==TrackType.Value) return
        const track = manager.tracks().find(t => t.trackBoxAdapter === manager.displayTrack(lane))
        if (!track) return
        const automation = isEnvelopeTrack(lane)
        if (!automation && (event.altKey || event.metaKey || event.ctrlKey)) return
        const rect = element.getBoundingClientRect()
        if (mode === 'select' && !automation && (target.type !== 'region' || target.part !== 'range')) return
        return {track,lane,rect,region}
    }
    const pointerdown=(event:PointerEvent)=>{
        if(event.button!==0)return
        cancelGesture?.()
        const target=hit(event)
        if(!target){followSelectedClips(project);return}
        event.preventDefault();event.stopImmediatePropagation();element.focus({preventScroll:true})
        const restoreSelection = rememberTimelineSelection(project)
        const previousFocus = project.timelineFocus.track.unwrapOrUndefined()
        const previousClips = project.regionSelection.selected().slice(), track = target.lane
        const maximum=Math.max(range.unitMax,...track.regions.collection.asArray().map(r=>r.complete))+PPQN.Bar
        const snap=(value:number,e:PointerEvent)=>e.shiftKey?Math.round(value):service.timeline.snapping.round(value)
        const anchor=snap(range.xToUnit(event.clientX-target.rect.left),event)
        project.timelineFocus.focusTrack(track)
        project.regionSelection.deselectAll()
        // A point range may collapse to a single seek click. Never leave its whole region selected for Delete.
        if (target.region && track.type !== TrackType.Value) project.regionSelection.select(target.region)
        target.track.audioUnitBoxAdapter.ifSome(unit=>{if(!project.userEditingManager.audioUnit.isEditing(unit.box.editing))project.editing.modify(()=>project.userEditingManager.audioUnit.edit(unit.box.editing),true)})
        const update=(e:PointerEvent)=>{
            const rect=element.getBoundingClientRect()
            const next=normalizeAudioRange(anchor,snap(range.xToUnit(e.clientX-rect.left),e),maximum)
            if (track.type !== TrackType.Audio && track.type !== TrackType.Value) {
                setTimelineSelection(project,next)
                return
            }
            const rows=manager.tracks(), from=rows.findIndex(row=>row.trackBoxAdapter===target.track.trackBoxAdapter)
            if (from<0) return
            const y=e.clientY-rect.top+manager.scrollableContainer.scrollTop
            const to=Math.min(rows.length-1,manager.localToIndex(y))
            const owners=from===to ? [track] : rows.slice(Math.min(from,to),Math.max(from,to)+1)
                .filter(row=>row.trackBoxAdapter.type===track.type)
                .flatMap(row=>manager.playbackLanes(row.trackBoxAdapter))
            if (owners.length > 1 && project.regionSelection.nonEmpty()) project.regionSelection.deselectAll()
            setTimelineSelection(project,next,track,owners)
        }
        dragging=true;element.setPointerCapture(event.pointerId);update(event)
        let lastPointer=event, scrollFrame=0
        const extendAtEdge=()=>{
            scrollFrame=0
            const scroller=manager.scrollableContainer, {top,bottom}=scroller.getBoundingClientRect()
            const y=lastPointer.clientY, margin=18
            const delta=y<top+margin ? -Math.min(16,top+margin-y) : y>bottom-margin ? Math.min(16,y-bottom+margin) : 0
            const previous=manager.scrollModel.position
            if (!delta || Math.abs(y-event.clientY)<5) return
            manager.scrollModel.moveBy(delta)
            if (manager.scrollModel.position===previous) return
            update(lastPointer)
            scrollFrame=requestAnimationFrame(extendAtEdge)
        }
        const move=(e:PointerEvent)=>{
            if(e.pointerId!==event.pointerId)return
            e.preventDefault();e.stopImmediatePropagation()
            lastPointer=e
            update(e)
            if (!scrollFrame && Math.abs(e.clientY-event.clientY)>=5) scrollFrame=requestAnimationFrame(extendAtEdge)
        }
        const cleanup=()=>{if(scrollFrame)cancelAnimationFrame(scrollFrame);dragging=false;window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',cancel,true);window.removeEventListener('blur',restore);element.removeEventListener('lostpointercapture',lost);if(element.hasPointerCapture(event.pointerId))element.releasePointerCapture(event.pointerId);finishing=undefined;cancelGesture=undefined;paint()}
        const up=(e:PointerEvent)=>{
            if(e.pointerId!==event.pointerId)return
            e.stopImmediatePropagation();update(e);cleanup()
            if(getTimelineSelection(project)){locateScoringRange(project);finishTimelineRangeGesture(project)}
            else {clearAudioRange(project);seekTimeline(project, Math.max(0,anchor))}
        }
        const restore=()=>{
            project.regionSelection.deselectAll()
            project.regionSelection.select(...previousClips.filter(clip=>clip.box.isAttached()))
            if (previousFocus?.box.isAttached()) project.timelineFocus.focusTrack(previousFocus)
            restoreSelection();cleanup()
        }
        const cancel=(e:PointerEvent)=>{if(e.pointerId===event.pointerId)restore()}
        const lost=(e:PointerEvent)=>{if(e.pointerId===event.pointerId&&dragging)restore()}
        finishing=cleanup;cancelGesture=restore;window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',cancel,true);window.addEventListener('blur',restore);element.addEventListener('lostpointercapture',lost)
    }
    const keydown=(event:KeyboardEvent)=>{
        if(event.key==='Escape'&&dragging){event.preventDefault();event.stopImmediatePropagation();cancelGesture?.();return}
        if(event.key==='Escape' && getTimelineSelection(project)){
            event.preventDefault();event.stopImmediatePropagation();clearAudioRange(project);return
        }
        if(!getAudioRange(project))return
        const key=event.key.toLowerCase(),command=event.metaKey||event.ctrlKey
        if(!['delete','backspace','escape'].includes(key)&&!(command&&['b','x','c'].includes(key)))return
        event.preventDefault();event.stopImmediatePropagation()
        finishing?.()
        try{
            if(command&&(key==='x'||key==='c')){copySelectedAudioRange(project,key==='x');showRangeNotice(key==='x'?'Audio range cut. Paste it at the playhead.':'Audio range copied. Paste it at the playhead.')}
            else performAudioRangeEdit(project,command&&key==='b'?'split':'delete')
        }catch(error){showRangeNotice(error instanceof Error?error.message:String(error))}
    }
    element.addEventListener('pointerdown',pointerdown,true);element.addEventListener('keydown',keydown,true)
    const changes=subscribeTimelineSelection(project,paint),subscription=range.subscribe(paint)
    const settings=subscribeTimeSettings(paint)
    manager.scrollableContainer.addEventListener('scroll',paint,{passive:true})
    lifecycle.own({terminate:()=>{finishing?.();changes.terminate();settings();subscription.terminate();manager.scrollableContainer.removeEventListener('scroll',paint);overlay.remove();element.removeEventListener('pointerdown',pointerdown,true);element.removeEventListener('keydown',keydown,true)}})
}
