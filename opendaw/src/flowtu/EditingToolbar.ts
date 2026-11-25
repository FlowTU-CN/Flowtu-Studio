import {duplicateRegions} from "./duplicate-regions"
import {deleteScoringRegion} from "./scoring-model"
import {navigateWithProfile} from './profile-navigation'
import {editEnvelopeRange,pasteEnvelopePoints,RepeatedAutomationError} from './envelope-range'
import {getEnvelopeRange,timelineTrackOrder} from './timeline-selection'
import {checkPasteTracks} from './range-clipboard'
import {openReplacement} from './RangeReplacement'
import {UUID} from '@opendaw/lib-std'
import {cutWithCrossfade} from "./crossfades"
import {StudioService} from '../service/StudioService'
import {AudioUnitBoxAdapter,UnionAdapterTypes} from '@opendaw/studio-adapters'
import {editingTool,toolHints,type EditingTool} from './editing-state'
import {installEnvelopeTools} from './EnvelopeTools'
import './editing-toolbar.css'
import {editClipboard,hasEditingClipboard,getEditingClipboard} from './editing-clipboard'
import {toolForKey, toolKeyLabel, onKeyProfileChange, profileSplit} from './tool-shortcuts'
import {installTrackpadZoom} from './TrackpadZoom'
import {createToolbarMenu} from './ToolbarMenu'
import {PanelType} from '../ui/workspace/PanelType'
import {TrackBox} from '@opendaw/studio-boxes'
import {trackHeights} from '../ui/timeline/tracks/audio-unit/TrackHeight'
import {openTrackFolderEditor} from './track-folders'
import {showRangeNotice,installRangeTools,handleRangeBlade,getAudioRange,performAudioRangeEdit,copySelectedAudioRange,clearAudioRange} from './RangeSelection'

import {setWorkArea} from './work-area'
import {getTimelineSelection, getExplicitTimelineSelection, loopTimelineSelection} from './timeline-selection'

export function installEditingToolbar(service:StudioService,bar:HTMLElement) {
    const root=document.createElement('section');root.className='flowtu-editing-toolbar';root.setAttribute('aria-label','Audio editing toolbar')
    const row = document.createElement('div')
    row.className = 'edit-main-row'
    const toolMenu = createToolbarMenu('Smart'), actions = createToolbarMenu('Actions'), snapMenu = createToolbarMenu('Snap')
    const menus = [toolMenu, actions, snapMenu]
    toolMenu.element.classList.add('edit-tool-picker')
    actions.trigger.setAttribute('aria-label', 'Timeline actions')
    snapMenu.trigger.setAttribute('aria-label', 'Snap options')
    snapMenu.trigger.title = 'Snap targets and grid'
    const info = document.createElement('div'), status = document.createElement('output')
    info.className = 'edit-info'
    status.className = 'edit-selection'
    status.setAttribute('aria-live', 'polite')
    info.append(status)
    const magnet = document.createElement('div')
    magnet.className = 'edit-magnet'
    row.append(toolMenu.element, magnet, actions.element, info)
    root.append(row)

    const section = (label: string) => {
        const details = document.createElement('details'), summary = document.createElement('summary')
        details.name = actions.panel.id
        summary.textContent = label
        const body = document.createElement('div')
        body.className = 'edit-commands'
        details.append(summary, body)
        actions.panel.append(details)
        return body
    }
    const commands = section('Edit'), view = section('View'), automation = section('Automation'), selection = section('Selection')
    const modes: {id: EditingTool, label: string, icon: string}[] = [
        {id:'select', label:'Smart', icon:'M5 3v17l5-5 4 6 3-2-4-6 7-1Z'},
        {id:'trim', label:'Trim', icon:'M8 3v18M16 3v18M2 12h4m-4 0 3-3m-3 3 3 3m17-3h-4m4 0-3-3m3 3-3 3'},
        {id:'range', label:'Range selection', icon:'M5 5v14h14V5ZM2 9v6m20-6v6'},
        {id:'cut', label:'Blade', icon:'M8.5 8.5 20 20M8.5 15.5 20 4M9 6.5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0ZM9 17.5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z'},
        {id:'fade', label:'Fade', icon:'M3 19 14 5h7M3 19h18'},
        {id:'mute', label:'Mute', icon:'M4 9h4l5-4v14l-5-4H4ZM17 9l5 6m0-6-5 6'},
        {id:'erase', label:'Erase', icon:'m4 14 9-11 8 7-8 10H9Zm3-4 9 7m-4 3h9'}
    ]
    const svg = (path: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`
    const triggerIcon = document.createElement('span')
    triggerIcon.className = 'edit-tool-icon'
    toolMenu.trigger.prepend(triggerIcon)
    const choices = modes.map(mode => {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.tool = mode.id
        button.innerHTML = svg(mode.icon) + `<span>${mode.label}</span><kbd></kbd>`
        button.title = toolHints[mode.id]
        button.setAttribute('aria-label', mode.label + ' tool')
        button.onclick = () => editingTool.setValue(mode.id)
        toolMenu.panel.append(button)
        return {mode, button}
    })
    const refreshTool = () => {
        const active = editingTool.getValue()
        for (const {mode, button} of choices) {
            const key = toolKeyLabel(mode.id)
            button.querySelector('kbd')!.textContent = key
            if (key) button.setAttribute('aria-keyshortcuts',key)
            else button.removeAttribute('aria-keyshortcuts')
            button.setAttribute('aria-pressed', String(mode.id === active))
            if (mode.id !== active) continue
            triggerIcon.innerHTML = svg(mode.icon)
            toolMenu.setLabel(mode.label)
            toolMenu.trigger.title = `${mode.label}${key ? " (" + key + ")" : ""} · ${toolHints[active]}`
            toolMenu.trigger.setAttribute('aria-label', 'Editing tools · ' + mode.label)
        }
    }
    const toolSubscription = editingTool.catchupAndSubscribe(refreshTool)
    const unwatchProfile = onKeyProfileChange(refreshTool)
    const selected=()=>service.hasProfile?service.project.regionSelection.selected().slice():[]
    const editable=()=>{const list=selected();if(!list.length)throw new Error('Select clips in the timeline first.');if(list.some(r=>r.trackBoxAdapter.flatMap(t=>t.optAudioUnit).mapOr(u=>service.project.audioUnitFreeze.isFrozen(service.project.boxAdapters.adapterFor(u,AudioUnitBoxAdapter)),false)))throw new Error('Unfreeze the track first.');return list}
    const run=(action:()=>void,message:string)=>{try{action();status.textContent=message;status.dataset.error='false'}catch(e){status.textContent=e instanceof Error?e.message:String(e);status.dataset.error='true';if (e instanceof RepeatedAutomationError || service.hasProfile && (getEnvelopeRange(service.project) || hasEditingClipboard())) showRangeNotice(status.textContent)}status.title=status.textContent??''}
    const button=(label:string,action:()=>void,selection=false)=>{const el=document.createElement('button');el.type='button';el.textContent=label;el.dataset.editAction=label;el.onclick=()=>run(action,`${label} complete`);if(selection)el.dataset.selection='true';commands.append(el);return el}
    button('Cut',()=>{if(editEnvelopeRange(service.project,'cut'))return;if(getAudioRange(service.project)){copySelectedAudioRange(service.project,true);return}editable();editClipboard('cut')},true)
    button('Copy',()=>{if(editEnvelopeRange(service.project,'copy'))return;if(getAudioRange(service.project)){copySelectedAudioRange(service.project);return}editClipboard('copy')},true)
    const replace=button('Replace selection…',()=>{
        const project=service.project, range=getExplicitTimelineSelection(project)
        if (range?.tracks && range.tracks.length>1) throw new Error('Select a single audio or MIDI clip to replace.')
        const clips=selected().filter(r=>!range || ((!range.track || r.trackBoxAdapter.unwrapOrNull()===range.track) && r.position<range.end && r.complete>range.start))
        const candidates=clips.length ? clips : range?.track?.regions.collection.asArray().filter(r=>r.position<range.end && r.complete>range.start) ?? []
        if(candidates.length!==1) throw new Error('Select one clip or a range within one clip.')
        openReplacement(service,UUID.toString(candidates[0].uuid))
    })
    const paste=()=>{
        if(!service.hasProfile||service.project.timelineFocus.track.isEmpty())throw new Error('Click a destination track, then position the playhead.')
        const track=service.project.timelineFocus.track.unwrap()
        if(pasteEnvelopePoints(service.project,track))return
        if(track.optAudioUnit.mapOr(u=>service.project.audioUnitFreeze.isFrozen(service.project.boxAdapters.adapterFor(u,AudioUnitBoxAdapter)),false))throw new Error('Unfreeze the destination track first.')
        checkPasteTracks(service.project,getEditingClipboard(),timelineTrackOrder(service.project),track)
        const before=new Set(selected())
        editClipboard('paste')
        if(!selected().some(r=>!before.has(r)))throw new Error('The destination track type or count does not match the copied clips.')
    }
    button('Paste',paste)
    button('Split at Cursor',()=>{const regions=editable().filter(UnionAdapterTypes.isLoopableRegion),position=service.engine.position.getValue();if(!regions.some(r=>r.position<position&&r.complete>position))throw new Error('Place the playhead inside the selected clips to split them.');service.project.editing.modify(()=>regions.forEach(r=>cutWithCrossfade(service.project, r,position,true)),true)},true)
    button('Duplicate',()=>duplicateRegions(service.project,editable()),true)
    button('Delete',()=>{if(editEnvelopeRange(service.project,'delete'))return;if(getAudioRange(service.project)){performAudioRangeEdit(service.project,'delete');return}const regions=editable();service.project.editing.modify(()=>regions.forEach(r=>deleteScoringRegion(service.project,r)),true)},true)
    const loop = button('Loop Selection',()=>{loopTimelineSelection(service.project)})
    const undo=button('Undo',()=>service.project.editing.undo()),redo=button('Redo',()=>service.project.editing.redo())
    undo.title = 'Undo · Cmd/Ctrl+Z'
    redo.title = 'Redo · Cmd/Ctrl+Shift+Z'
    const {snapping} = service.timeline
    const snap = document.createElement('button')
    snap.type = 'button'
    snap.setAttribute('aria-label', 'Snapping')
    snap.setAttribute('aria-keyshortcuts', 'N')
    snap.innerHTML = svg('M2 9h7v6H2Zm13 0h7v6h-7ZM12 3v3m0 12v3M7.5 4.5 9 6.5m6 11 1.5 2m0-15-1.5 2m-6 11-1.5 2')
    snap.onclick = () => {snapping.enabled = !snapping.enabled}
    magnet.append(snap, snapMenu.element)
    const sources = [
        ['both', 'Clip edges and grid'], ['edges', 'Clip edges only'], ['grid', 'Grid only']
    ] as const
    const sourceButtons = sources.map(([value, label]) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = label
        button.onclick = () => {
            if (value !== 'edges' && snapping.unit.name === 'Off') snapping.index = snapping.units.findIndex(unit => unit.name === 'Smart')
            snapping.target = value
        }
        snapMenu.panel.append(button)
        return button
    })
    const grid = document.createElement('select')
    grid.setAttribute('aria-label', 'Edit snap grid')
    snapping.units.forEach((unit, i) => grid.add(new Option(unit.name === 'Off' ? 'No grid' : unit.name, String(i))))
    grid.onchange = () => {snapping.index = Number(grid.value)}
    const gridLabel = document.createElement('label')
    gridLabel.className = 'toolbar-menu-field'
    gridLabel.append('Grid spacing', grid)
    snapMenu.panel.append(gridLabel)
    const snapSubscription = snapping.catchupAndSubscribe(() => {
        snap.setAttribute('aria-pressed', String(snapping.enabled))
        const label = sources.find(([value]) => value === snapping.target)![1]
        snap.title = snapping.enabled ? 'Snapping on · ' + label + ' · N' : 'Snapping off · N'
        for (const [i, [value]] of sources.entries()) {
            sourceButtons[i].setAttribute('aria-pressed', String(snapping.target === value))
        }
        grid.value = String(snapping.index)
        grid.disabled = snapping.target === 'edges'
    })
    const editorToggle=document.createElement('button');editorToggle.type='button';editorToggle.textContent='Show Editor';editorToggle.title='Show or hide Editor · Shift+E'
    const refreshEditor=()=>{const visible=service.panelLayout.getByType(PanelType.ContentEditor).isVisible;editorToggle.textContent=visible?'Hide Editor':'Show Editor';editorToggle.setAttribute('aria-pressed',String(visible));editorToggle.disabled=!service.hasProfile}
    editorToggle.onclick=()=>{service.panelLayout.toggleVisibility(PanelType.ContentEditor);refreshEditor()};view.append(editorToggle)
    const heights = document.createElement('select')
    heights.setAttribute('aria-label', 'All track heights')
    heights.add(new Option('Set all…', ''))
    for (const [name, size] of Object.entries(trackHeights)) heights.add(new Option(name, String(size)))
    heights.onchange = () => {
        const size = Number(heights.value)
        heights.selectedIndex = 0
        if (!size || !service.hasProfile) return
        const project = service.project
        project.editing.modify(() => {
            for (const box of project.boxGraph.boxes()) {
                if (box instanceof TrackBox) box.height.setValue(size)
            }
        })
    }
    const heightLabel = document.createElement('label')
    heightLabel.className = 'toolbar-menu-field'
    heightLabel.append('Track height', heights)
    view.append(heightLabel)
    const newFolder = document.createElement('button')
    newFolder.type = 'button'
    newFolder.textContent = 'New track folder…'
    newFolder.onclick = () => {if (service.hasProfile) openTrackFolderEditor(service.project)}
    view.append(newFolder)
    const zoom=(label:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label==='−'?'Zoom Out':label==='＋'?'Zoom In':'Fit Selection / Project';if(label!=='Fit')b.dataset.menuKeepOpen='';b.onclick=action;view.append(b)}
    zoom('−',()=>service.timeline.range.scaleBy(.2,service.timeline.range.center));zoom('＋',()=>service.timeline.range.scaleBy(-.2,service.timeline.range.center));zoom('Fit',()=>{if(!service.hasProfile)return;const range=getTimelineSelection(service.project);if(range)service.timeline.range.zoomRange(range.start,range.end);else service.timeline.range.showAll()})
    const gestures=installTrackpadZoom(service)
    const fullscreen=document.createElement('button');fullscreen.type='button';fullscreen.textContent='Full Screen';fullscreen.title='Full screen workspace · Pinch anywhere to zoom the timeline';view.append(fullscreen)
    const refreshFullscreen=()=>{fullscreen.textContent=gestures.isFullscreen()?'Exit Full Screen':'Full Screen';fullscreen.setAttribute('aria-pressed',String(gestures.isFullscreen()))}
    fullscreen.onclick=()=>{void gestures.toggleFullscreen().then(refreshFullscreen).catch(error=>{status.textContent=error instanceof Error?error.message:String(error);status.dataset.error='true'})}
    document.addEventListener('fullscreenchange',refreshFullscreen);document.addEventListener('webkitfullscreenchange',refreshFullscreen)
    const zoomHint=document.createElement('span');zoomHint.className='edit-zoom-hint';zoomHint.textContent='Pinch anywhere to zoom';view.append(zoomHint)
    installEnvelopeTools(service,automation)
    installRangeTools(service,selection)
    const inspector=bar.querySelector<HTMLButtonElement>('[data-action=audio-tools]')!;inspector.textContent='Clip Inspector · Fades / Gain';commands.append(inspector)
    let selectionSignature = ''
    const timer = setInterval(() => {
        refreshEditor()
        if (!service.hasProfile) return
        const project = service.project, list = selected(), explicit = getExplicitTimelineSelection(project)
        const timelineOnly = explicit && !explicit.track
        loop.disabled = !getTimelineSelection(project)
        replace.disabled=(explicit?.tracks?.length ?? 0)>1 || !list.length && !explicit?.track
        actions.panel.querySelectorAll<HTMLButtonElement>('[data-selection]').forEach(button => {
            const rangeCommand = ['Copy','Cut','Delete'].includes(button.dataset.editAction ?? '')
            button.disabled = !(rangeCommand && explicit?.track) && (list.length === 0 || !!timelineOnly)
        })
        undo.disabled = !project.editing.canUndo()
        redo.disabled = !project.editing.canRedo()
        const sig = explicit ? `range ${explicit.start} ${explicit.end}` : list.map(r => r.label+':'+r.position+':'+r.duration).join('|')
        if (sig === selectionSignature) return
        selectionSignature = sig
        if (explicit && explicit.end > explicit.start) {
            status.textContent = `Time selection · ${project.tempoMap.intervalToSeconds(explicit.start, explicit.end).toFixed(3)} s`
        } else if (list.length === 1) {
            const [clip] = list
            status.textContent = `${clip.label || 'Clip'} · ${project.tempoMap.intervalToSeconds(clip.position,clip.complete).toFixed(2)} s`
        } else {
            status.textContent = list.length ? `${list.length} clips selected` : 'Ready'
        }
        status.title = status.textContent
    }, 200)
    const keys=(e:KeyboardEvent)=>{
        if(e.defaultPrevented||e.isComposing||document.querySelector('dialog[open]')||!(e.target instanceof HTMLElement)||e.target.closest('input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=slider]'))return
        // A focused track header owns Delete even when a previous waveform range is still highlighted.
        if ((e.code === 'Delete' || e.code === 'Backspace') && e.target.closest('[data-flowtu-track-header]')) return
        if(e.target.closest('[data-flowtu-menu]')&&['Escape','Enter',' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Tab'].includes(e.key))return
        if (service.hasProfile && e.code === 'KeyP' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !service.isSoftwareKeyboardVisible()) {
            e.preventDefault()
            e.stopImmediatePropagation()
            if (!e.repeat) {
                const range = getTimelineSelection(service.project)
                if (range) {setWorkArea(service.project, range); status.textContent = 'Loop and export locators set to selection.'}
                else document.querySelector<HTMLButtonElement>('.ft-work-label > button')?.click()
            }
            return
        }
        const timelineTarget=e.target.closest('[data-scope=regions],.project-time-ruler,[data-ruler=bars],.time-axis,.ft-clip-gain-layer,.flowtu-editing-toolbar,.ft-lite-edit-tools,.ft-work-lane,[data-flowtu-unit]')
        if(service.hasProfile
            && (e.metaKey||e.ctrlKey) && e.shiftKey && !e.altKey && e.code==='KeyL' && getTimelineSelection(service.project)){
            e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)loopTimelineSelection(service.project);return
        }
        if(e.target.closest('[data-scope=content-editor]'))return
        if(service.hasProfile && (timelineTarget || e.target===document.body || e.target.closest('[data-flowtu-unit]'))
            && handleRangeBlade(e, service.project, action => run(action, 'Split at selection boundaries.')))return
        if(!timelineTarget && e.target!==document.body)return
        const key=e.key.toLowerCase(),command=e.metaKey||e.ctrlKey
        if (service.hasProfile && navigateWithProfile(e,service.project,service.timeline.range)) return
        const split = profileSplit(e.key,e)
        const splitAtCursor = () => {
            const regions = editable().filter(UnionAdapterTypes.isLoopableRegion), position = service.engine.position.getValue()
            if (!regions.some(r => r.position < position && r.complete > position)) throw new Error('Place the playhead inside a selected clip.')
            service.project.editing.modify(()=>regions.forEach(r=>cutWithCrossfade(service.project,r,position,true)),true)
        }
        if(service.hasProfile && split){
            e.preventDefault(); e.stopImmediatePropagation()
            if (e.repeat) return
            run(()=>{
                if (getExplicitTimelineSelection(service.project)) {performAudioRangeEdit(service.project,'split');return}
                splitAtCursor()
            }, 'Split complete'); return
        }
        if(service.hasProfile&&!e.altKey&&!e.shiftKey){
            const selectedRange=getAudioRange(service.project)
            if(key==='escape'&&!command&&!e.target.closest('[data-scope=regions]')&&getTimelineSelection(service.project)){
                e.preventDefault();clearAudioRange(service.project);return
            }
            if(getEnvelopeRange(service.project) && (command && (key==='c' || key==='x') || !command && ['delete','backspace'].includes(key))){
                e.preventDefault();e.stopImmediatePropagation()
                if(!e.repeat) run(()=>editEnvelopeRange(service.project, command ? (key==='c' ? 'copy' : 'cut') : 'delete'),'Automation points edited.')
                return
            }
            // A time-only range has no target lane for destructive clip commands.
            if(!selectedRange && getExplicitTimelineSelection(service.project) && (['backspace','delete'].includes(key)||command&&['x','c','b'].includes(key))){
                e.preventDefault();e.stopImmediatePropagation();return
            }
            if(command&&key==='v'&&hasEditingClipboard()){e.preventDefault();e.stopImmediatePropagation();run(paste,'Paste complete');return}
            if(selectedRange&&(command&&['c','x','b'].includes(key)||['escape','delete','backspace'].includes(key))){
                // Let the timeline handler own active drag cancellation and its range gestures.
                if(e.target.closest('[data-scope=regions]'))return
                e.preventDefault();e.stopImmediatePropagation();run(()=>{
                    if(key==='escape')clearAudioRange(service.project)
                    else if(command&&(key==='c'||key==='x'))copySelectedAudioRange(service.project,key==='x')
                    else performAudioRangeEdit(service.project,command&&key==='b'?'split':'delete')
                },'Range edit complete');return
            }
            if(command && key === 'b' && !selectedRange){e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) run(splitAtCursor,'Split complete');return}
        }
        if (key === 'n' && !command && !e.shiftKey && !e.altKey) {
            e.preventDefault(); e.stopImmediatePropagation()
            if (!e.repeat) snapping.enabled = !snapping.enabled
            return
        }
        const mode=toolForKey(e.key,e)
        if(mode){e.preventDefault();e.stopImmediatePropagation();menus.forEach(menu=>menu.close());editingTool.setValue(mode)}
    }
    document.addEventListener('keydown',keys,true)
    root.addEventListener('keydown',e=>{if(e.key!=='Tab'&&e.target instanceof HTMLElement&&e.target.closest('input,select,textarea'))e.stopPropagation()})
    window.addEventListener('pagehide',()=>{unwatchProfile();clearInterval(timer);toolSubscription.terminate();snapSubscription.terminate();document.removeEventListener('keydown',keys,true);gestures.dispose();menus.forEach(menu=>menu.dispose());document.removeEventListener('fullscreenchange',refreshFullscreen);document.removeEventListener('webkitfullscreenchange',refreshFullscreen)},{once:true})
    return root
}
