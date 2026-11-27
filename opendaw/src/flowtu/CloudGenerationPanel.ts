// Cloud song generation (1124 main chain). The panel shares the Music Creation prompt, range
// and direction dials, submits to the ext gateway and previews the signed results. Naming the
// first save links the project to its generation on the server (X-Studio-Generation-Key);
// later generations skip naming. History comes from the per-project listing and its input
// snapshot can be loaded back into the forms.
import './cloud-generation.css'
import {fetchStudioAudio} from './studio-audio'
import {tr} from './studio-language'
import {requestGenerationProjectName} from './ProjectLibraryDialog'
import {fetchStudioModels, fromApiDirection, fromApiStyle, isAuthError, listProjectGenerations,
    pollGeneration, regenerateGeneration, submitGeneration, pendingGenerations, resumeGeneration, forgetGeneration, generationFailureMessage,
    type GenerationContext, type SubmitResult, type GenerationRecord, type StudioModel} from './studio-generations'
import {cloudLibrary} from './project-library'
import {neutralDirection, type ScoreDirection} from './scoring-direction'

export type CloudGenerationInput = {prompt: string; start: number; end: number; direction?: ScoreDirection; style: string}
export type CloudGenerationSong = {songKey: string; title: string; durationMs?: number; playUrl: string | null}
type SongRow = CloudGenerationSong
export type CloudGenerationHost = {
    // Commits pending edits and returns the current Music Direction snapshot, or undefined without a project.
    currentInput: () => CloudGenerationInput | undefined
    // Writes a loaded snapshot back into the shared forms (prompt, range and direction dials).
    applyInput: (input: CloudGenerationInput) => void
    // The cloud project id once this project has been synced; undefined until the first save.
    generationScope: () => string | undefined
    cloudProjectId: () => string | undefined
    saveProjectForGeneration: (name: string, generationKey: string) => Promise<void>
    addToProject?: (song: SongRow) => Promise<void>
}
const formatDuration = (ms?: number) => {
    if (ms === undefined || !Number.isFinite(ms)) return '—'
    const total = Math.max(0, Math.round(ms / 1000)), minutes = Math.floor(total / 60), seconds = total % 60
    return minutes + ':' + String(seconds).padStart(2, '0')
}
const shortKey = (generationKey: string) => generationKey.length > 12 ? generationKey.slice(0, 12) + '…' : generationKey
export function installCloudGenerationPanel(host: CloudGenerationHost, parent: Element) {
    const element = document.createElement('details')
    element.className = 'ft-cloud-gen'
    element.innerHTML = `<summary>Generate song · Cloud</summary>
      <div class="ft-cloud-gen-body">
        <div class="ft-cloud-gen-row">
          <label>${tr('Model')}<select data-field="cloud-model" aria-label="Generation model"></select></label>
          <label>${tr('Songs')}<select data-field="cloud-count" aria-label="Number of songs"></select></label>
          <output data-field="cloud-credits" aria-live="polite"></output>
        </div>
        <div class="ft-cloud-gen-mode" role="group" aria-label="Song content type">
          <button type="button" data-mode="instrumental" aria-pressed="true">${tr('Instrumental')}</button>
          <button type="button" data-mode="withLyrics" aria-pressed="false">${tr('With lyrics')}</button>
        </div>
        <label class="ft-cloud-gen-lyrics" data-field="cloud-lyrics-field" hidden>${tr('Lyrics')}<textarea data-field="cloud-lyrics" maxlength="3000" rows="3" aria-label="Song lyrics"></textarea></label>
        <div class="ft-cloud-gen-row">
          <button type="button" class="ft-score-primary" data-action="cloud-generate">${tr('Generate song')}</button>
          <button type="button" data-action="cloud-regenerate" hidden>${tr('Regenerate')}</button>
        </div>
        <div class="ft-cloud-gen-results" data-field="cloud-results"></div>
        <section class="ft-cloud-gen-history" data-field="cloud-history" hidden>
          <h4>${tr('History')}</h4>
          <div data-field="cloud-history-list"></div>
        </section>
        <p class="ft-score-caption" data-field="cloud-note" data-error="false" aria-live="polite">${tr('Songs are generated in the cloud. Sign in on flowtu.cn to use this.')}</p>
      </div>`
    parent.append(element)
    const modelSelect = element.querySelector<HTMLSelectElement>('[data-field=cloud-model]')!
    const countSelect = element.querySelector<HTMLSelectElement>('[data-field=cloud-count]')!
    const credits = element.querySelector<HTMLOutputElement>('[data-field=cloud-credits]')!
    const modeButtons = [...element.querySelectorAll<HTMLButtonElement>('[data-mode]')]
    const lyricsField = element.querySelector<HTMLElement>('[data-field=cloud-lyrics-field]')!
    const lyrics = element.querySelector<HTMLTextAreaElement>('[data-field=cloud-lyrics]')!
    const generateButton = element.querySelector<HTMLButtonElement>('[data-action=cloud-generate]')!
    const regenerateButton = element.querySelector<HTMLButtonElement>('[data-action=cloud-regenerate]')!
    const results = element.querySelector<HTMLElement>('[data-field=cloud-results]')!
    const historySection = element.querySelector<HTMLElement>('[data-field=cloud-history]')!
    const historyList = element.querySelector<HTMLElement>('[data-field=cloud-history-list]')!
    const note = element.querySelector<HTMLOutputElement>('[data-field=cloud-note]')!
    const tell = (message: string, error = false) => {note.textContent = message; note.dataset.error = String(error)}
    let models: StudioModel[] = [], running = false, lastGenerationKey: string | undefined, lastExpectedCount = 1, lastProjectScope: string | undefined
    const pollControl = new AbortController()
    const mediaUrls = new Map<HTMLAudioElement,string>()
    const releaseAudio = (root: Element) => {
        for (const audio of root.querySelectorAll('audio')) {
            const url = mediaUrls.get(audio)
            if (url) {audio.pause(); audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); mediaUrls.delete(audio)}
        }
    }
    const selectedModel = (): StudioModel | undefined => models.find(candidate => candidate.model === modelSelect.value)
    const paintCredits = () => {
        const model = selectedModel()
        credits.textContent = model ? `≈ ${model.creditHint * (Number(countSelect.value) || 1)} ${tr('credits')}` : ''
    }
    const paintModel = () => {
        const model = selectedModel()
        countSelect.replaceChildren()
        if (model) for (let index = 1; index <= model.maxCount; index++) countSelect.add(new Option(String(index), String(index)))
        countSelect.value = '1'
        paintCredits()
        const lyricsAllowed = model?.capabilities.withLyrics !== false
        if (!lyricsAllowed && modeButtons[1].getAttribute('aria-pressed') === 'true') modeButtons[0].click()
        modeButtons[1].disabled = !lyricsAllowed
    }
    const paintRecovery = async () => {
        const scope = host.generationScope()
        const library = await cloudLibrary()
        if (pollControl.signal.aborted || host.generationScope() !== scope) return
        const pending = scope && library.kind === 'online' && pendingGenerations({accountId: library.library.accountId, projectScope: scope}).length > 0
        generateButton.textContent = tr(pending ? 'Resume generation' : 'Generate song')
    }
    const setRunning = (value: boolean) => {
        running = value
        modelSelect.disabled = value; countSelect.disabled = value; lyrics.disabled = value
        generateButton.disabled = value || !models.length
        regenerateButton.disabled = value
    }
    const songRow = (song: SongRow, onAdd?: (song: SongRow) => Promise<void>) => {
        const row = document.createElement('div')
        row.className = 'ft-cloud-song'
        const heading = document.createElement('strong'); heading.textContent = song.title || tr('Untitled song')
        const duration = document.createElement('small'); duration.textContent = formatDuration(song.durationMs)
        const audio = document.createElement('audio')
        audio.controls = true; audio.preload = 'none'; audio.hidden = true
        audio.onloadedmetadata = () => {duration.textContent = formatDuration(audio.duration * 1000)}
        const preview = document.createElement('button'); preview.type = 'button'; preview.textContent = tr('Preview song')
        preview.disabled = !song.playUrl
        preview.onclick = async () => {
            preview.disabled = true
            try {
                const blob = await fetchStudioAudio(song.playUrl!, pollControl.signal)
                if (!audio.isConnected || pollControl.signal.aborted) return
                const url = URL.createObjectURL(blob); mediaUrls.set(audio,url)
                audio.src = url; audio.hidden = false; preview.hidden = true
                // Controls remain available when the browser requires a second play gesture.
                await audio.play().catch(() => {})
            } catch (error) {
                if (!pollControl.signal.aborted) tell(error instanceof Error ? tr(error.message) : String(error), true)
            } finally {preview.disabled = !song.playUrl}
        }
        row.append(heading, duration, preview, audio)
        if (onAdd) {
            const add = document.createElement('button'); add.type = 'button'
            add.className = 'ft-cloud-add'; add.textContent = tr('Add to project')
            add.onclick = () => {add.disabled = true; void onAdd(song).catch(error => tell(error instanceof Error ? tr(error.message) : String(error), true)).finally(() => add.disabled = false)}
            row.append(add)
        }
        return row
    }
    const renderSongs = (songs: SongRow[], onAdd?: (song: SongRow) => Promise<void>) => {
        releaseAudio(results)
        results.replaceChildren(...songs.map(song => songRow(song, onAdd)))
    }
    const refreshHistory = async () => {
        const projectId = host.cloudProjectId()
        if (!projectId) {historySection.hidden = true; releaseAudio(historyList); historyList.replaceChildren(); return}
        historySection.hidden = false
        releaseAudio(historyList)
        historyList.replaceChildren()
        try {
            const records = await listProjectGenerations(projectId)
            if (host.cloudProjectId() !== projectId || pollControl.signal.aborted) return
            if (!records.length) {
                const empty = document.createElement('p'); empty.className = 'ft-cloud-history-empty'
                empty.textContent = tr('No generations saved for this project yet.')
                historyList.append(empty); return
            }
            for (const record of records) historyList.append(historyRecord(record))
        } catch {historySection.hidden = true}
    }
    const historyRecord = (record: GenerationRecord) => {
        const box = document.createElement('div'); box.className = 'ft-cloud-record'
        const header = document.createElement('div'); header.className = 'ft-cloud-record-head'
        const label = document.createElement('small'); label.textContent = shortKey(record.generationKey)
        const tools = document.createElement('span')
        const again = document.createElement('button'); again.type = 'button'; again.textContent = tr('Regenerate')
        again.onclick = () => void generate(async () => await regenerateGeneration(record.generationKey), record.input?.count ?? 1)
        tools.append(again)
        if (record.input) {
            const load = document.createElement('button'); load.type = 'button'; load.textContent = tr('Load settings')
            load.onclick = () => run(() => loadInput(record.input!, record.generationKey))
            tools.append(load)
        }
        header.append(label, tools); box.append(header)
        for (const song of record.songs ?? []) box.append(songRow(song, host.addToProject))
        return box
    }
    const loadInput = (snapshot: NonNullable<GenerationRecord['input']>, generationKey: string) => {
        const model = models.find(candidate => candidate.model === snapshot.model)
        if (model) {
            modelSelect.value = model.model; paintModel()
            const count = Math.min(Math.max(1, Math.floor(snapshot.count || 1)), model.maxCount)
            countSelect.value = String(count)
            paintCredits()
        }
        const withLyrics = snapshot.contentType === 'withLyrics'
        if (withLyrics || lyrics.value) {modeButtons[withLyrics ? 1 : 0].click(); lyrics.value = snapshot.lyrics ?? ''}
        const axes = fromApiDirection(snapshot.direction)
        const style = fromApiStyle(snapshot.style) as ScoreDirection['style']
        const direction: ScoreDirection | undefined = axes || style !== 'prompt' ? {...neutralDirection, ...axes, style} : undefined
        host.applyInput({prompt: snapshot.prompt ?? '', start: snapshot.inSec, end: snapshot.outSec,
            direction, style})
        tell(tr('Loaded the generation settings.') + ` (${shortKey(generationKey)})`)
    }
    const run = (action: () => void) => {try {action()} catch (error) {tell(error instanceof Error ? tr(error.message) : String(error), true)}}
    const generate = async (submit: (input: CloudGenerationInput, model: StudioModel, context: GenerationContext, projectId?: string) => Promise<SubmitResult & {clientRequestId?: string}>, requestedCount = Number(countSelect.value) || 1) => {
        if (running) return
        let input: CloudGenerationInput | undefined, model: StudioModel | undefined
        try {
            input = host.currentInput()
            if (!input) {tell(tr('Open or create a project first.'), true); return}
            model = selectedModel()
            if (!model) {tell(tr('Choose a generation model first.'), true); return}
        } catch (error) {
            tell(error instanceof Error ? tr(error.message) : String(error), true)
            return
        }
        setRunning(true); renderSongs([])
        try {
            const projectScope = host.generationScope()
            const library = await cloudLibrary()
            if (!projectScope || library.kind !== 'online') throw new Error(tr(library.kind === 'guest'
                ? 'Sign in on flowtu.cn to continue.' : 'Cloud unavailable. Resume your generation when connected.'))
            if (host.generationScope() !== projectScope) return
            const context = {accountId: library.library.accountId, projectScope}
            const pending = pendingGenerations(context)[0]
            const id = host.cloudProjectId()
            const projectId = library.library.projects.some(project => project.id === id) ? id : undefined
            const submitted = pending ? await resumeGeneration(pending.clientRequestId, context, {signal: pollControl.signal})
                : await submit(input, model, context, projectId)
            const expectedCount = pending?.request.count ?? requestedCount
            lastProjectScope = projectScope
            lastExpectedCount = expectedCount
            lastGenerationKey = submitted.generationKey
            regenerateButton.hidden = false
            tell(tr('Your audio is being generated…'))
            const state = await pollGeneration(submitted.generationKey, {signal: pollControl.signal,
                onState: state => {if (host.generationScope() === projectScope && state.status === 'running') tell(tr('Your audio is being generated…'))}})
            if (host.generationScope() !== projectScope) return
            const currentLibrary = await cloudLibrary()
            if (host.generationScope() !== projectScope) return
            if (currentLibrary.kind !== 'online' || currentLibrary.library.accountId !== context.accountId)
                throw new Error(tr('Sign in on flowtu.cn to continue.'))
            if (submitted.clientRequestId) forgetGeneration(submitted.clientRequestId)
            // Keep playable successes even when the aggregate state is failed.
            const songs = (state.songs ?? []).filter(song => !!song.playUrl && !song.errorCode)
            renderSongs(songs, host.addToProject)
            const failed = state.status === 'failed'
            const partial = submitted.partial || songs.length < expectedCount
            if (failed && !songs.length) throw new Error(generationFailureMessage(state) ?? tr('The generation failed. Try again.'))
            // PRD §2.1: naming happens once, when the first batch creates the cloud project.
            if (songs.length && !host.cloudProjectId()) {
                const name = await requestGenerationProjectName(pending?.request.prompt ?? input.prompt)
                if (host.generationScope() !== projectScope) return
                if (name) {
                    const saveLibrary = await cloudLibrary()
                    if (host.generationScope() !== projectScope) return
                    if (saveLibrary.kind !== 'online' || saveLibrary.library.accountId !== context.accountId)
                        throw new Error(tr('Sign in on flowtu.cn to continue.'))
                    await host.saveProjectForGeneration(name, submitted.generationKey)
                }
            }
            await refreshHistory()
            tell(failed ? generationFailureMessage(state) ?? tr('Some songs failed. Available songs are kept below.')
                : partial ? tr('Only {0} of {1} songs are available. You can generate another song separately.', songs.length, expectedCount)
                : tr('Preview the songs below.'), failed || !!partial)
        } catch (error) {
            if (pollControl.signal.aborted) return
            const message = error instanceof Error ? tr(error.message) : String(error)
            tell(isAuthError(error) ? tr('Sign in on flowtu.cn to continue.') : message, true)
        } finally {setRunning(false); void paintRecovery()}
    }
    generateButton.onclick = () => void generate(async (input, model, context, projectId) => {
        const result = await submitGeneration({
            prompt: input.prompt, lyrics: lyrics.value, contentType: lyricsField.hidden ? 'instrumental' : 'withLyrics',
            model: model.model, count: Number(countSelect.value) || 1, style: input.style,
            direction: input.direction, inSec: input.start, outSec: input.end, projectId
        }, model, {context, signal: pollControl.signal})
        return result
    })
    regenerateButton.onclick = () => {
        if (!lastGenerationKey || lastProjectScope !== host.generationScope()) return
        void generate(async () => await regenerateGeneration(lastGenerationKey!), lastExpectedCount)
    }
    for (const button of modeButtons) button.onclick = () => {
        for (const other of modeButtons) other.setAttribute('aria-pressed', String(other === button))
        lyricsField.hidden = button.dataset.mode !== 'withLyrics'
    }
    modelSelect.onchange = paintModel
    countSelect.onchange = paintCredits
    element.addEventListener('toggle', () => {if (element.open) {void refreshHistory(); void paintRecovery()}})
    setRunning(true)
    void fetchStudioModelsSafe()
    async function fetchStudioModelsSafe() {
        try {
            models = await fetchStudioModels()
            modelSelect.replaceChildren(...models.map(candidate => new Option(candidate.label, candidate.model)))
            paintModel()
            tell(models.length ? tr('Songs are generated in the cloud and stay linked to this project.') : tr('Cloud generation is unavailable for this account.'))
        } catch (error) {
            models = []; modelSelect.replaceChildren(); paintModel()
            tell(error instanceof Error && error.message ? error.message : tr('Cloud generation is unavailable for this account.'), true)
        } finally {setRunning(false); void paintRecovery()}
    }
    return {element, refreshHistory, dispose: () => {pollControl.abort(); releaseAudio(element)}}
}
