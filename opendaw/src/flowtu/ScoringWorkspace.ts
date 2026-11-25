import {localizeStudioDocument, tr} from './studio-language'
import {createProComposerDock} from './ProComposerDock'
import {fillPlannedTools} from './CreativeToolbox'
import {seekTimeline, timelinePosition} from './timeline-seek'
import {handleCueShortcut} from './cue-shortcut'
import type {StudioService} from '../service/StudioService'
import {tones, type Tone} from './commands'
import {formatTimelineTime, getFrameRate} from './time-format'
import {subscribeTimeSettings, timeSettings} from './time-settings'
import {readScoring, writeScoring, generateScoringMidi, focusScoringTake, readScoringTakes, canLinkSelectedScoringTake, linkSelectedScoringTake, cueLabel, nextCueName, takeMembers, takeRegion, type ScoringState} from './scoring-model'
import {createTakeAudition} from './take-audition'
import {PanelType} from '../ui/workspace/PanelType'
import {Terminable, Terminator, UUID} from '@opendaw/lib-std'
import {installScoringResize} from './scoring-resize'
import {clearScoringSelection, scoringSelectionSeconds, wasScoringSelectionCleared, getSelectedScoringCue, setSelectedScoringCue, subscribeScoringCueRequest, subscribeScoringSelection} from './scoring-selection'
import {getAudioRange, getTimelineSelection, setTimelineSelection, subscribeTimelineSelection, subscribeTimelineRangeGesture} from './timeline-selection'
import {createCreationRange} from './CreationRange'
import {installCreationFieldSizes} from './creation-field-sizes'
import type {AudioTimeRange} from './audio-range'
import {projectExtent} from './work-area'
import {createVideoTransport} from './VideoTransport'
import {navigateTransport} from './transport-navigation'
import transportCSS from './video-transport.css?inline'
import {createAssetLibrary} from './AssetLibrary'
import {installAssetDrag} from './asset-drag'
import {attachDirectionRetrieval, type Axes, type DirectionPad, type PadQuery} from './direction-rag'
import {neutralDirection, type ScoreDirection} from './scoring-direction'
import {createDirectionControls} from './DirectionControls'
import {createFlowDeck} from './FlowDeck'
import {createCueNameControl} from './CueNameControl'
import './scoring-workspace.css'
import './video-transport.css'

export interface ScoringWorkspaceAPI {
    service: StudioService
    getVideo(): {sourceInfo?:string; name: string; duration: number; offset: number; ready: boolean; url: string; width: number; height: number}
    importVideo(): void
    importAudio(): void
    saveProject(): void
    setVideoDock(host: HTMLElement | null, hideFloating?: boolean): void
    openVideoWindow(): void
    dockVideoWindow(): void
    isVideoWindowOpen(): boolean
    focusVideoWindow(): void
}

/** A scoring view of the existing project. Its video and DAW share one transport. */
export function installScoringWorkspace(api: ScoringWorkspaceAPI, bar: HTMLElement) {
    const {service} = api
    const audition = createTakeAudition(service)
    const root = document.createElement('section')
    root.className = 'ft-score'
    root.setAttribute('aria-label', 'Video scoring workspace')
    root.hidden = true
    root.innerHTML = `<header class="ft-score-heading"><div><span class="ft-score-file">Import a reference video to begin</span></div><nav aria-label="Scoring workspace views"><button data-action="canvas">FlowDeck</button><button data-action="collapse" aria-expanded="true">Collapse</button></nav></header>
      <div class="ft-score-body">
        <section class="ft-score-prompt ft-score-left">
          <nav class="ft-score-left-views" aria-label="Left pane"><button type="button" data-view="cues" aria-pressed="true">Cue sheet</button><button type="button" data-view="direction" aria-pressed="false">Music Creation</button></nav>
          <section class="ft-score-collection" aria-label="Scoring cues"><div class="ft-score-section-title"><strong>Sessions</strong><button data-action="add-cue" title="Add a cue from the timeline selection or playhead (M)" aria-keyshortcuts="M">＋ Add cue <kbd>M</kbd></button></div><div class="ft-score-cue-list"></div></section>
          <section class="ft-score-detail" data-i18n aria-label="Music Creation" hidden><label class="ft-score-cue-name" hidden>Session <input type="text" data-field="name" aria-label="Cue name" maxlength="64" autocomplete="off" spellcheck="false"></label>
          <div class="ft-score-range"><label>In · seconds<input data-field="start" type="number" min="0" step="0.001" aria-label="Scoring range start in seconds"></label><label>Out · seconds<input data-field="end" type="number" min="0.001" step="0.001" aria-label="Scoring range end in seconds"></label><button data-action="set-in" title="Set start to playhead">Set In</button><button data-action="set-out" title="Set end to playhead">Set Out</button><button data-action="use-selection" title="Set cue In and Out to the timeline selection" disabled>Use selection</button></div>
          <div class="ft-generation-reference" hidden><div><strong></strong><small></small></div><button type="button" data-action="clear-reference" aria-label="Remove generation reference">×</button></div>
          <label class="ft-score-prompt-label">Describe the instrument and movement<textarea data-field="prompt" maxlength="500" rows="3" placeholder="Generate warm piano chords, D minor, add 20% reverb" aria-label="Scoring music prompt"></textarea></label>
          <div class="ft-score-presets"><button data-preset="keys">Piano</button><button data-preset="pad">Ambient</button><button data-preset="bass">Bass</button></div>
          <div class="ft-score-generate-row"><label>Default instrument<select data-field="tone" aria-label="Scoring instrument"></select></label><button class="ft-score-primary" data-action="generate">Generate MIDI</button></div>
          <p class="ft-score-caption">Local commands · New editable MIDI track · Follows project harmony.</p></section>
        </section>
        <section class="ft-score-monitor" aria-label="Reference video">
          <div class="ft-score-stage" data-monitor-state="empty">
            <div class="ft-score-empty"><button data-action="import-video" class="ft-score-primary">Choose reference video</button></div>
            <div class="ft-score-detached"><small></small><span class="ft-score-readout" role="timer" aria-label="Project position" aria-live="off"></span></div>
          </div>

        </section>
        <aside class="ft-score-cues ft-score-takes" aria-label="Project media and cue results"><nav class="ft-score-left-views"><button type="button" data-pane="media" aria-pressed="true">Media</button><button type="button" data-pane="takes" aria-pressed="false">Cue results</button></nav><section class="ft-score-result-content" hidden><div class="ft-score-section-title"><strong class="ft-score-results-title">Results</strong><output class="ft-score-take-count">0</output></div><div class="ft-score-take-list"></div><button data-action="link-take" hidden title="Link the selected clip to this session">Link selected clip</button><button data-action="direction">Open Music Creation</button></section></aside>
        <aside class="ft-score-toolbox" aria-label="Toolbox">
          <details><summary title="Expand or collapse toolbox">Toolbox</summary>
            <div class="ft-toolbox-slots"><h3>Planned tools</h3><ul></ul></div>
          </details>
        </aside>
      </div><footer class="ft-score-footer"><output role="status">Press M to mark a session at the playhead.</output><span>Space · Play / Pause</span></footer>`
    bar.after(root)
    fillPlannedTools(root.querySelector('.ft-toolbox-slots ul')!)
    const scoringResize = installScoringResize(root)
    type LeftView = 'cues' | 'direction'
    let leftView: LeftView = 'cues'
    const left = root.querySelector<HTMLElement>('.ft-score-left')!
    const results = root.querySelector<HTMLElement>('.ft-score-takes')!
    const resultTitle = results.querySelector<HTMLElement>('.ft-score-results-title')!
    let mediaVisible = true
    function showMedia(show: boolean) {
        mediaVisible = show
        library.element.hidden = !show
        results.querySelector<HTMLElement>('.ft-score-result-content')!.hidden = show
        results.querySelectorAll<HTMLButtonElement>('[data-pane]').forEach(button => {
            button.setAttribute('aria-pressed', String((button.dataset.pane === 'media') === show))
        })
    }
    function chooseLeftView(view: LeftView) {
        leftView = view
        left.querySelector<HTMLElement>('.ft-score-collection')!.hidden = view !== 'cues'
        left.querySelector<HTMLElement>('.ft-score-detail')!.hidden = view !== 'direction'
        left.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)))
    }
    const stage = root.querySelector<HTMLElement>('.ft-score-stage')!
    const clock = stage.querySelector<HTMLElement>('.ft-score-readout')!
    const clockUnit = stage.querySelector<HTMLElement>('.ft-score-detached small')!
    const monitor = stage.parentElement!
    const players = new Set<ReturnType<typeof createVideoTransport>>()
    let fillPicture = false
    const start = root.querySelector<HTMLInputElement>('[data-field=start]')!, end = root.querySelector<HTMLInputElement>('[data-field=end]')!
    const prompt = root.querySelector<HTMLTextAreaElement>('[data-field=prompt]')!, tone = root.querySelector<HTMLSelectElement>('[data-field=tone]')!
    const status = root.querySelector<HTMLOutputElement>('.ft-score-footer output')!
    const generateButton = root.querySelector<HTMLButtonElement>('[data-action=generate]')!
    const composer = createProComposerDock(prompt,generateButton,status,api.saveProject,() => {
        if (!service.hasProfile) return
        clearScoringSelection(service.project)
        tell(''); refresh()
    })
    const nameField = root.querySelector<HTMLInputElement>('[data-field=name]')!
    let unsubscribeCueRequests: (() => void) | undefined
    const cueList = root.querySelector<HTMLElement>('.ft-score-cue-list')!
    const takeList = root.querySelector<HTMLElement>('.ft-score-take-list')!
    const useSelection = root.querySelector<HTMLButtonElement>('[data-action=use-selection]')!
    const linkTake = root.querySelector<HTMLButtonElement>('[data-action="link-take"]')!
    const takeCount = root.querySelector<HTMLOutputElement>('.ft-score-take-count')!
    let takeChanges: Terminable | undefined, takesDirty = true, lastTakes = ''
    const dirtyTakes = () => {takesDirty = true}
    const cueRows = new Map<string, ReturnType<typeof createCueRow>>()
    for (const [key, value] of Object.entries(tones)) tone.add(new Option(value.label, key))
    let state: ScoringState | undefined, stateSignature = '', videoSignature = '', selectedCue: string | undefined
    let lastProject: unknown, active = false, collapsed = false, disposed = false
    const cueTime = (seconds: number) => formatTimelineTime(seconds, timeSettings.display, getFrameRate(timeSettings.fps))
    const tell = (message: string, error = false) => {status.textContent = message; status.dataset.error = String(error)}
    const run = (action: () => void) => {try {action()} catch (error) {tell(error instanceof Error ? error.message : String(error), true)}}
    const position = () => service.hasProfile ? service.project.tempoMap.ppqnToSeconds(timelinePosition(service.project)) : 0
    const updateClock = () => {
        if (disposed || ((!active || collapsed) && players.size < 2)) return
        const seconds = position(), info = api.getVideo()
        const maximum = info.ready ? Math.max(.001, info.offset + info.duration) : Math.max(8, seconds, state?.end ?? 0)
        if (stage.dataset.monitorState === 'clock') {
            const text = cueTime(seconds)
            if (clock.textContent !== text) clock.textContent = text
        }
        for (const player of players) player.updatePosition(seconds, maximum, cueTime)
    }
    const seek = (seconds: number) => {
        if (!service.hasProfile || !Number.isFinite(seconds)) return
        if (service.audioContext.state === 'suspended') void service.audioContext.resume().catch(() => tell('Press Play once to enable audio.', true))
        seekTimeline(service.project, Math.max(0, Math.round(service.project.tempoMap.secondsToPPQN(seconds))))
    }
    const currentCue = () => state?.cues.find(cue => cue.id === selectedCue)
    const creationBounds = () => {
        const video = api.getVideo(), project = service.project
        if (video.ready && video.duration > 0 && video.offset + video.duration > 0)
            return {start: Math.max(0, video.offset), end: video.offset + video.duration}
        return {start: 0, end: Math.max(8, currentCue()?.end ?? 0, state?.end ?? 0,
            project.tempoMap.ppqnToSeconds(Math.max(projectExtent(project).end, service.timeline.range.unitMax)))}
    }
    const showBounds = (value: AudioTimeRange) => {
        start.value = value.start.toFixed(3); end.value = value.end.toFixed(3)
    }
    const restoreBounds = () => {
        const value = currentCue() ?? state
        if (value && service.hasProfile) {showBounds(value); creationRange.paint(value,creationBounds())}
    }
    const selectCreationBounds = (value: AudioTimeRange) => {
        const project = service.project
        const from = Math.round(project.tempoMap.secondsToPPQN(value.start)), to = Math.round(project.tempoMap.secondsToPPQN(value.end))
        if (to > from) setTimelineSelection(project,{start:from,end:to},getAudioRange(project)?.track)
    }
    const creationRange = createCreationRange(() => {
        const current = currentCue() ?? state
        if (!current || !service.hasProfile) return
        const project = service.project, cue = selectedCue, {tempoMap} = project
        return {current, bounds: creationBounds(),
            snap(seconds,bypass) {
                const pulse = tempoMap.secondsToPPQN(seconds)
                return tempoMap.ppqnToSeconds(bypass || !service.timeline.snapping.enabled ? Math.round(pulse) : service.timeline.snapping.round(pulse))
            },
            finish(bounds) {
                if (service.hasProfile && service.project === project && cue === selectedCue) {
                    run(() => {const value = commit(true,bounds); selectCreationBounds(value); seek(value.start)})
                }
                restoreBounds()
            }}
    },showBounds,restoreBounds,cueTime)
    left.querySelector('.ft-score-range')!.prepend(creationRange.element)
    const editAsset = (regionId: string) => run(() => {
        audition.stop()
        service.switchScreen('default')
        const range = focusScoringTake(service.project, regionId)
        service.panelLayout.showIfAvailable(PanelType.ContentEditor)
        service.timeline.range.showUnitInterval(Math.max(0, range.start - 960), range.end + 960)
        seek(service.project.tempoMap.ppqnToSeconds(range.start))
    })
    const previewAsset = (regionId: string) => {
        void audition.play(regionId).catch(error => tell(error instanceof Error ? error.message : String(error), true))
    }
    const deck = createFlowDeck(service, {audition, edit: editAsset, save: api.saveProject, tell})
    const library = createAssetLibrary(service, {showVideo: () => api.isVideoWindowOpen() ? api.focusVideoWindow() : open(), audition, edit: editAsset, openDeck: id => deck.open(id), importAudio: api.importAudio, tell,
        useForGeneration: id => run(() => setReference(id))})
    const referenceChip = left.querySelector<HTMLElement>('.ft-generation-reference')!
    function setReference(referenceId?: string) {
        if (!service.hasProfile || !state) return
        const project = service.project, region = referenceId ? takeRegion(project,referenceId) : undefined
        if (referenceId && !region) throw new Error('Choose a reference that is still in this project.')
        const cue = currentCue(), bounds = !cue && region ? {start:project.tempoMap.ppqnToSeconds(region.position),end:project.tempoMap.ppqnToSeconds(region.complete)} : {}
        write({...state,...bounds,referenceId,cues:state.cues.map(item => item.id === selectedCue ? {...item,referenceId} : item)})
        chooseLeftView('direction')
    }
    const direction = createDirectionControls((value, pad) => run(() => {
        if (!state) return
        const cues = state.cues.map(cue => cue.id === selectedCue ? {...cue, direction: value} : cue)
        write({...state, direction: value, cues})
        if (pad) void retrievers[pad].retrieve()
    }))
    function connectPad<K extends DirectionPad>(pad: K, selector: string, axes: (direction: ScoreDirection) => Axes[K]) {
        const host = direction.element.querySelector<HTMLElement>(selector)!
        return attachDirectionRetrieval(pad, host, (): PadQuery<K> | undefined => {
            if (!state || !service.hasProfile || service.project !== lastProject) return
            const cue = currentCue(), range = cue ?? state, setting = range.direction ?? neutralDirection
            return {
                pad, axes: axes(setting), style: setting.style, projectId: UUID.toString(service.profile.uuid),
                bpm: service.project.timelineBox.bpm.getValue(), instrument: range.tone,
                cue: {id: cue?.id ?? null, name: cue ? cueLabel(state, cue) : '', startSeconds: range.start,
                    endSeconds: range.end, prompt: prompt.value.trim(), analysis: cue?.markdown ?? ''}
            }
        }, suggestion => run(() => {
            const combined = [prompt.value.trim(), suggestion].filter(Boolean).join('\n')
            if (combined.length > prompt.maxLength) throw new Error(tr('Keep the cue description within 500 characters.'))
            prompt.value = combined
            commit()
        }))
    }
    const retrievers = {
        melodyArrangement: connectPad('melodyArrangement', '[data-pad="melody"]', ({melody, arrangement}) => ({melody, arrangement})),
        emotionStyle: connectPad('emotionStyle', '[data-pad="emotion"]', ({emotion, character}) => ({emotion, character}))
    }
    const refreshRetrieval = () => {retrievers.melodyArrangement.refresh(); retrievers.emotionStyle.refresh()}
    left.querySelector('.ft-score-generate-row')!.before(direction.element)
    const releaseFieldSizes = installCreationFieldSizes(left)
    left.append(deck.element)
    results.append(library.element)
    results.querySelectorAll<HTMLButtonElement>('[data-pane]').forEach(button => {
        button.onclick = () => showMedia(button.dataset.pane === 'media')
    })
    showMedia(true)
    const resultDrags = new Terminator()
    left.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => {
        button.onclick = () => chooseLeftView(button.dataset.view as LeftView)
    })
    chooseLeftView(leftView)
    const updateComposerScope = () => {
        if (!state || !service.hasProfile) return
        const project = service.project, cue = currentCue()
        const bounds = cue ?? (wasScoringSelectionCleared(project) ? scoringSelectionSeconds(project) : state)
        composer.setScope(bounds ? cue ? cueLabel(state,cue) : tr('Music Creation') : '',
            bounds ? cueTime(bounds.start) + ' – ' + cueTime(bounds.end) : '', !!cue || !!getTimelineSelection(project))
    }
    const paintFields = () => {
        if (!state) return
        const cue = currentCue(), value = cue ?? state
        nameField.parentElement!.hidden = !cue
        nameField.value = cue ? cueLabel(state, cue) : ''
        restoreBounds()
        prompt.value = value.prompt; tone.value = value.tone
        updateComposerScope()
        composer.sync()
        direction.setValue(value.direction)
        refreshRetrieval()
    }
    const syncSelection = (id: string | undefined, renotify = false) => {
        if (id !== selectedCue) {audition.stop(); dirtyTakes()}
        selectedCue = id
        setSelectedScoringCue(service.project, id, renotify)
    }
    const write = (next: ScoringState, selection = selectedCue) => {
        if (!service.hasProfile) throw new Error('Open or create a project first.')
        writeScoring(service.project, next)
        state = readScoring(service.project); stateSignature = JSON.stringify(state)
        const reveal = selection !== selectedCue
        syncSelection(state.cues.some(cue => cue.id === selection) ? selection : wasScoringSelectionCleared(service.project) ? undefined : state.cues[0]?.id)
        dirtyTakes(); paintFields(); paintCues(reveal); paintTakes()
    }
    const commit = (pinEnd = false, bounds?: Pick<ScoringState, 'start' | 'end'>) => {
        refresh()
        if (!state) throw new Error('Open or create a project first.')
        const cue = currentCue(), base = cue ?? state
        // Editing a name or prompt must preserve a cue marked on a fractional frame.
        const range = {
            start: bounds?.start ?? (start.value === base.start.toFixed(3) ? base.start : start.valueAsNumber),
            end: bounds?.end ?? (end.value === base.end.toFixed(3) ? base.end : end.valueAsNumber),
            prompt: prompt.value.trim(), tone: tone.value as Tone
        }
        const name = nameField.value.trim()
        const outChanged = range.end !== base.end || !!(pinEnd && cue?.autoEnd)
        if (cue?.autoEnd && !outChanged && range.start !== base.start)
            range.end = range.start + (base.end - base.start)
        if (range.start !== base.start || range.end !== base.end || range.prompt !== base.prompt
            || range.tone !== base.tone || outChanged || cue && name !== cue.name) {
            const cues = cue ? state.cues.map(item => {
                if (item.id !== cue.id) return item
                const updated = {...cue, ...range, name}
                if (outChanged) delete updated.autoEnd
                return updated
            }).sort((a, b) => a.start - b.start) : state.cues
            write({...state, ...range, cues})
        }
        return currentCue() ?? state
    }
    const selectCue = (id: string) => {
        if (active && collapsed) open()
        refresh()
        const cue = state?.cues.find(item => item.id === id)
        if (!state || !cue) return
        chooseLeftView('cues')
        syncSelection(id, true); paintFields(); paintCues(true); paintTakes()
        const project = service.project
        setTimelineSelection(project, {
            start: project.tempoMap.secondsToPPQN(cue.start), end: project.tempoMap.secondsToPPQN(cue.end)
        })
        seek(cue.start)
        if (cue.takes?.length) showMedia(false)
        tell(`Cue ${cueLabel(state, cue)} selected.`)
    }
    function selectedSeconds() {
        const project = service.project, selection = getTimelineSelection(project)
        return selection && {start: project.tempoMap.ppqnToSeconds(selection.start), end: project.tempoMap.ppqnToSeconds(selection.end)}
    }
    function markCue(preferSelection = !service.engine.isPlaying.getValue()): boolean {
        if (!active || !service.hasProfile || disposed) return false
        const bounds = preferSelection ? selectedSeconds() : undefined
        const from = bounds?.start ?? Math.max(0, position())
        run(() => {
            refresh()
            if (!state) return
            const range = currentCue() ?? state, info = api.getVideo()
            if (!bounds && info.ready && (from < Math.max(0, info.offset) || from >= info.offset + info.duration))
                throw new Error('Place the playhead inside the reference video to add a cue.')
            const end = bounds?.end ?? Math.min(info.ready ? info.offset + info.duration : Infinity, from + (range.end - range.start))
            const name = nextCueName(state!)
            const cue = {id: crypto.randomUUID(), name, autoEnd: !bounds, start: from, end, prompt: range.prompt, tone: range.tone, direction: range.direction, referenceId: currentCue() ? undefined : range.referenceId}
            const cues = [...state!.cues, cue].sort((a, b) => a.start - b.start)
            chooseLeftView('cues')
            write({...state!, start: from, end, prompt: cue.prompt, tone: cue.tone, cues}, cue.id)
            tell(bounds ? `Cue ${name} · ${cueTime(from)} – ${cueTime(end)}` : `Cue ${name} marked at ${cueTime(from)}.`)
        })
        return true
    }
    function createCueRow(id: string) {
        const row = document.createElement('div')
        row.className = 'ft-score-cue'; row.dataset.cueId = id
        const choose = document.createElement('button')
        choose.type = 'button'; choose.className = 'ft-score-cue-select'
        choose.onclick = () => run(() => selectCue(id))
        const label = createCueNameControl(row,id,()=>service.hasProfile?service.project:undefined,()=>{
            syncSelection(id);paintFields();paintCues();paintTakes()
        },refresh,
            error=>tell(error instanceof Error?error.message:String(error),true))
        const body=document.createElement('div'), timing = document.createElement('small'), description = document.createElement('span')
        body.className='ft-score-cue-body'
        const title = document.createElement('div'), count = document.createElement('small')
        title.className = 'ft-score-session-title'; count.hidden = true
        title.append(label.title,label.field,count);choose.append(timing,description);body.append(title,choose)
        const remove = document.createElement('button')
        remove.type = 'button'; remove.textContent = '×'; remove.className = 'ft-score-cue-remove'
        remove.onclick = () => run(() => {
            refresh()
            const cue = state?.cues.find(item => item.id === id)
            if (!cue || !state) return
            const name = cueLabel(state, cue)
            write({...state, cues: state.cues.filter(item => item.id !== id)})
            tell(`Cue ${name} removed.`)
        })
        row.append(body, remove)
        return {row, choose, label, timing, description, remove, count}
    }
    function paintCues(reveal = false) {
        const visible = new Set(state?.cues.map(cue => cue.id))
        for (const [id, item] of cueRows) {
            if (visible.has(id)) continue
            item.row.remove(); cueRows.delete(id)
        }
        if (!state?.cues.length) {
            if (!cueList.firstChild) {
                const hint = document.createElement('p'); hint.className = 'ft-score-cue-empty'
                hint.textContent = 'Select a range and press M to create a cue. During playback, M marks the playhead.'
                cueList.append(hint)
            }
            return
        }
        cueList.querySelector('.ft-score-cue-empty')?.remove()
        const value = state
        value.cues.forEach((cue, index) => {
            let item = cueRows.get(cue.id)
            if (!item) {item = createCueRow(cue.id); cueRows.set(cue.id, item)}
            const {row, choose, label, timing, description, remove} = item
            const name = cueLabel(value, cue), selected = cue.id === selectedCue
            row.classList.toggle('selected', selected)
            choose.setAttribute('aria-pressed', String(selected))
            label.update(name)
            choose.setAttribute('aria-label',name+' · '+cueTime(cue.start))
            timing.textContent = `${cueTime(cue.start)} – ${cueTime(cue.end)}`
            description.textContent = cue.prompt; description.title = cue.prompt
            remove.setAttribute('aria-label', `Remove cue ${name}`)
            if (cueList.children[index] !== row) cueList.insertBefore(row, cueList.children.item(index))
        })
        const activeRow = reveal && selectedCue ? cueRows.get(selectedCue)?.row : undefined
        if (activeRow) {
            const offset = activeRow.getBoundingClientRect().top - cueList.getBoundingClientRect().top
            if (offset < 0) cueList.scrollTop += offset
            else if (offset + activeRow.offsetHeight > cueList.clientHeight) cueList.scrollTop += offset + activeRow.offsetHeight - cueList.clientHeight
        }
    }
    function paintTakes() {
        if (!takesDirty) return
        takesDirty = false
        library.refresh(selectedCue); deck.refresh()
        const cue = currentCue()
        const id = (cue ?? state)?.referenceId
        referenceChip.hidden = !id || !service.hasProfile
        if (id && service.hasProfile) {
            const source = takeRegion(service.project,id)
            referenceChip.querySelector('strong')!.textContent = source?.label || 'Reference unavailable'
            referenceChip.querySelector('small')!.textContent = source?.isNoteRegion() ? 'MIDI reference · Notes and rhythm' : source ? 'Audio reference · Phrase length' : 'Choose another asset or remove this reference.'
        }
        const takes = cue && service.hasProfile ? readScoringTakes(service.project, cue) : []
        for (const session of state?.cues ?? []) {
            const count = cueRows.get(session.id)?.count
            if (!count) continue
            const size = session.id === cue?.id ? takes.length : readScoringTakes(service.project, session).length
            count.hidden = size === 0
            count.textContent = size === 1 ? '1 take' : `${size} takes`
        }
        resultTitle.textContent = state && cue ? `Cue ${cueLabel(state, cue)} · Results` : 'Results'
        const signature = JSON.stringify([cue?.id, cue?.takeParts, takes])
        if (signature === lastTakes) return
        lastTakes = signature
        takeCount.textContent = String(takes.length)
        resultDrags.terminate()
        takeList.replaceChildren(...takes.map(take => {
            const row = document.createElement('div')
            row.className = 'ft-score-take'; row.dataset.regionId = take.id
            const edit = document.createElement('button'), preview = document.createElement('button')
            edit.className = 'ft-score-take-open'; edit.title = 'Open in Editor'
            edit.setAttribute('aria-label', `Edit take ${take.number}: ${take.name}`)
            const title = document.createElement('b'), subtitle = document.createElement('span'), duration = document.createElement('small')
            title.textContent = `Take ${take.number}`; subtitle.textContent = take.name; subtitle.title = `${take.track} · ${take.name}`
            duration.textContent = `${(take.end - take.start).toFixed(2)} s`
            edit.append(title, subtitle, duration)
            edit.onclick = () => editAsset(take.id)
            const refine = document.createElement('button')
            refine.className = 'ft-score-take-deck'
            refine.textContent = 'FlowDeck'
            refine.setAttribute('aria-label', `Open ${take.name} in FlowDeck`)
            refine.onclick = () => deck.open(take.id)
            preview.className = 'ft-score-take-preview'
            preview.textContent = '▶'; preview.title = `Preview take ${take.number}`
            preview.setAttribute('aria-label', preview.title)
            preview.onclick = () => previewAsset(take.id)
            row.append(edit, preview, refine)
            resultDrags.own(installAssetDrag(row, service.project, take.id, cue ? takeMembers(cue,take.id) : undefined))
            return row
        }))
        if (!takes.length) {
            const hint = document.createElement('p')
            hint.className = 'ft-score-take-empty'; hint.textContent = 'Generate a take or link a clip from the timeline.'
            takeList.append(hint)
        }
    }
    function paintPreview() {
        const playing = audition.current()
        for (const button of takeList.querySelectorAll<HTMLButtonElement>('.ft-score-take-preview')) {
            const active = button.parentElement?.dataset.regionId === playing
            const glyph = active ? (audition.loading() ? '…' : '■') : '▶'
            if (button.textContent !== glyph) button.textContent = glyph
            button.setAttribute('aria-pressed', String(active))
        }
    }
    const refresh = () => {
        if (disposed) return
        refreshRetrieval()
        const external = api.isVideoWindowOpen(), info = api.getVideo()
        const monitorState = external ? 'clock' : info.name ? 'picture' : 'empty'
        if (stage.dataset.monitorState !== monitorState) stage.dataset.monitorState = monitorState
        updateClock()
        for (const player of players) {
            player.updateControls(service.hasProfile && service.engine.isPlaying.getValue(), info.ready,
                service.hasProfile, external, player.element.ownerDocument !== document, fillPicture)
            if (player.element.parentElement) player.element.parentElement.dataset.filmFit = fillPicture ? 'cover' : 'contain'
        }
        if (!service.hasProfile) {
            if (state) {start.value = '0.000'; end.value = '8.000'; prompt.value = ''; tone.value = 'keys'; cueList.replaceChildren(); cueRows.clear()}
            creationRange.cancel(); useSelection.disabled = true
            unsubscribeCueRequests?.(); unsubscribeCueRequests = undefined
            takeChanges?.terminate(); takeChanges = undefined
            nameField.parentElement!.hidden = true
            if (lastProject) {
                state = undefined; lastProject = undefined; stateSignature = ''; selectedCue = undefined
                dirtyTakes(); paintTakes()
            }
            for (const action of ['generate', 'add-cue']) root.querySelector<HTMLButtonElement>(`[data-action=${action}]`)!.disabled = true
            composer.setScope(tr('No project open'),'')
            composer.sync()
            return
        }
        const project = service.project, changedProject = lastProject !== project
        if (changedProject) {
            creationRange.cancel(); unsubscribeCueRequests?.()
            audition.stop(); takeChanges?.terminate()
            const output = project.rootBoxAdapter.audioUnits.adapters().find(unit => unit.isOutput)
            for (const player of players) player.levels(0, 0)
            const meter = output ? project.liveStreamReceiver.subscribeFloats(output.address, values => {
                if ((active && !collapsed) || players.size > 1) {
                    for (const player of players) player.levels(values[0], values[1])
                }
            }) : Terminable.Empty
            const updateSelection = () => {useSelection.disabled = !getTimelineSelection(project); updateComposerScope()}
            updateSelection()
            takeChanges = Terminable.many(project.editing.subscribe(dirtyTakes), project.tempoMap.subscribe(dirtyTakes),
                subscribeTimelineSelection(project, updateSelection), subscribeTimelineRangeGesture(project, bounds => {
                    if (!active || collapsed || leftView !== 'direction' || document.documentElement.classList.contains('ft-lite-open') || !deck.element.hidden) return
                    run(() => commit(true,{start:project.tempoMap.ppqnToSeconds(bounds.start),end:project.tempoMap.ppqnToSeconds(bounds.end)}))
                }), meter,
                {terminate:subscribeScoringSelection(project,()=>{
                    const shared=getSelectedScoringCue(project)
                    if (shared===selectedCue && !wasScoringSelectionCleared(project)) return
                    if (wasScoringSelectionCleared(project)) tell('')
                    creationRange.cancel(); selectedCue=shared; audition.stop(); stateSignature=''; dirtyTakes()
                })})
            dirtyTakes()
            lastProject = project; lastTakes = ''; selectedCue = getSelectedScoringCue(project); stateSignature = ''; videoSignature = ''
            unsubscribeCueRequests = subscribeScoringCueRequest(project, id => run(() => selectCue(id)))
        }
        if (changedProject || takesDirty) {
            const next = readScoring(project), signature = JSON.stringify(next)
            if (signature !== stateSignature) {
                state = next; stateSignature = signature
                if (!wasScoringSelectionCleared(project) && !state.cues.some(cue => cue.id === selectedCue)) syncSelection(state.cues[0]?.id)
                paintFields(); paintCues()
            }
            paintTakes()
        }
        if (active && !collapsed) {
            deck.refreshPreview()
            if (mediaVisible) library.refreshPreview()
            else if (leftView === 'cues') paintPreview()
            linkTake.hidden = !selectedCue || !canLinkSelectedScoringTake(project, selectedCue, state)
        }
        generateButton.disabled = (!!info.name && !info.ready) || (wasScoringSelectionCleared(project) && !getTimelineSelection(project))
        composer.sync()
        root.querySelector<HTMLButtonElement>('[data-action=add-cue]')!.disabled = false
    }
    function refreshVideo() {
        if (disposed) return
        refresh()
        const info = api.getVideo(), signature = `${info.name}:${info.duration}:${info.offset}:${info.ready}`
        root.querySelector<HTMLElement>('.ft-score-file')!.title = info.sourceInfo ?? ''
        root.querySelector('.ft-score-file')!.textContent = info.name
        if (info.ready && signature !== videoSignature && state && !state.cues.length && state.start === 0 && state.end === 8) {
            const from = Math.max(0, info.offset), to = Math.max(from + .01, info.offset + Math.min(8, info.duration))
            run(() => write({...state!, start: from, end: to}))
        }
        library.setVideo(info)
        restoreBounds()
        scoringResize.fitVideo(info.url, info.width, info.height)
        videoSignature = signature
        if (active && !collapsed) api.setVideoDock(stage)
    }
    function open() {
        active = true; collapsed = false; root.hidden = false; root.classList.remove('collapsed')
        root.querySelector('[data-action=collapse]')!.textContent = 'Collapse'; root.querySelector('[data-action=collapse]')!.setAttribute('aria-expanded','true')
        document.documentElement.classList.add('ft-scoring-open', 'ft-video-mode')
        if (service.hasProfile) service.switchScreen('default')
        refreshVideo()
    }
    const restoreMode = open
    const actions: Record<string, () => void> = {
        'clear-reference': () => setReference(),
        'import-video': api.importVideo,
        canvas: () => {if (collapsed) open(); deck.open(undefined, true)},
        direction: () => {chooseLeftView('direction'); prompt.focus()},
        collapse: () => {collapsed = !collapsed; root.classList.toggle('collapsed', collapsed); const button = root.querySelector('[data-action=collapse]')!; button.textContent = collapsed ? 'Expand' : 'Collapse'; button.setAttribute('aria-expanded', String(!collapsed)); api.setVideoDock(collapsed ? null : stage)},
        play: () => {if (service.hasProfile) service.engine.isPlaying.getValue() ? service.engine.stop() : service.engine.play()},
        'cue-play': () => {const value = commit(); service.engine.stop(); seek(value.start); service.engine.play()},
        'set-in': () => {start.value = String(position()); selectCreationBounds(commit())},
        'set-out': () => {end.value = String(position()); selectCreationBounds(commit(true))},
        'add-cue': () => markCue(true),
        'use-selection': () => {
            const bounds = selectedSeconds()
            if (bounds) {commit(true, bounds); tell('Cue range set to the timeline selection.')}
        },
        'link-take': () => {
            if (!service.hasProfile || !selectedCue) return
            linkSelectedScoringTake(service.project, selectedCue)
            dirtyTakes(); refresh()
        },
        generate: () => {
            const project = service.project, cleared = wasScoringSelectionCleared(project)
            const bounds = cleared ? scoringSelectionSeconds(project) : undefined
            if (cleared && !bounds) return
            const value = commit(!!bounds,bounds), info = api.getVideo()
            if (info.ready && (value.start < Math.max(0, info.offset) - .01 || value.end > info.offset + info.duration + .01)) throw new Error('Keep the generation range inside the reference video.')
            service.engine.stop()
            audition.stop()
            const result = generateScoringMidi(service.project, value, selectedCue)
            chooseLeftView('cues'); showMedia(false); syncSelection(result.cueId); dirtyTakes()
            service.switchScreen('default')
            service.timeline.range.showUnitInterval(Math.max(0, service.project.tempoMap.secondsToPPQN(value.start) - 960), service.project.tempoMap.secondsToPPQN(value.end) + 960)
            tell(`${result.message} · Ready in Assets and on the timeline.`)
            refresh()
        },
        popout: () => api.isVideoWindowOpen() ? api.dockVideoWindow() : api.openVideoWindow(),
        fullscreen: () => {
            const action = document.fullscreenElement ? document.exitFullscreen() : monitor.requestFullscreen?.()
            return action?.catch(() => tell('Full screen is unavailable in this browser.', true))
        }
    }
    const clicked = (event: MouseEvent) => {
        if (!(event.target instanceof Element) || event.target.closest('.ft-monitor-transport')) return
        const button = event.target.closest<HTMLButtonElement>('button[data-action]'); if (!button || button.disabled) return
        const action = actions[button.dataset.action!]; if (action) run(action)
    }
    root.addEventListener('click', clicked)
    const changed = (event: Event) => run(() => {
        const value = commit(event.target === end)
        if (event.target === start || event.target === end) selectCreationBounds(value)
        tell(selectedCue ? 'Cue updated.' : 'Music Creation saved to this project.')
    })
    for (const field of [nameField, start, end, prompt, tone]) field.addEventListener('change', changed)
    root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.onclick = () => run(() => {
        const selected = button.dataset.preset as Tone
        tone.value = selected
        prompt.value = selected === 'keys' ? 'Generate warm piano chords, add 20% reverb' : selected === 'pad' ? 'Generate sparse ambient pad chords, add 35% reverb' : 'Generate a bass line'
        commit(); prompt.focus()
    }))
    const attachTransport = (doc: Document, target: HTMLElement, fullscreen: () => void | Promise<void>, detach: () => void) => {
        // A popup has its own document and cannot inherit the Studio's stylesheets.
        if (doc !== document) {
            const css = doc.createElement('style')
            css.textContent = transportCSS
            doc.head.append(css)
        }
        const player = createVideoTransport(doc, {
            play: actions.play, navigate: action=>navigateTransport(service,action), seek, fullscreen, detach, cue: () => run(actions['cue-play']),
            importVideo: api.importVideo, focusWindow: api.focusVideoWindow,
            toggleFit() {fillPicture = !fillPicture; refresh()}
        })
        target.append(player.element)
        players.add(player)
        refresh()
        const unlinkLanguage = doc === document ? undefined : localizeStudioDocument(doc)
        return {dispose() {unlinkLanguage?.(); players.delete(player); player.dispose()}}
    }
    attachTransport(document, monitor, actions.fullscreen, actions.popout)
    const keys = (event: KeyboardEvent) => {
        if (!(event.target instanceof Element)) return
        if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && !event.isComposing && event.key.toLowerCase() === 's') {
            event.preventDefault(); event.stopImmediatePropagation()
            run(() => {if (root.contains(event.target as Node)) commit(); api.saveProject()})
            return
        }
        if (event.target.closest('input,textarea,select')) {
            if (event.key !== 'Tab') event.stopPropagation()
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && event.target.closest('.ft-score-detail')) {event.preventDefault(); run(actions.generate)}
        }
    }
    root.addEventListener('keydown', keys)
    const clockPosition = Terminable.many(service.engine.position.subscribe(updateClock), service.engine.isPlaying.subscribe(refresh))
    const unsubscribeClockSettings = subscribeTimeSettings(({display, fps}) => {
        const rate = getFrameRate(fps)
        clockUnit.textContent = display === 'time' ? 'Project time · ms' : `${display === 'frames' ? 'Time + frames' : 'Timecode'} · ${rate.label}`
        updateClock()
        if (state) paintCues()
    })
    const markKey = (event: KeyboardEvent) => {
        if (active && service.hasProfile) handleCueShortcut(event, document, markCue)
    }
    window.addEventListener('keydown', markKey, true)
    const timer = setInterval(refresh, 200)
    return {setComposerActive:composer.setActive, showAssets() {if (collapsed) open(); library.refresh(); showMedia(true)}, markCueAtPlayhead: markCue, open, restoreMode, refreshVideo, attachTransport, dispose() {
        retrievers.melodyArrangement.clear(); retrievers.emotionStyle.clear()
        composer.dispose()
        creationRange.cancel(); players.forEach(player => player.dispose()); players.clear()
        resultDrags.terminate(); library.dispose(); deck.dispose(); audition.dispose(); takeChanges?.terminate(); scoringResize.terminate(); releaseFieldSizes()
        window.removeEventListener('keydown', markKey, true); unsubscribeCueRequests?.()
        disposed = true; clearInterval(timer); clockPosition.terminate(); unsubscribeClockSettings(); api.setVideoDock(null)
        root.removeEventListener('click', clicked)
        root.removeEventListener('keydown', keys)
        root.remove(); document.documentElement.classList.remove('ft-scoring-open', 'ft-video-mode')
    }}
}
