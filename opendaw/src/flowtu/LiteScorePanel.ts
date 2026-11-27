import {mountCueBlocks} from './scoring-cue-lane'
import {AudioUnitBoxAdapter} from '@opendaw/studio-adapters'
import {Terminator, UUID} from '@opendaw/lib-std'
import type {Project} from '@opendaw/studio-core'
import type {StudioService} from '../service/StudioService'
import {tones, type Note, type Tone} from './commands'
import {readLiteMusicContext, shapeLiteTransition} from './lite-music-context'
import {applyLiteToolbarEdit, editLiteRange, type LiteClipAction} from './lite-clip-edit'
import {installLiteTimelineGestures} from './lite-timeline-gestures'
import {snapTimePosition} from './time-snap'
import {requestLiteGuide} from './lite-model'
import {createLiteTrackLanes} from './LiteTrackLanes'
import {installLiteMediaDrop} from './lite-media-drop'
import {installAssetDrag} from './asset-drag'
import {installCloudGenerationPanel} from './CloudGenerationPanel'
import {readDirection} from './scoring-direction'
import {liteTracks} from './lite-track-edit'
import {clearAudioRange, getAudioRange, getExplicitTimelineSelection, getTimelineSelection, setTimelineSelection, subscribeTimelineSelection, loopTimelineSelection} from './timeline-selection'
import {copyTrackRange} from './range-clipboard'
import {editClipboard, setEditingClipboard} from './editing-clipboard'
import {openReplacement} from './RangeReplacement'
import {editingTool} from './editing-state'
import {keyProfile, profileSplit, toolForKey} from './tool-shortcuts'
import {navigateWithProfile} from './profile-navigation'
import {setWorkArea} from './work-area'
import {isAssetLane} from './playback-lanes'
import {cueLabel, focusScoringTake, generateScoringMidi, readScoring, readScoringTakes, takeMembers, takeOwner, takeRegion, useScoringTake, writeScoring, type ScoringCue} from './scoring-model'
import {clearScoringSelection, scoringSelectionSeconds, wasScoringSelectionCleared, getSelectedScoringCue, requestScoringCue, setSelectedScoringCue, subscribeScoringSelection} from './scoring-selection'
import {tr, watchStudioLanguage} from './studio-language'
import {createTakeAudition} from './take-audition'
import {formatTimelineTime, frameToSeconds, getFrameRate} from './time-format'
import {subscribeTimeSettings, timeSettings} from './time-settings'
import {timelinePosition} from './timeline-seek'
import {createLiteComposerDock} from './LiteComposerDock'

type LitePanelAPI = {
    getVideo(): {duration: number; offset: number; ready: boolean; url?: string; file?: File}
    markCue(): boolean
    beforeGenerate?():void
    cloud?: {saveProjectForGeneration(name: string, generationKey: string): Promise<void>;
        cloudProjectId(): string | undefined;
        generationScope(): string | undefined;
        addToProject(song: {songKey: string; title: string; durationMs?: number; playUrl: string | null}): Promise<void>}
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string) {
    const el = document.createElement(tag)
    el.className = `ft-lite-${cls}`
    return el
}
function takeButton(cls: string, text: string) {
    const button = node('button', cls)
    button.type = 'button'; button.textContent = text
    return button
}
function clock(seconds: number) {
    return formatTimelineTime(seconds, timeSettings.display, getFrameRate(timeSettings.fps)).replace(/^00:/, '')
}
function rulerTime(seconds: number) {
    const total = Math.round(seconds * 10) / 10, whole = Math.floor(total)
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}${total === whole ? '' : '.' + Math.round((total-whole)*10)}`
}
/** A view of the current project. Cue metadata, instrument tracks, selections and transport belong to Studio. */
export function createLiteScorePanel(service: StudioService, api: LitePanelAPI) {
    const inspector = node('aside', 'inspector'), timeline = node('section', 'timeline')
    const head = node('header', 'section-head'), title = document.createElement('h2'), badge = node('span', 'cue-badge')
    const range = node('div', 'range'), prompt = node('textarea', 'prompt'), compose = node('div', 'compose')
    const tone = node('select', 'tone'), generate = takeButton('generate', ''), takes = node('div', 'takes')
    const takesTitle = document.createElement('h3'), takeList = node('div', 'take-list'), status = node('output', 'status')
    prompt.maxLength = 500; prompt.rows = 3
    for (const key of Object.keys(tones)) tone.add(new Option('', key))
    head.append(title, badge); compose.append(tone, generate); takes.append(takesTitle, takeList)
    inspector.append(head, range, prompt, compose, takes, status)
    const dock = createLiteComposerDock(prompt, generate, status, {clearSelection: () => {
        if (!project) return
        run(commit); cancelGeneration(); audition.stop(); clearScoringSelection(project); tell(); schedule()
    }})
    const timelineHead = node('header', 'section-head'), timelineTitle = document.createElement('h2'), mark = takeButton('mark', '')
    timelineHead.append(timelineTitle, mark)
    timeline.append(timelineHead)
    const desktop = matchMedia('(min-width: 900px)')
    let touchEditor: ReturnType<typeof mountTouchTimeline> | undefined
    const audition = createTakeAudition(service), life = new Terminator()
    const graphLife = new Terminator(), takeDrags=life.own(new Terminator())
    let project: Project | undefined, fieldCue: string | undefined, hasDraft = false, active = false
    let queued = false, disposed = false, videoSignature = '', previewId: string | undefined
    const selected = (state: ReturnType<typeof readScoring>) => state.cues.find(c => c.id === getSelectedScoringCue(project!)) ?? (wasScoringSelectionCleared(project!) ? undefined : state.cues[0])
    function targetDirection(p:Project,state:ReturnType<typeof readScoring>,cue:ScoringCue|undefined) {
        if (cue || !wasScoringSelectionCleared(p)) return cue ?? state
        const bounds=scoringSelectionSeconds(p)
        return bounds ? {...state,...bounds} : undefined
    }
    let pending: {controller:AbortController; cueId?:string; signature:string; video:string; file?:File} | undefined
    const videoIdentity = () => {
        const info = api.getVideo()
        return JSON.stringify([info.ready,info.url,info.offset,info.duration])
    }
    function cancelGeneration() {
        if (!pending) return
        pending.controller.abort(); pending = undefined
        tell(); schedule()
    }
    function tell(message?: string, error = false) {
        status.dataset.error = String(error)
        status.dataset.idle = String(!message)
        status.textContent = message ?? tr('Local MIDI · Editable in Studio')
        status.title = status.textContent
    }
    function run(action: () => void) {
        try {action()} catch (err) {tell(err instanceof Error ? err.message : String(err), true)}
    }
    function commit() {
        if (!project || !hasDraft || !service.hasProfile || service.project !== project) return
        const state = readScoring(project), cue = state.cues.find(c => c.id === fieldCue)
        if (fieldCue && !cue) {hasDraft = false; return}
        const direction = {prompt: prompt.value.trim(), tone: tone.value as Tone}, old = cue ?? state
        hasDraft = false
        if (direction.prompt !== old.prompt || direction.tone !== old.tone) {
            writeScoring(project, {...state, ...direction, cues: state.cues.map(c => c.id === fieldCue ? {...c, ...direction} : c)})
        }
    }
    prompt.oninput = () => {cancelGeneration(); hasDraft = true; schedule()}
    prompt.onchange = () => run(commit)
    tone.onchange = () => run(() => {cancelGeneration(); hasDraft = true; commit()})
    // Cloud generation shares the lite prompt; the range stays selection-driven as elsewhere in this view.
    const cloudApi = api.cloud
    const cloudGeneration = cloudApi ? installCloudGenerationPanel({
        currentInput: () => {
            if (!project || !service.hasProfile || service.project !== project) return undefined
            const state = readScoring(project), cue = selected(state)
            const range = targetDirection(project, state, cue)
            if (!range) return undefined
            const owner = cue ?? state
            return {prompt: prompt.value.trim() || owner.prompt, start: range.start, end: range.end,
                direction: owner.direction, style: owner.direction?.style ?? 'prompt'}
        },
        applyInput: input => run(() => {
            if (!project) return
            const state = readScoring(project)
            prompt.value = input.prompt
            const direction = input.direction ? readDirection(input.direction) : undefined
            const rangeOk = Number.isFinite(input.start) && Number.isFinite(input.end) && input.end > input.start
            writeScoring(project, {...state, prompt: input.prompt, start: rangeOk ? input.start : state.start,
                end: rangeOk ? input.end : state.end, ...(direction ? {direction} : {}), cues: state.cues})
            hasDraft = false
            schedule()
        }),
        saveProjectForGeneration: (name, generationKey) => cloudApi.saveProjectForGeneration(name, generationKey),
        cloudProjectId: () => cloudApi.cloudProjectId(),
        generationScope: () => cloudApi.generationScope(),
        addToProject: song => cloudApi.addToProject(song)
    }, document.createElement('div')) : undefined
    if (cloudGeneration) inspector.insertBefore(cloudGeneration.element, takes)
    async function generateVersion() {
        const p = project
        if (!p || pending) return
        api.beforeGenerate?.()
        commit()
        const state = readScoring(p), cue = selected(state), direction = targetDirection(p,state,cue), video = api.getVideo()
        if (!direction) return
        if (video.ready && (direction.start < Math.max(0, video.offset) - .01 || direction.end > video.offset + video.duration + .01)) {
            throw new Error(tr('Keep the cue inside the reference video.'))
        }
        let notes: Note[] | undefined
        if (window.flowtuScoringModel?.composeMidi) {
            const request = {controller:new AbortController(), cueId:cue?.id, signature:JSON.stringify(direction), video:videoIdentity(), file:video.file}
            pending = request; generate.disabled = true; tell(tr('Composing this cue…'))
            try {
                notes = await requestLiteGuide(p, direction, request.controller.signal)
                if (request.controller.signal.aborted || !active || !service.hasProfile || service.project !== p) return
                const latest = readScoring(p), current = selected(latest)
                if (current?.id !== request.cueId || request.video !== videoIdentity() || request.file !== api.getVideo().file || JSON.stringify(targetDirection(p,latest,current)) !== request.signature) return
            } catch (error) {
                if (request.controller.signal.aborted) return
                throw error
            } finally {
                if (pending === request) {pending = undefined; schedule()}
            }
        }
        audition.stop(); service.engine.stop()
        const context = notes ? undefined : readLiteMusicContext(p, direction.start, direction.end)
        const result = p.editing.modify(() => {
            const generated = generateScoringMidi(p,direction,cue?.id,notes)
            if (context) shapeLiteTransition(p,generated.regionId,context)
            useScoringTake(p,generated.cueId,generated.regionId)
            return generated
        },true).unwrap()
        requestScoringCue(p, result.cueId)
        if (desktop.matches) focusScoringTake(p,result.regionId,{openEditor:false})
        tell(tr('MIDI take added to the project.')); schedule()
    }
    generate.onclick = () => {void generateVersion().catch(error => tell(error instanceof Error ? error.message : String(error),true))}
    prompt.onkeydown = event => {
        const sendKey = desktop.matches ? !event.shiftKey : event.ctrlKey || event.metaKey
        if (event.key === 'Enter' && sendKey && !event.isComposing && event.keyCode !== 229) {
            event.preventDefault()
            if (!event.repeat) generate.click()
        }
        if (event.key !== 'Tab') event.stopPropagation()
    }
    tone.onkeydown = event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
            event.preventDefault(); generate.click()
        }
        if (event.key !== 'Tab') event.stopPropagation()
    }
    mark.onclick = () => run(() => {
        commit()
        const info = api.getVideo()
        if (project && info.ready) {
            const at = project.tempoMap.ppqnToSeconds(timelinePosition(project))
            if (at < Math.max(0, info.offset) || at >= info.offset + info.duration) throw new Error(tr('Keep the cue inside the reference video.'))
        }
        api.markCue(); schedule()
    })
    function drawTakes(cue?: ScoringCue) {
        takeDrags.terminate()
        takeList.replaceChildren()
        const versions = project && cue ? readScoringTakes(project, cue) : []
        if (!versions.length) {
            const empty = node('p', 'empty'); empty.textContent = tr('Generate a MIDI take for this cue.'); takeList.append(empty); return
        }
        const p = project!
        const editable = versions.flatMap(v => {
            const region = takeRegion(p, v.id), owner = region?.trackBoxAdapter.unwrapOrNull()
            return region && owner && owner.enabled.getValue() && !isAssetLane(owner) ? [{id:v.id, region}] : []
        })
        const playing = editable.filter(t => !t.region.mute)
        versions.forEach(v => {
            const row = node('div', 'take-row'), listen = takeButton('take', ''), play = document.createElement('b')
            const name = document.createElement('span'), time = document.createElement('small')
            listen.dataset.takeId = v.id; listen.setAttribute('aria-label', tr('Audition take {0}', v.number))
            name.textContent = tr('Take {0}', v.number); time.textContent = rulerTime(v.end-v.start); play.setAttribute('aria-hidden','true')
            listen.append(play, name, time); row.append(listen)
            listen.onclick = () => {void audition.play(v.id).catch(error => {if (active && project === p) tell(String(error), true)}); updateAudition()}
            if (editable.some(t => t.id === v.id)) {
                const used = playing.length === 1 && playing[0].id === v.id, use = takeButton('use', tr(used ? 'In mix' : 'Use take'))
                use.setAttribute('aria-pressed', String(used)); use.title = tr('Use only this take in the cue mix')
                use.onclick = () => run(() => {audition.stop(); useScoringTake(p,cue!.id,v.id); schedule()})
                row.append(use)
            }
            takeDrags.own(installAssetDrag(listen,p,v.id,cue ? takeMembers(cue,v.id) : undefined))
            takeList.append(row)
        })
        updateAudition(true)
    }
    function updateAudition(force = false) {
        const next = audition.current()
        if (!force && next === previewId) return
        previewId = next
        for (const el of takeList.querySelectorAll<HTMLButtonElement>('button[data-take-id]')) {
            const listening = el.dataset.takeId === next
            el.setAttribute('aria-pressed', String(listening)); el.querySelector('b')!.textContent = listening ? '■' : '▶'
        }
    }
    function draw() {
        if (!active || disposed) return
        const p = project, state = p ? readScoring(p) : undefined, cue = state && selected(state)
        const direction = p && state ? targetDirection(p,state,cue) : undefined
        if (pending && (pending.cueId !== cue?.id || pending.signature !== JSON.stringify(direction))) cancelGeneration()
        if (hasDraft && cue?.id !== fieldCue) run(commit)
        if (!hasDraft && state) {prompt.value = (cue ?? state).prompt; tone.value = (cue ?? state).tone}
        fieldCue = cue?.id; if (!state) prompt.value = ''
        generate.disabled = !direction || !!pending || !prompt.value.trim(); mark.disabled = tone.disabled = prompt.disabled = !p
        badge.textContent = cue && state ? tr('Cue {0}', cueLabel(state,cue)) : tr('Score this range')
        range.textContent = direction ? `${clock(direction.start)}  –  ${clock(direction.end)}` : ''
        dock.setScope(direction ? cue?.name || badge.textContent : '', range.textContent, !!cue || !!(p && getTimelineSelection(p)))
        touchEditor?.draw(state, cue)
        drawTakes(cue)
    }
    function schedule() {
        if (queued || !active || disposed) return
        queued = true; queueMicrotask(() => {queued = false; draw()})
    }
    function syncTouchEditor() {
        dock.setActive(active && desktop.matches)
        touchEditor?.dispose()
        touchEditor = active && !desktop.matches && project ? mountTouchTimeline(service, project, timelineHead, mark, {
            getVideo:api.getVideo, tell, run, schedule, beforeEdit:()=>{commit(); audition.stop()}
        }) : undefined
        schedule()
    }
    function refresh() {
        if (!active || disposed) return
        const next = service.hasProfile ? service.project : undefined
        if (next !== project) {
            cancelGeneration(); graphLife.terminate(); audition.stop(); project = next; fieldCue = undefined; hasDraft = false
            syncTouchEditor()
            if (next) {
                graphLife.ownAll(subscribeTimelineSelection(next,schedule), next.editing.subscribe(schedule), next.tempoMap.subscribe(schedule),
                    {terminate:subscribeScoringSelection(next,schedule)})
                let selectionQueued=false
                const followTake=()=>{
                    if (selectionQueued || !desktop.matches) return
                    selectionQueued=true
                    queueMicrotask(()=>{
                        selectionQueued=false
                        if (!active || project!==next || !desktop.matches) return
                        const regions=next.regionSelection.selected()
                        if (regions.length!==1) return
                        const id=UUID.toString(regions[0].uuid),owner=readScoring(next).cues.find(c=>takeOwner(c,id))
                        if (owner && owner.id!==getSelectedScoringCue(next)) {
                            run(commit); audition.stop()
                            setSelectedScoringCue(next,owner.id)
                        }
                    })
                }
                graphLife.own(next.regionSelection.subscribe({onSelected:followTake,onDeselected:followTake}))
            }
            tell(); schedule()
        }
        if (pending && (pending.video !== videoIdentity() || pending.file !== api.getVideo().file)) cancelGeneration()
        const v = api.getVideo(), sig = `${v.duration}:${v.offset}:${v.ready}`
        if (sig !== videoSignature) {videoSignature = sig; schedule()}
        updateAudition()
    }
    function labels() {
        title.textContent = tr('Music direction'); timelineTitle.textContent = tr('Score timeline'); takesTitle.textContent = tr('Music takes')
        mark.textContent = `＋ ${tr('Mark cue')}`; generate.textContent = tr('Generate MIDI')
        prompt.setAttribute('aria-label', title.textContent); tone.setAttribute('aria-label', tr('Default instrument'))
        for (const option of tone.options) option.text = tr(tones[option.value as Tone].label)
        dock.labels(); tell(); schedule()
    }
    desktop.addEventListener('change',syncTouchEditor)
    const settings = subscribeTimeSettings(schedule), unwatch = watchStudioLanguage(labels)
    life.own(service.projectProfileService.subscribe(refresh)); labels()
    let clockTimer: ReturnType<typeof setInterval> | undefined
    function setActive(value: boolean) {
        if (value === active || disposed) return
        if (!value) run(commit)
        active = value
        dock.setActive(active && desktop.matches)
        if (active) {refresh(); schedule(); clockTimer = setInterval(refresh,250)}
        else {syncTouchEditor(); cancelGeneration(); clearInterval(clockTimer); audition.stop(); graphLife.terminate(); project = undefined; fieldCue = undefined; hasDraft = false}
    }
    return {inspector, timeline, dock: dock.element, setActive, refresh, dispose() {
        setActive(false); disposed = true; life.terminate(); graphLife.terminate()
        cloudGeneration?.dispose()
        desktop.removeEventListener('change',syncTouchEditor); settings(); unwatch(); audition.dispose(); dock.dispose(); inspector.remove(); timeline.remove()
    }}
}

// The touch editor owns its DOM and input listeners only while the small-screen view is in use.
function mountTouchTimeline(service: StudioService, project: Project, timelineHead: HTMLElement, mark: HTMLButtonElement, hooks: {
    getVideo: LitePanelAPI['getVideo']; tell(message?:string,error?:boolean):void; run(action:()=>void):void
    schedule():void; beforeEdit():void
}) {
    const {run,tell,schedule,beforeEdit}=hooks
    const life=new Terminator()
    let extent=8
    const arrangement = node('div', 'arrangement'), ruler = node('div', 'ruler'), lanes = node('div', 'lanes')
    const cueLane = node('div', 'cue-lane'), clipLane = node('div', 'tracks'), playhead = node('div', 'playhead')
    playhead.setAttribute('aria-hidden','true')
    const rulerRow=node('div','ruler-row'), axisLabel=node('div','axis-label'), cueRow=node('div','cue-row'), cueLabelCell=node('div','cue-label')
    const playDomain=node('div','play-domain')
    playDomain.append(playhead)
    rulerRow.append(axisLabel,ruler);cueRow.append(cueLabelCell,cueLane)
    lanes.append(cueRow,clipLane,playDomain);arrangement.append(rulerRow,lanes);timelineHead.after(arrangement)
    const clipTools = node('nav','clip-tools'), selectionLabel = node('strong','selected-label')
    arrangement.after(clipTools); clipTools.append(selectionLabel)
    const editCaptions = {split:'Split','trim-start':'Trim left','trim-end':'Trim right',duplicate:'Duplicate',delete:'Delete',replace:'Replace range…',undo:'Undo',redo:'Redo'} as const
    const toolButtons = new Map<keyof typeof editCaptions,HTMLButtonElement>()
    for (const [action, caption] of Object.entries(editCaptions)) {
        const key = action as keyof typeof editCaptions, button = takeButton('edit-action',tr(caption))
        button.dataset.clipAction = key; button.onclick = () => run(() => actionAtPlayhead(key))
        toolButtons.set(key,button); clipTools.append(button)
    }
    const operations = node('select','more-actions')
    const toolModes={'smart':'select','range-tool':'range','blade-tool':'cut','trim-tool':'trim','fade-tool':'fade','mute-tool':'mute','erase-tool':'erase'} as const
    const extraActions = {'smart':'Smart','range-tool':'Range selection','blade-tool':'Blade','trim-tool':'Trim','fade-tool':'Fade','mute-tool':'Mute','erase-tool':'Erase',
        'range-in':'Set range in','range-out':'Set range out','clear':'Clear Range','copy':'Copy','cut':'Cut','paste':'Paste','copy-drag':'Copy on drag'} as const
    type Extra = keyof typeof extraActions
    let copyDrag = false
    operations.add(new Option('', ''))
    for (const [key,caption] of Object.entries(extraActions)) operations.add(new Option(tr(caption),key))
    operations.onchange = () => {
        const action=operations.value as Extra; operations.selectedIndex=0
        run(()=>actionAtPlayhead(action)); operations.blur()
    }
    clipTools.append(operations)
    let selectedId: string | undefined
    const trackLanes = createLiteTrackLanes({container:clipLane,project:()=>project,extent:()=>extent,snap:snapped,clock,
        selected:()=>selectedId,copyDrag:()=>copyDrag,run,
        pick:(p,clip)=>{
            beforeEdit()
            const state=readScoring(p), owner=state.cues.find(c=>takeOwner(c,clip.id))
            if(owner && owner.id!==getSelectedScoringCue(p)) requestScoringCue(p,owner.id)
            const previous=p.regionSelection.selected()
            if(previous.length!==1 || previous[0]!==clip.region) {
                p.regionSelection.deselectAll(); p.regionSelection.select(clip.region)
            }
            p.timelineFocus.focusRegion(clip.region)
            selectedId=clip.id
        },
        changed:id=>{selectedId=id;updatePosition();schedule()}
    })
    const gestures = installLiteTimelineGestures(arrangement,lanes,ruler,() => project,() => extent,updatePosition,trackLanes.gesture)
    life.own(installLiteMediaDrop(clipLane,service,()=>extent,snapped,tell))
    const redrawCues=mountCueBlocks(cueLane,service,life,{
        timeAt:x=>extent*x/Math.max(1,cueLane.clientWidth), xAt:time=>time*cueLane.clientWidth/extent, snapPulse:pulse=>snapped(project,pulse)
    },35)
    timelineHead.insertBefore(gestures.controls, mark)
    function snapped(project:Project, pulse:number) {
        const snapping=service.timeline.snapping
        if (!snapping.gridEnabled) return Math.round(pulse)
        if (snapping.unit.timeGrid) return snapping.round(pulse)
        const interval = timeSettings.display === 'time' ? .01 : frameToSeconds(1,getFrameRate(timeSettings.fps))
        return snapTimePosition(project.tempoMap,pulse,interval,"round")
    }
    function actionAtPlayhead(action: LiteClipAction | Extra | 'replace' | 'undo' | 'redo') {
        const p=project
        if (!p) return
        beforeEdit()
        if (action==='undo' || action==='redo') {p.editing[action]();schedule();return}
        const clip=selectedId ? takeRegion(p,selectedId) : undefined
        const pulse=snapped(p,timelinePosition(p)), selection=getAudioRange(p)
        if(action in toolModes || action==='copy-drag'){
            copyDrag=action==='copy-drag' && !copyDrag
            editingTool.setValue(action==='copy-drag'?'select':toolModes[action as keyof typeof toolModes]);updateMenu();return
        }
        if(action==='clear'){clearAudioRange(p);return}
        if(action==='replace'){if(clip&&selectedId)openReplacement(service,selectedId);return}
        if(action==='range-in'||action==='range-out'){
            if(!clip)throw new Error(tr('Tap a clip to edit'))
            const owner=clip.trackBoxAdapter.unwrap(), previous=selection?.track===owner ? selection : undefined
            const point=Math.min(Math.round(clip.complete),Math.max(clip.position,pulse))
            const span=action==='range-in' ? {start:point,end:previous && previous.end>point ? previous.end : Math.round(clip.complete)}
                : {start:previous && previous.start<point ? previous.start : clip.position,end:point}
            setTimelineSelection(p,span,owner);return
        }
        if(action==='copy' || action==='cut' || action==='paste'){
            if (p.engine.isPlaying.getValue())throw new Error(tr('Stop playback first.'))
            const target=p.timelineFocus.track.unwrapOrNull()
            if(action!=='copy' && target && p.audioUnitFreeze.isFrozen(p.boxAdapters.adapterFor(target.audioUnit,AudioUnitBoxAdapter))) throw new Error('Unfreeze this track first.')
            if(action!=='paste' && selection){
                setEditingClipboard(copyTrackRange(p,selection))
                if(action==='cut') {editLiteRange(p,selection,'delete'); clearAudioRange(p)}
            } else if(action==='cut'){
                const ids=p.regionSelection.selected().map(r=>UUID.toString(r.uuid))
                editClipboard('copy')
                p.editing.modify(()=>ids.forEach(id=>applyLiteToolbarEdit(p,id,'delete',pulse)),true)
            } else {
                const before=new Set(p.regionSelection.selected())
                editClipboard(action)
                if(action==='paste'){
                    if(!p.regionSelection.selected().some(r=>!before.has(r)))throw new Error(tr('Choose a track of the same type.'))
                    clearAudioRange(p)
                }
            }
            schedule();return
        }
        if((action==='split'||action==='delete') && selection){
            selectedId=editLiteRange(p,selection,action);clearAudioRange(p);schedule();return
        }
        if (!selectedId) {
            if (action==='delete') p.editing.modify(()=>{
                for(const r of [...p.regionSelection.selected()]) applyLiteToolbarEdit(p,UUID.toString(r.uuid),'delete',pulse)
            },true)
            schedule();return
        }
        selectedId=applyLiteToolbarEdit(p,selectedId,action as LiteClipAction,pulse);schedule()
    }
    function updateMenu(){
        const selected=copyDrag?tr('Copy on drag'):tr(({select:'Smart',range:'Range selection',cut:'Blade',trim:'Trim',fade:'Fade',mute:'Mute',erase:'Erase'} as const)[editingTool.getValue()])
        operations.options[0].textContent=tr('Edit')+' · '+selected
    }
    function updateEditButtons(position:number) {
        const r = project && selectedId ? takeRegion(project,selectedId) : undefined
        const inside = r && r.position < position && position < r.complete
        for (const [key,b] of toolButtons) {
            if (key === 'undo') b.disabled = !project?.editing.canUndo()
            else if (key === 'redo') b.disabled = !project?.editing.canRedo()
            else if (key === 'replace') {
                const range=project && getExplicitTimelineSelection(project)
                b.disabled=!r || !range || Math.min(range.end,r.complete)<=Math.max(range.start,r.position) || !!(range.track && !r.trackBoxAdapter.contains(range.track))
            } else if (key === 'delete' || key === 'split') b.disabled = !(project && getAudioRange(project)) && (key==='delete' ? !r : !inside)
            else if(key==='duplicate') b.disabled=!r
            else b.disabled = !inside
        }
        const span=project && getExplicitTimelineSelection(project)
        const text = span && project ? [r?.label,clock(project.tempoMap.ppqnToSeconds(span.start))+' – '+clock(project.tempoMap.ppqnToSeconds(span.end))].filter(Boolean).join(' · ') : r ? r.label : tr('Tap a clip to edit')
        if (selectionLabel.textContent !== text) selectionLabel.textContent = text
    }
    function draw(state:ReturnType<typeof readScoring>|undefined,cue:ScoringCue|undefined) {
        const p=project, direction=cue??state
        const tracks=liteTracks(p), media=tracks.flatMap(row=>row.clips)
        const info = hooks.getVideo()
        extent = Math.max(.01, info.ready ? info.duration + info.offset : direction?.end ?? 8,
            ...(state?.cues.map(c => c.end) ?? []), media.reduce((end,c) => Math.max(end,c.end),0))
        gestures.refresh()
        const nativeSelection = p?.regionSelection.selected() ?? []
        selectedId = nativeSelection.length === 1 ? UUID.toString(nativeSelection[0].uuid) : undefined
        cueLabelCell.textContent=tr(info.ready ? 'Video' : 'Cues')
        redrawCues()
        trackLanes.draw(tracks)
        updatePosition()
    }
    function updatePosition() {
        const pulse = timelinePosition(project), seconds = project.tempoMap.ppqnToSeconds(pulse)
        updateEditButtons(snapped(project,pulse))
        playhead.style.left = `${100*Math.max(0,Math.min(1,seconds/extent))}%`
    }
    function labels() {
        clipTools.setAttribute('aria-label',tr('Clip editing'))
        for (const [action,button] of toolButtons) button.textContent = tr(editCaptions[action])
        operations.setAttribute('aria-label',tr('Clip editing'))
        axisLabel.textContent=tr('Time')
        cueLabelCell.textContent=tr('Cues')
        for (const option of Array.from(operations.options).slice(1)) option.text=tr(extraActions[option.value as Extra])
        updateMenu()
    }
    const keys=(e: KeyboardEvent)=>{
        const p=project
        if(!p || e.defaultPrevented || e.isComposing || document.querySelector('dialog[open]')) return
        if(e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=slider],[data-flowtu-menu]'))return
        const cmd=e.ctrlKey||e.metaKey,key=e.key.toLowerCase(), profile=keyProfile()
        const invoke=(action:()=>void)=>{e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)run(action)}
        if (navigateWithProfile(e,p,{center:0,scaleBy:(amount:number)=>gestures.scale(amount<0?1.4:1/1.4)}))return
        if(profileSplit(e.key,e)||(cmd && !e.shiftKey && !e.altKey && key==='b')||(!cmd&&!e.altKey&&!e.shiftKey&&profile==='flowtu'&&key==='b'&&getAudioRange(p))){
            invoke(()=>actionAtPlayhead('split'));return
        }
        if(cmd && !e.altKey){
            if(key==='a'){
                invoke(()=>{
                    p.regionSelection.deselectAll()
                    if(!e.shiftKey) p.regionSelection.select(...liteTracks(p).filter(row=>!p.audioUnitFreeze.isFrozen(row.unit)).flatMap(row=>row.clips.map(c=>c.region)))
                    clearAudioRange(p); schedule()
                });return
            }
            if(key==='z' || (key==='y' && !e.shiftKey)){invoke(()=>actionAtPlayhead(key==='y'||e.shiftKey?'redo':'undo'));return}
            if(!e.shiftKey && ['c','x','v','d'].includes(key)){
                invoke(()=>actionAtPlayhead(({c:'copy',x:'cut',v:'paste',d:'duplicate'} as const)[key as 'c'|'x'|'v'|'d']));return
            }
            if(e.shiftKey && key==='l'){invoke(()=>loopTimelineSelection(p));return}
        }
        if(!cmd && !e.altKey && e.shiftKey && (e.code==='Comma'||e.code==='Period')){
            invoke(()=>e.code==='Comma'?service.timeline.snapping.stepFiner():service.timeline.snapping.stepCoarser());return
        }
        if(!cmd && !e.altKey && !e.shiftKey){
            if(key==='p'){invoke(()=>{const range=getTimelineSelection(p);if(range)setWorkArea(p,range)});return}
            if((key==='delete'||key==='backspace') && (p.regionSelection.selected().length||getAudioRange(p))){invoke(()=>actionAtPlayhead('delete'));return}
            if(key==='escape' && getExplicitTimelineSelection(p)){invoke(()=>actionAtPlayhead('clear'));return}
            if(key==='n'){invoke(()=>{service.timeline.snapping.enabled=!service.timeline.snapping.enabled});return}
        }
        const tool=toolForKey(e.key,e)
        if(tool)invoke(()=>{copyDrag=false;editingTool.setValue(tool);updateMenu()})
    }
    window.addEventListener('keydown',keys,true)
    life.ownAll(editingTool.subscribe(updateMenu),project.engine.position.subscribe(updatePosition),
        project.regionSelection.subscribe({onSelected:schedule,onDeselected:schedule}),
        subscribeTimelineSelection(project,()=>{trackLanes.paintSelection();updatePosition()}))
    const unlang=watchStudioLanguage(labels)
    labels()
    return {draw,dispose(){
        window.removeEventListener('keydown',keys,true); unlang();life.terminate(); gestures.dispose()
        trackLanes.dispose();arrangement.remove();clipTools.remove()
    }}
}
