import {Files} from '@opendaw/lib-dom'
import {chooseFileDestination, saveCancelled, saveNativeFile} from './flowtu/file-destination'
import {seekTimeline, timelinePosition} from './flowtu/timeline-seek'
import {displayTrack} from "./flowtu/playback-lanes"
// Flowtu integration for openDAW 0.3.2. Licensed AGPL-3.0-or-later.
import './flowtu.css'
import './flowtu/workspace-menu.css'
import {createToolbarMenu} from './flowtu/ToolbarMenu'
import {installStudioLanguage, tr} from './flowtu/studio-language'
import {installStudioSettings} from './flowtu/StudioSettings'
import {installRoutingCanvas} from './flowtu/RoutingCanvas'
import {installAudioTools} from './flowtu/AudioTools'
import {installEditingToolbar} from './flowtu/EditingToolbar'
import {installFloatingVideo} from './flowtu/FloatingVideo'
import {installVideoWindow} from './flowtu/VideoWindow'
import {importMedia, mediaKind, importTargets, type MediaDestination} from './flowtu/media-import'
import {chooseMediaDestination} from './flowtu/MediaImportDialog'
import {inScoringWorkspace} from './flowtu/studio-mode'
import {focusScoringTake, readScoring, takeRegion} from './flowtu/scoring-model'
import {requestScoringCue} from './flowtu/scoring-selection'
import {chooseVideoImportOptions} from './flowtu/VideoImportDialog'
import {importVideoOriginalAudio} from './flowtu/VideoImport'
import {referenceVideoSeekTime} from './flowtu/VideoImportTiming'
import {installScoringWorkspace} from './flowtu/ScoringWorkspace'
import {installLiteStudio} from './flowtu/LiteStudio'
import {startInLite, startWithLiteDemo, showExampleEdit} from './flowtu/lite-entry'
import {canLoadLiteDemo, loadLiteDemo} from './flowtu/LiteDemo'
import {inspectVideoSource,videoSourceDescription,type VideoSourceInfo} from './flowtu/video-source'
import {addFilmSheet, rememberFilmSource, adoptFilmSheet, currentFilm, newFilmSheet, readFilmBook, updateFilmTrack, watchFilmBook} from './flowtu/film-sheets'
import {installFilmSheetControls} from './flowtu/FilmSheetEditor'
import {backgroundReportRevision, readPictureReport, storePictureReport} from './flowtu/lite-model'
import {timeSettings, setTimeSettings} from './flowtu/time-settings'
import {getFrameRate} from './flowtu/time-format'
import {PanelType} from './ui/workspace/PanelType'
import {StudioService} from './service/StudioService'
import {InstrumentFactories} from '@opendaw/studio-adapters'
import {Project, ProjectBundle, ProjectMeta, ProjectProfile} from '@opendaw/studio-core'
import {encodeStudioBundle} from './flowtu/retained-preset-resources'
import {Option, Progress, UUID} from '@opendaw/lib-std'
import {PPQN} from '@opendaw/lib-dsp'
import {AnimationFrame, Browser} from '@opendaw/lib-dom'
import {resetHint} from './ui/hooks/control-reset'
import {Surface} from './ui/surface/Surface'
import {chooseSavedProject, chooseProjectLocation, type SaveLocation, chooseConflictCopy, rememberOpenedProject, type LibraryChoice} from './flowtu/ProjectLibraryDialog'
import {decodeProjectArchive, encodeProjectArchive, type SavedProjectTitle} from './flowtu/project-archive'
import {cloudLibrary, accountOwner, guestOwner, readDeviceProject, saveDeviceProject, readCloudProject,
    cacheCloudProject, syncProject, ProjectConflict, type ProjectEntry} from './flowtu/project-library'

import {setWorkAreaPictureEnd} from "./flowtu/work-area"

export function installFlowtu(service: StudioService, ground: Element) {
    // Third-party exporters, including DAWproject, delegate their final write to this SDK entry.
    Object.assign(Files, {save:saveNativeFile})
    const bar = document.createElement('div')
    bar.className = 'flowtu-bar'
    bar.innerHTML = `<div class="flowtu-brand"><img src="/flowtu-wordmark.png" alt="flowtu" width="994" height="210"><span>STUDIO.</span></div>
      <button data-action="library" aria-expanded="false">Library</button><button data-action="devices" aria-expanded="false">Inserts</button><button data-action="new">New Project</button><select aria-label="Audio import track"></select>
      <button data-action="audio">Import audio or MIDI</button><button data-action="video">Video</button>
      <button data-action="save">Save</button>
      <button data-action="open">Open project</button><button data-action="save-copy">Save as copy</button><button data-action="import-project">Import project file…</button><button data-action="export-project">Export project copy…</button><button data-action="wav">Export WAV</button>
      <span class="flowtu-status" role="status">Starting audio engine…</span><button data-action="help">Help</button>
      <a href="/source.html" target="_blank" rel="noopener">Source</a>`
    const home = document.createElement('a')
    home.className = 'flowtu-home'
    home.dataset.i18n = ''
    home.href = import.meta.env.VITE_FLOWTU_HOME_URL || 'https://flowtu-studio-home-2026.coykaka.chatgpt.site/'
    home.target = '_top'
    // The hosted Studio has a native beforeunload guard. Its localhost build
    // skips that guard, so use the same dirty-project check as File → Open.
    home.onclick = async event => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
            || !Browser.isLocalHost() || !service.hasProfile || !service.projectProfileService.hasUnsavedChanges()) return
        event.preventDefault()
        if (await service.projectProfileService.approveLosingChanges()) window.open(home.href, '_top')
    }
    home.title = 'Flowtu home'
    home.textContent = 'Home'
    bar.querySelector('.flowtu-brand')!.before(home)
    ground.prepend(bar)
    const routing = document.createElement('button')
    routing.textContent = 'Routing'
    routing.title = 'Open audio routing canvas'
    bar.querySelector('[role=status]')!.before(routing)
    installRoutingCanvas(service, routing)
    installAudioTools(service,bar)
    const status = bar.querySelector<HTMLElement>('[role=status]')!
    const select = bar.querySelector('select')!
    const videoPanel = document.createElement('aside')
    videoPanel.className = 'flowtu-video'
    videoPanel.hidden = true
    videoPanel.innerHTML = `<header><strong>REFERENCE VIDEO</strong><button class="popout-video" title="Open video in a separate window for another display">Pop out</button><button class="hide-video" aria-label="Hide video">−</button></header>
      <video muted playsinline preload="auto"></video><div class="flowtu-video-meta"><span class="video-name">No video loaded</span><output>00:00.000</output></div>
      <div class="flowtu-video-tools"><label>Offset <input aria-label="Video offset in seconds" type="number" value="0" step="0.01"> s</label><button class="replace-video">Replace</button></div>
      <p>Synced to transport · Video audio muted</p>`
    document.body.append(videoPanel)
    const floatingVideo = installFloatingVideo(videoPanel)
    const video = videoPanel.querySelector('video')!
    let scoring: ReturnType<typeof installScoringWorkspace> | undefined
    let lite: ReturnType<typeof installLiteStudio> | undefined
    let videoDock: HTMLElement | null = null
    let hideFloatingMonitor = false
    video.muted = true
    const videoName = videoPanel.querySelector('.video-name')!
    const videoClock = videoPanel.querySelector('output')!
    const offsetInput = videoPanel.querySelector('input')!
    let videoFile: File | undefined, videoUrl = '', offset = 0, busy = false
    let videoSource: VideoSourceInfo | undefined
    let videoRevision = 0, cancelVideoLoad: (() => void) | undefined
    let lastTrackSignature = ''
    let pendingPlay: HTMLVideoElement | undefined
    const tell = (message: string) => {status.textContent = message; status.title = message}
    const dockVideo = () => {
        if (videoDock?.isConnected) {
            if (video.parentElement !== videoDock) videoDock.append(video)
            videoPanel.hidden = true
        } else {
            if (video.parentElement !== videoPanel) videoPanel.insertBefore(video, videoPanel.querySelector('.flowtu-video-meta'))
            if (videoFile && !hideFloatingMonitor) floatingVideo.reveal()
            else videoPanel.hidden = true
        }
    }
    const videoWindow = installVideoWindow({
        video, restore: dockVideo, tell,
        attachTransport: (doc, target, full, dock) => scoring!.attachTransport(doc, target, full, dock),
        setFrameWindow: popup => {
            let visible: Window | undefined
            Surface.forEach(surface => {
                if (!visible && !surface.owner.closed && !surface.owner.document.hidden) visible = surface.owner
            })
            if (visible || !popup) {AnimationFrame.start(visible ?? window); return}
            // SDK compares successive RAF times across windows. A new popup's raw
            // timestamps start at zero; express them on the Studio's time origin.
            const driver: Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'> = {
                requestAnimationFrame: callback => popup.requestAnimationFrame(() => callback(performance.now())),
                cancelAnimationFrame: id => popup.cancelAnimationFrame(id)
            }
            AnimationFrame.start(driver as Window)
        },
        onChange: (detached) => {
            if (detached) videoPanel.hidden = true
            scoring?.refreshVideo()
        },
        togglePlayback: () => {if (service.hasProfile) service.engine.isPlaying.getValue() ? service.engine.stop() : service.engine.play()},
        markCue: () => scoring?.markCueAtPlayhead() ?? false,
        macOS: Browser.isMacOS(),
        returnToStart: () => {if (service.hasProfile) seekTimeline(service.project, 0)},
        stopPlayback: () => {if (service.hasProfile) service.engine.stop()}
    })
    const openVideoWindow = () => {
        if (!videoFile || video.readyState < 1) {tell('Import a reference video first.'); return}
        if (videoWindow.open()) tell('Video opened in a separate window · Drag it to your other display.')
    }
    const run = async (action: () => Promise<void>) => {
        if (busy) return
        busy = true
        bar.setAttribute('aria-busy', 'true')
        try {await action()} catch (error) {console.error(error); tell(`Unable to complete: ${error instanceof Error ? error.message : String(error)}`)}
        finally {busy = false; bar.removeAttribute('aria-busy')}
    }
    const chooseFiles = (accept: string, multiple: boolean, submit: (files: File[]) => void) => {
        const input = document.createElement('input')
        input.type = 'file'; input.accept = accept; input.multiple = multiple; input.hidden = true
        input.onchange = () => {const files = Array.from(input.files ?? []); input.remove(); if (files.length) submit(files)}
        input.oncancel = () => input.remove()
        document.body.append(input); input.click()
    }
    const choose = (accept: string, action: (file: File) => Promise<void>) =>
        chooseFiles(accept,false,files => {void run(() => action(files[0]))})
    const setVideo = async (file?: File, knownSource?:VideoSourceInfo, matchTimeline=false) => {
        lite?.analysis.cancel()
        const revision = ++videoRevision
        if (service.hasProfile) setWorkAreaPictureEnd(service.project, 0)
        cancelVideoLoad?.(); cancelVideoLoad = undefined
        video.onloadedmetadata = null; video.onerror = null
        video.pause(); video.removeAttribute('src'); video.load()
        if (videoUrl) URL.revokeObjectURL(videoUrl)
        videoUrl = ''; videoFile = file; videoSource = undefined;videoName.removeAttribute('title')
        if (!file) {videoWindow.dock(); videoPanel.hidden = true; scoring?.refreshVideo(); lite?.analysis.restored(); lite?.refresh(); return}
        videoUrl = URL.createObjectURL(file)
        videoName.textContent = file.name
        if (!videoDock && !hideFloatingMonitor && !videoWindow.isOpen()) floatingVideo.reveal()
        try {
            await new Promise<void>((resolve, reject) => {
                cancelVideoLoad = () => reject(new Error('Video import cancelled: the project or reference changed.'))
                video.onloadedmetadata = () => resolve()
                video.onerror = () => reject(new Error('Video format not supported. Use H.264 MP4 or WebM.'))
                video.src = videoUrl
                if (videoWindow.picture) videoWindow.picture.src = videoUrl
            })
            if (revision !== videoRevision) throw new Error('Reference video changed.')
            // Size the first decoded frame immediately; container metadata can take much longer to scan.
            scoring?.refreshVideo(); lite?.refresh()
            const source = knownSource ?? await inspectVideoSource(file,video.videoWidth,video.videoHeight,video.duration)
            if (revision!==videoRevision) throw new Error('Video import cancelled: the project or reference changed.')
            videoSource=source
            videoName.setAttribute('title',videoSourceDescription(source))
            if (matchTimeline && source.frameRate) setTimeSettings({fps:source.frameRate})
        } catch (error) {
            if (revision === videoRevision) {
                videoFile = undefined; videoPanel.hidden = true
                videoWindow.dock()
                video.removeAttribute('src'); video.load()
                if (videoUrl) URL.revokeObjectURL(videoUrl)
                videoUrl = ''
            }
            throw error
        } finally {
            if (revision === videoRevision) {
                cancelVideoLoad = undefined; video.onloadedmetadata = null; video.onerror = null
                scoring?.refreshVideo();lite?.analysis.restored();lite?.refresh()
            }
        }
        if (service.hasProfile) setWorkAreaPictureEnd(service.project, offset + video.duration)
        tell('Reference video synced to transport')
    }
    const filmFiles = new WeakMap<Project,Map<string,File>>()
    const filesOf = (project:Project) => {
        let files=filmFiles.get(project)
        if (!files) {files=new Map();filmFiles.set(project,files)}
        return files
    }
    const getActiveVideoId = () => {
        const active=service.hasProfile ? currentFilm(service.project) : undefined
        return active?.hasVideo ? active.id : undefined
    }
    const listProjectVideos = () => !service.hasProfile ? [] : readFilmBook(service.project).sheets.flatMap(({id})=>{
        const file=filesOf(service.project).get(id)
        return file ? [{id,file}] : []
    })
    async function restoreProjectVideos(files:Map<string,File>,activeFile?:File) {
        const project=service.project, sheet=currentFilm(project)
        filmFiles.set(project,files)
        if (sheet) {
            if (activeFile) files.set(sheet.id,activeFile)
            offset=sheet.offset; offsetInput.value=String(offset)
        }
        const file=sheet ? files.get(sheet.id) : activeFile
        await setVideo(file,sheet?.source)
        if (file && sheet && !sheet.source && videoSource && service.hasProfile && service.project===project) {
            rememberFilmSource(project,sheet.id,videoSource)
        }
        if (file && !sheet && service.hasProfile && service.project===project) {
            const legacy=newFilmSheet(file.name,video.duration,offset,videoSource)
            files.set(legacy.id,file)
            adoptFilmSheet(project,legacy)
        }
    }
    async function importFilm(file:File) {
        const project=service.project, previous=videoFile, previousSource=videoSource
        try {await setVideo(file,undefined,true)} catch (error) {
            if (service.hasProfile && service.project===project && !videoFile && previous) await setVideo(previous,previousSource)
            throw error
        }
        if (!service.hasProfile || service.project!==project || videoFile!==file) throw new Error('The active project or film changed.')
        const sheet=newFilmSheet(file.name,video.duration,offset,videoSource)
        filesOf(project).set(sheet.id,file)
        addFilmSheet(project,sheet)
        lite?.analysis.restored()
        lite?.refresh()
    }
    // Undo, redo and the page switcher all change the same native metadata. Defer until
    // the graph transaction is complete so its restored cues and report are available.
    let filmSubscription:ReturnType<typeof watchFilmBook>|undefined
    function bindFilms() {
        filmSubscription?.terminate()
        if (!service.hasProfile) return
        const project=service.project
        filmSubscription=watchFilmBook(project,()=>queueMicrotask(()=>{
            if (!service.hasProfile || service.project!==project) return
            const sheet=currentFilm(project), next=sheet && filesOf(project).get(sheet.id)
            if (sheet) {offset=sheet.offset;offsetInput.value=String(offset)}
            if (next===videoFile) return
            service.engine.stop()
            void setVideo(next,sheet?.source,true).then(()=>{
                if (sheet && !sheet.source && videoSource && service.hasProfile && service.project===project && videoFile===next)
                    rememberFilmSource(project,sheet.id,videoSource)
                if (next && service.hasProfile && service.project===project && videoFile===next && !readPictureReport(project))
                    void lite?.analysis.analyze('automatic')
            }).catch(error=>{if (currentFilm(project)?.id===sheet?.id) tell(String(error))})
        }))
    }
    const refreshTracks = () => {
        const targets = service.hasProfile ? importTargets(service.project, 'audio') : []
        const signature = JSON.stringify(targets)
        if (signature === lastTrackSignature) return
        lastTrackSignature = signature
        const previous = select.value
        select.replaceChildren(...targets.map(({id,name}) => new window.Option(name,id)))
        if (targets.some(t => t.id === previous)) select.value = previous
    }
    async function newProject(withNotes = false, starterClip = true) {
        if (!await service.projectProfileService.approveLosingChanges()) return
        service.engine.stop(true)
        const project = Project.new(service)
        project.editing.modify(() => {
            project.api.setBpm(120)
            for (let i = 0; i < 3; i++) {
                const product = project.api.createInstrument(InstrumentFactories.Tape, {name: `${String(i + 1).padStart(2,'0')} · AUDIO`})
                product.audioUnitBox.volume.setValue(-9)
            }
            const product = project.api.createInstrument(InstrumentFactories.Vaporisateur, {name: '04 · MIDI / SYNTH'})
            product.audioUnitBox.volume.setValue(-15)
            if (starterClip) {
                const region = project.api.createNoteRegion({trackBox: product.trackBox, position: 0, duration: PPQN.Bar * 4, name: tr('Double-click to edit notes')})
                region.hue.setValue(207)
                if (withNotes) [60, 64, 67, 71, 69, 67, 64, 62].forEach((pitch, i) =>
                    project.api.createNoteEvent({owner: region, position: i * PPQN.Quarter * 2, duration: PPQN.Quarter * 1.5, pitch, velocity: .65}))
            }
            project.timelineBox.loopArea.from.setValue(0)
            project.timelineBox.loopArea.to.setValue(PPQN.Bar * 4)
        })
        service.projectProfileService.setValue(Option.wrap(new ProjectProfile(UUID.generate(), project, ProjectMeta.init('Flowtu Session'), Option.None)))
        setTimeSettings({display: 'time', fps: '25'})
        offset = 0; offsetInput.value = '0'; await setVideo()
        checkpoint()
        refreshTracks()
        tell('3 audio tracks + 1 MIDI track · Space to play')
    }
    type ImportOptions = {assetsFirst?: boolean; trackId?: string; position?: number; quickTimeline?:boolean}
    async function placeFiles(files: readonly File[], options: ImportOptions = {}): Promise<readonly File[]> {
        const accepted: File[] = []
        if (busy) {tell('Finish the current import or export first.'); return accepted}
        await run(async () => {
            if (!service.hasProfile) await newProject()
            if (!service.hasProfile) return
            const project = service.project, ask = inScoringWorkspace()
            let dropPosition = options.position
            for (const file of files) {
                if (!service.hasProfile || service.project !== project) break
                const kind = mediaKind(file)
                if (!kind) {tell('Choose an audio or MIDI file.'); continue}
                const targets = importTargets(project,kind)
                const focused = project.timelineFocus.track.mapOr(t => UUID.toString(displayTrack(t).uuid), '')
                const preferred = options.trackId ?? (targets.some(t => t.id === focused) ? focused : select.value)
                let destination: MediaDestination | undefined
                const atPointer = options.position !== undefined && !!options.trackId && targets.some(target=>target.id===options.trackId)
                if (atPointer) {
                    destination = {kind:'existing',trackId:options.trackId!,atPointer:true}
                } else if (options.quickTimeline) {
                    const emptyIds = new Set(project.rootBoxAdapter.audioUnits.adapters().flatMap(unit=>unit.tracks.values()
                        .filter(track=>track.regions.collection.asArray().length===0).map(track=>UUID.toString(track.uuid))))
                    const target=targets.find(t=>t.id===preferred && emptyIds.has(t.id)) ?? targets.find(t=>emptyIds.has(t.id))
                    destination=target ? {kind:'existing',trackId:target.id} : {kind:'new'}
                } else if (ask || kind === 'midi') {
                    destination = await chooseMediaDestination(file, targets, preferred, options.assetsFirst)
                } else {
                    const track = targets.find(t => t.id === select.value) ?? targets[0]
                    destination = track ? {kind:'existing', trackId:track.id} : {kind:'new'}
                }
                if (!destination) continue
                if (!service.hasProfile || service.project !== project) break
                tell('Importing ' + file.name + '…')
                try {
                    const id = await importMedia(service, file, destination, atPointer ? dropPosition : options.position)
                    accepted.push(file)
                    const region = takeRegion(project,id)
                    if (destination.kind === 'assets') scoring?.showAssets()
                    else if (region) {
                        refreshTracks()
                        if (kind === 'audio') select.value = UUID.toString(region.trackBoxAdapter.unwrap().uuid)
                        if (atPointer) dropPosition=Math.ceil(region.complete)
                        else service.timeline.range.showUnitInterval(0, Math.max(PPQN.Bar * 4, region.complete + PPQN.Bar))
                    }
                    tell(destination.kind === 'assets' ? file.name + ' added to Assets' : 'Imported ' + file.name)
                } catch (error) {tell(file.name + ' · ' + (error instanceof Error ? error.message : String(error)))}
            }
        })
        return accepted
    }
    const pickMedia = (options: ImportOptions = {}, midiOnly = false) =>
        chooseFiles(midiOnly ? '.mid,.midi,.smf,.kar' : 'audio/*,.aif,.aiff,.wav,.flac,.mp3,.m4a,.mid,.midi,.smf,.kar',
            true, files => {void placeFiles(files, options)})
    let shelfEntry: ProjectEntry | undefined
    let lastLocation:SaveLocation|undefined, lastProjectFile:FileSystemFileHandle|undefined
    let savedState: {profile: ProjectProfile; metadata: string; cover: unknown; videoRevision: number} | undefined
    const stateStamp = () => JSON.stringify([service.profile.meta, offset, timeSettings, backgroundReportRevision(service.project)])
    function checkpoint() {
        service.project.editing.markSaved()
        savedState = {profile: service.profile, metadata: stateStamp(), cover: service.profile.cover.unwrapOrNull(), videoRevision}
    }
    function projectStatus(message: string) {
        tell(message)
        const heading = ground.querySelector('.ft-lite-topline h1')
        if (!heading) return
        let output = heading.parentElement!.querySelector<HTMLElement>('.ft-project-status')
        if (!output) {
            output = document.createElement('small')
            output.className = 'ft-project-status'; output.setAttribute('role','status')
            heading.after(output)
        }
        output.textContent = message
    }
    const dirty = () => {
        if (!service.hasProfile) return false
        if (savedState?.profile !== service.profile) return service.profile.hasUnsavedChanges() || !!videoFile
        return service.project.editing.hasUnsavedChanges() || savedState.metadata !== stateStamp() ||
            savedState.cover !== service.profile.cover.unwrapOrNull() || savedState.videoRevision !== videoRevision
    }
    async function snapshot(title?:SavedProjectTitle) {
        const settings = {...timeSettings}, position = offset
        const assets = listProjectVideos(), activeId = getActiveVideoId()
        const files = filesOf(service.project)
        // The player may still be unloading a removed reference. Save the film book's selection.
        const activeFile = activeId ? files.get(activeId) : files.size===0 ? videoFile : undefined
        const odb = await encodeStudioBundle(service.profile, Progress.Empty)
        return encodeProjectArchive(odb, position, settings, assets, activeId, activeFile,title)
    }
    async function saveProject(copy = false) {
        if (!service.hasProfile) throw new Error('Create a project first.')
        const profile = service.profile, stillOpen=()=>service.hasProfile && service.profile===profile
        let base = copy ? undefined : shelfEntry
        const account=cloudLibrary()
        const choice=await chooseProjectLocation(profile.meta.name + (copy ? ' (copy)' : ''),copy,lastLocation,account,lastProjectFile)
        if (!choice || !stillOpen()) return
        const {name,location}=choice
        const validateAccount=location==='cloud' || (location==='device' && base && base.owner!==guestOwner)
        const cloud=validateAccount ? await account : undefined
        if (!stillOpen()) return
        if (base && location!=='file' && base.owner!==guestOwner &&
            (cloud?.kind==='guest' || cloud?.kind==='online' && accountOwner(cloud.library.accountId)!==base.owner))
            throw new Error(tr('Switch back to the original account, or save as a copy.'))
        const owner = choice.location==='cloud' ? accountOwner(choice.account) : base?.owner ?? guestOwner
        if (base && base.owner !== owner) base=undefined
        const title={name,modified:new Date().toISOString()}
        const stamp = stateStamp(), revision = videoRevision, cover=profile.cover.unwrapOrNull()
        let changed = false
        const observer = profile.project.editing.subscribe(() => {changed = true})
        const committed=()=>{
            if (!stillOpen()) return
            const same = !changed && revision===videoRevision && stamp===stateStamp() && cover===profile.cover.unwrapOrNull()
            // The saved title lives in the snapshot manifest, so cancelling never renames or dirties the live graph.
            if (stamp===stateStamp()) {
                profile.updateMetaData('name',name);profile.updateMetaData('modified',title.modified)
            }
            lastLocation=location
            if (same) checkpoint()
            lite?.refresh()
        }
        try {
            const blob = await snapshot(title)
            if (choice.location==='file') {
                try {await choice.destination.write(blob)} catch(error) {if (saveCancelled(error)) return;throw error}
                if (!stillOpen()) return
                if (choice.destination.handle) {
                    lastProjectFile=choice.destination.handle;shelfEntry=undefined
                    committed()
                    projectStatus(tr('Project file saved.')+' '+choice.destination.name)
                } else {
                    // Browsers do not expose whether a regular download reached a chosen disk path.
                    projectStatus(tr('Project download requested.')+' '+choice.destination.name)
                }
                return
            }
            projectStatus(tr('Saving project…'))
            let local: ProjectEntry
            try {local = await saveDeviceProject(owner, name, blob, base)} catch (error) {
                if (!(error instanceof ProjectConflict)) throw error
                projectStatus(tr('Your edits are still open in this tab.'))
                if (await chooseConflictCopy(false)) await saveProject(true)
                return
            }
            if (stillOpen()) {shelfEntry=local;lastProjectFile=undefined}
            committed()
            if (choice.location==='cloud') {
                projectStatus(tr('Saved on this device · Syncing…'))
                try {
                    const synced = await syncProject(local, blob)
                    if (stillOpen()) shelfEntry = synced
                    projectStatus(tr('Project saved to your account.'))
                } catch (error) {
                    if (error instanceof ProjectConflict) {
                        projectStatus(tr('Your edits are saved in Device drafts. A newer version is in your account.'))
                        if (await chooseConflictCopy(true)) await saveProject(true)
                        return
                    }
                    projectStatus(tr('Saved on this device · Cloud sync pending.') + ' ' + (error instanceof Error ? error.message : String(error)))
                }
            } else projectStatus(tr('Saved in the device library.'))
        } catch (error) {
            projectStatus(error instanceof Error ? error.message : String(error))
            throw error
        } finally {observer.terminate()}
    }
    async function openProject(file: Blob, native = false, entry?: ProjectEntry) {
        projectStatus(tr('Opening project…'))
        const data = await decodeProjectArchive(file, native)
        const profile = await ProjectBundle.decode(service, data.odb)
        if (data.title) {
            profile.updateMetaData('name',data.title.name)
            profile.updateMetaData('modified',data.title.modified)
        }
        service.engine.stop(true)
        service.projectProfileService.setValue(Option.wrap(profile))
        setTimeSettings({display: 'time', fps: '25'})
        setTimeSettings(data.timeSettings)
        offset = data.offset; offsetInput.value = String(offset)
        await restoreProjectVideos(data.videos, data.nextVideo)
        shelfEntry = entry
        lastLocation=entry ? entry.owner===guestOwner ? 'device' : 'cloud' : file instanceof File ? 'file' : undefined
        checkpoint()
        lite?.refresh(); refreshTracks(); projectStatus(tr('Project restored · Ready to edit'))
    }
    const importProjectFile = () => choose('.flowtu,.zip,.odb', async file => {
        if (await service.projectProfileService.approveLosingChanges()) await openProject(file, file.name.toLowerCase().endsWith('.odb'))
    })
    async function browseProjects() {
        const choice = await chooseSavedProject()
        if (choice) await openLibraryChoice(choice)
    }
    async function openLibraryChoice(choice: LibraryChoice) {
        if (choice.kind === 'import') {importProjectFile(); return}
        if (choice.kind === 'legacy') {
            await service.projectProfileService.load(choice.item.uuid, choice.item.meta)
            if (service.hasProfile && UUID.equals(service.profile.uuid,choice.item.uuid)) rememberOpenedProject(choice)
            return
        }
        if (!await service.projectProfileService.approveLosingChanges()) return
        if (choice.kind === 'local') {
            if (choice.entry.owner !== guestOwner) {
                const cloud = await cloudLibrary()
                if (cloud.kind !== 'online' || choice.entry.owner !== accountOwner(cloud.library.accountId))
                    throw new Error(tr('Sign in to the project account to open this copy.'))
            }
            const record = await readDeviceProject(choice.entry.owner, choice.entry.id)
            await openProject(record.blob, false, record.entry)
        } else {
            const blob = await readCloudProject(choice.owner, choice.remote)
            // Keep a divergent device draft, opening the server version as a separate editable copy.
            if (choice.cached?.pending) {
                await openProject(blob); projectStatus(tr('Opened cloud version · Save creates a separate copy.'))
            } else {
                const record = await cacheCloudProject(choice.owner, choice.remote, blob, choice.cached)
                await openProject(blob, false, record)
            }
        }
        rememberOpenedProject(choice)
    }
    async function exportProjectCopy() {
        if (!service.hasProfile) return
        const name = service.profile.meta.name
        const project = service.project
        const dest = await chooseFileDestination(name + '.flowtu.zip')
        if (!dest || !service.hasProfile || service.project !== project) return
        projectStatus(tr('Exporting project copy…'))
        try {await dest.write(await snapshot())}
        catch (error) {
            if (!saveCancelled(error)) throw error
            projectStatus(tr('Save cancelled.'))
            return
        }
        projectStatus(tr('Project copy exported.'))
    }
    service.projectProfileService.workspaceFiles = {
        save: copy => run(() => saveProject(copy)), open: () => run(browseProjects),
        importFile: importProjectFile, exportFile: () => run(exportProjectCopy), dirty
    }
    const help = document.createElement('dialog')
    help.className = 'flowtu-help'
    help.innerHTML = `<h2>Your editing workspace</h2><ol>
      <li><b data-guide="guide.cues">Video scoring.</b> <span data-guide="guide.cues.text">Press M to mark the playhead during playback or create a cue from a stopped selection. Click a cue above the ruler to return to it and edit its range or music direction.</span></li>
      <li><b data-guide="guide.smart">Smart tool.</b> <span data-guide="guide.smart.text">Drag the upper part of a waveform to move the clip. Drag its center to select a time range. Use the edges to trim, the colored squares for fade length, and the round points for curve shape.</span></li>
      <li><b data-guide="guide.keys">Default editing keys.</b> <span data-guide="guide.keys.text">With an audio range selected, press B to cut both ends and select the middle. With no range, press B and click a waveform to split it.</span><b data-guide="guide.range">Range — R.</b> <span data-guide="guide.range.text">Drag a time range, then split, delete or loop it. Shift bypasses grid snapping for range selection.</span></li>
      <li><b data-guide="guide.tools">Tools.</b> <span data-guide="guide.tools.text">Choose an editing keymap or a device skin under File → Keyboard &amp; appearance. Open the tool picker to see the active bindings. Actions contains clip commands, view controls, automation and range editing.</span></li>
      <li><b data-guide="guide.snap">Snapping.</b> <span data-guide="guide.snap.text">Click the magnet or press N in the timeline to switch snapping on or off. Its arrow lets you choose clip edges, the grid, or both. When both are active, a nearby clip edge takes priority.</span></li>
      <li><b data-guide="guide.editor">Audio editor.</b> <span data-guide="guide.editor.text">The lower waveform follows the selected editing keymap. Cmd/Ctrl+B splits at the playhead or range boundaries. Cmd/Ctrl+A selects the clip's range; C/X/V copy, cut and paste with Cmd/Ctrl. Cmd/Ctrl+D duplicates the clip; Delete removes the range or clip. These actions target the clip open in the editor.</span></li>
      <li><b data-guide="guide.env">Volume automation.</b> <span data-guide="guide.env.text">Select a track and open Actions → Automation → Volume Env. Click the envelope to add nodes, drag to edit, Alt-click to delete. Read enables or bypasses automation.</span></li>
      <li><b data-guide="guide.fades">Fades &amp; gain.</b> <span data-guide="guide.fades.text" data-guide-arg="${Browser.isMacOS() ? '⌘' : 'Ctrl'}">Drag one audio clip over the end of another. Click the shaded overlap and drag its blue or orange curve handle. Clip Inspector also offers a timed A/B join. On knobs and faders, ${resetHint} the parameter.</span></li>
      <li><b data-guide="guide.piano">Piano roll.</b> <span data-guide="guide.piano.text">Double-click a MIDI clip to edit notes. Double-click the grid to add a note; drag notes to move or resize them.</span></li>
      <li><b data-guide="guide.time">Timing &amp; playback.</b> <span data-guide="guide.time.text">Space plays or pauses from anywhere outside a text field. Choose Time, Timecode or Time + frames in the transport. Select your video's frame rate and enter a position such as 00:00:18.20 to seek in Time + frames mode. The edit grid offers 10 ms and 1 frame snapping. Range Start and End fields allow exact selection boundaries.</span></li>
      <li><b data-guide="guide.zoom">Zoom.</b> <span data-guide="guide.zoom.text">Pinch the trackpad to zoom around the pointer. Fullscreen expands the workspace; pinch zoom also works there.</span></li>
      <li><b data-guide="guide.video">Reference video.</b> <span data-guide="guide.video.text">Import MP4 or WebM and enable Import original audio to create a separate soundtrack track. Pop out opens a separate video window you can drag to another display and make full screen. Bring back returns it to the workspace; closing that window also brings it back. Space controls the same project in either window. Offset sets the video start time; the monitor stays muted.</span></li>
      <li><b data-guide="guide.compose">Compose.</b> <span data-guide="guide.compose.text">Expand the composer below the timeline. Local music commands support English and Chinese; see Command Guide for supported phrases.</span></li>
      <li><b data-guide="guide.export">Save &amp; export.</b> <span data-guide="guide.export.text">Under File, Save stores your editable project. Open project returns to your saved sessions. Export WAV renders the work area as a stereo mix or one aligned WAV per track, with effects or dry.</span></li></ol>
      <p data-guide="guide.shortcuts" data-guide-arg="${Browser.isMacOS() ? '⌘+←' : 'Ctrl+Home'}">Space: Play / Pause · ${Browser.isMacOS() ? '⌘+←' : 'Ctrl+Home'}: Go to project start · Cmd/Ctrl+Z: Undo · Right-click: Context menu</p><button>Start editing</button>`
    document.body.append(help)
    help.querySelector('button')!.onclick = () => help.close()
    const importSelectedVideo = async (file: File) => {
        const options = await chooseVideoImportOptions(file)
        if (!options) {tell('Video import cancelled'); return}
        if (!service.hasProfile) await newProject()
        if (!service.hasProfile) return
        const project = service.project, importOffset = offset
        service.engine.stop()
        await importFilm(file)
        void lite?.analysis.analyze('automatic')
        if (!options.originalAudio) {tell('Reference video imported · Original audio not imported'); return}
        try {
            tell(`Importing original audio from ${file.name}…`)
            const result = await importVideoOriginalAudio(service, project, file, importOffset)
            refreshTracks()
            select.value = UUID.toString(result.track.address.uuid)
            service.timeline.range.showUnitInterval(0, Math.max(PPQN.Bar * 4, result.region.complete + PPQN.Bar))
            tell('Video imported · Original audio added on a new track')
        } catch (error) {
            console.warn('Video soundtrack import failed:', error)
            const detail = error instanceof Error ? error.message : String(error)
            tell(`Video ready · No audio track added: ${detail}. If this codec is unsupported, import its audio as WAV.`)
        }
    }
    const importVideo = () => choose('video/mp4,video/webm,video/quicktime', importSelectedVideo)
    bar.querySelector<HTMLButtonElement>('[data-action=new]')!.onclick = () => void run(() => newProject())
    bar.querySelector<HTMLButtonElement>('[data-action=audio]')!.onclick = () => pickMedia()
    bar.querySelector<HTMLButtonElement>('[data-action=video]')!.onclick = () => {if(!videoFile)importVideo();else if(videoWindow.isOpen())videoWindow.focus();else if(videoDock)scoring?.open();else if(videoPanel.hidden)floatingVideo.reveal();else videoPanel.hidden=true}
    bar.querySelector<HTMLButtonElement>('[data-action=save]')!.onclick = () => void run(saveProject)
    bar.querySelector<HTMLButtonElement>('[data-action=open]')!.onclick = () => void run(browseProjects)
    bar.querySelector<HTMLButtonElement>('[data-action=save-copy]')!.onclick = () => void run(() => saveProject(true))
    bar.querySelector<HTMLButtonElement>('[data-action=import-project]')!.onclick = importProjectFile
    bar.querySelector<HTMLButtonElement>('[data-action=export-project]')!.onclick = () => void run(exportProjectCopy)
    bar.querySelector<HTMLButtonElement>('[data-action=wav]')!.onclick = () => void run(() => service.exportMixdown())
    for (const [action, type] of [['library', PanelType.BrowserPanel], ['devices', PanelType.DevicePanel]] as const) {
        const button = bar.querySelector<HTMLButtonElement>(`[data-action=${action}]`)!
        button.onclick = () => {const panel = service.panelLayout.getByType(type); panel.toggleMinimize(); button.setAttribute('aria-expanded', String(panel.isVisible))}
    }
    bar.querySelector<HTMLButtonElement>('[data-action=help]')!.onclick = () => help.showModal()
    videoPanel.querySelector<HTMLButtonElement>('.hide-video')!.onclick = () => {videoPanel.hidden = true}
    videoPanel.querySelector<HTMLButtonElement>('.replace-video')!.onclick = importVideo
    videoPanel.querySelector<HTMLButtonElement>('.popout-video')!.onclick = openVideoWindow
    offsetInput.onchange = () => {
        offset = Number.isFinite(offsetInput.valueAsNumber) ? offsetInput.valueAsNumber : 0
        if (service.hasProfile) {
            const project = service.project, report = readPictureReport(project)
            setWorkAreaPictureEnd(project, offset + video.duration)
            const sheet=currentFilm(project)
            project.editing.modify(()=>{
                if (sheet && sheet.offset!==offset) updateFilmTrack(project,sheet.id,{offset})
                if (report && report.offset!==offset) storePictureReport(project,{...report,offset})
            },true)
        }
        scoring?.refreshVideo()
    }
    const formatTime = (time: number) => `${Math.floor(time / 60).toString().padStart(2,'0')}:${(time % 60).toFixed(3).padStart(6,'0')}`
    const videoSync = AnimationFrame.add(() => {
        const player = videoWindow.picture ?? video
        if (!service.hasProfile || !videoFile) {
            if (!player.paused) player.pause()
            return
        }
        if (player.readyState < HTMLMediaElement.HAVE_METADATA) return
        const pulse = service.engine.position.getValue(), map = service.project.tempoMap
        const position = map.ppqnToSeconds(pulse), wanted = position - offset
        const playing = service.engine.isPlaying.getValue() && wanted >= 0 && wanted < player.duration
        const frameTiming = timeSettings.display !== 'time' || service.timeline.snapping.unit.name === '1 frame'
        const tolerance = Math.max(.001, (map.ppqnToSeconds(pulse + 1) - position) / 2 + .00001)
        const target = referenceVideoSeekTime(wanted, player.duration, !playing && frameTiming ? getFrameRate(timeSettings.fps) : undefined, tolerance)
        const drift = target - player.currentTime
        if (!player.seeking && Math.abs(drift) > (playing ? .15 : .001)) player.currentTime = target
        if (playing) {
            player.playbackRate = Math.abs(drift) > .025 ? Math.max(.95, Math.min(1.05, 1 + drift * .5)) : 1
            if (player.paused && pendingPlay !== player) {
                pendingPlay = player
                player.play().catch((error: DOMException) => {
                    if (error.name !== 'AbortError') tell('Video playback failed. Press Play to try again.')
                }).finally(() => {if (pendingPlay === player) pendingPlay = undefined})
            }
        } else {
            if (!player.paused) player.pause()
            player.playbackRate = 1
        }
        const clock = formatTime(target)
        videoClock.textContent = clock
        videoPanel.dataset.driftMs = String(Math.round(drift * 1000))
        videoPanel.dataset.transportSeconds = String(position)
    })
    const trackTimer = setInterval(refreshTracks, 700)
    let mediaProject = service.hasProfile ? service.project : undefined
    bindFilms()
    const mediaProjectSubscription = service.projectProfileService.subscribe(() => {
        const next = service.hasProfile ? service.project : undefined
        if (next !== mediaProject) {
            shelfEntry = undefined; savedState = undefined; lastLocation=undefined; lastProjectFile=undefined
            mediaProject = next; offset = 0; offsetInput.value = '0'
            void setVideo()
            bindFilms()
        }
        refreshTracks(); if (!service.hasProfile) video.pause()
    })
    // Keep the same bound controls and handlers; menus only change where they appear.
    const fileMenu = createToolbarMenu('File')
    const importMenu = createToolbarMenu('Import')
    fileMenu.element.classList.add('flowtu-workspace-menu','ft-lite-file-menu')
    importMenu.element.classList.add('flowtu-workspace-menu')
    const actions = (...names: string[]) => names.map(name => bar.querySelector<HTMLElement>(`[data-action=${name}]`)!)
    fileMenu.panel.append(...actions('new', 'open', 'save', 'save-copy', 'import-project', 'export-project', 'wav'))
    fileMenu.panel.append(document.createElement('hr'), ...actions('library', 'devices'))
    const disposeSettings = installStudioSettings(fileMenu.panel)
    fileMenu.panel.append(document.createElement('hr'), ...actions('help'))
    fileMenu.panel.append(bar.querySelector<HTMLAnchorElement>('a[href="/source.html"]')!)
    const importTrack = document.createElement('label')
    importTrack.className = 'flowtu-import-track'
    importTrack.append('Audio destination', select)
    importMenu.panel.append(importTrack, ...actions('audio', 'video'))
    bar.querySelector('.flowtu-brand')!.after(fileMenu.element, importMenu.element)
    const disposeLanguage = installStudioLanguage(bar)
    ground.querySelector('.ft-transport-tools')!.append(installEditingToolbar(service, bar))
    const trigger = (action: string) => bar.querySelector<HTMLButtonElement>(`[data-action=${action}]`)!.click()
    scoring = installScoringWorkspace({
        service,
        getVideo: () => ({sourceInfo:videoSource ? videoSourceDescription(videoSource) : '', name: videoFile?.name ?? '', url: videoUrl, width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : 0, offset, ready: !!videoFile && video.readyState >= 1}),
        importVideo,
        importAudio: () => pickMedia({assetsFirst:true}),
        saveProject: () => trigger('save'),
        openVideoWindow,
        dockVideoWindow: () => videoWindow.dock(),
        isVideoWindowOpen: () => videoWindow.isOpen(),
        focusVideoWindow: () => videoWindow.focus(),
        setVideoDock: (host: HTMLElement | null, hideFloating = false) => {
            videoDock = host
            hideFloatingMonitor = hideFloating
            if (hideFloating && videoWindow.isOpen()) videoWindow.dock()
            if (!videoWindow.isOpen()) dockVideo()
            else videoPanel.hidden = true
        }
    }, bar)
    let floatingTransport: {dispose():void} | undefined
    const syncFloatingTransport = () => {
        if (videoPanel.hidden) {
            floatingTransport?.dispose()
            floatingTransport = undefined
        } else if (!floatingTransport) {
            floatingTransport = scoring!.attachTransport(document,videoPanel,() => document.fullscreenElement
                ? document.exitFullscreen() : videoPanel.requestFullscreen?.(),openVideoWindow)
        }
    }
    const floatingVisibility = new MutationObserver(syncFloatingTransport)
    floatingVisibility.observe(videoPanel,{attributes:true,attributeFilter:['hidden']})
    syncFloatingTransport()
    lite = installLiteStudio(bar,{
        openSavedProject:choice=>void run(()=>openLibraryChoice(choice)),
        setProComposerActive:on=>scoring?.setComposerActive(on),
        dropVideo:file=>void run(()=>importSelectedVideo(file)),
        fileForFilm:id=>service.hasProfile?filesOf(service.project).get(id):undefined,
        service, picture:()=>({file:videoFile, ready:!!videoFile && video.readyState>=1, offset,
            duration:Number.isFinite(video.duration) ? video.duration : 0}),
        importVideo, importClip:()=>pickMedia({quickTimeline:true,position:service.hasProfile?timelinePosition(service.project):0}),
        markCue:()=>scoring!.markCueAtPlayhead(false), exportMix:()=>trigger('wav'),
        example: async () => {
            if (!canLoadLiteDemo(service,!!videoFile)) {
                window.open('/?mode=lite&example=last-train','_blank','noopener')
                return
            }
            await run(async () => {
                await loadLiteDemo(service,()=>!!videoFile,importFilm)
                scoring?.refreshVideo(); lite?.refresh()
                void lite?.analysis.analyze('automatic')
            })
        }
    })
    const disposeSheets=installFilmSheetControls(service,ground)
    const fileRequests = service.subscribeSignal(({files, trackId, position}) => {
        if (files) void placeFiles(files, {trackId, position})
        else pickMedia({trackId},true)
    }, 'place-media')
    window.addEventListener('pagehide', () => {floatingVisibility.disconnect();floatingTransport?.dispose();disposeSheets();filmSubscription?.terminate();lite?.dispose();disposeLanguage(); disposeSettings(); fileRequests.terminate(); videoWindow.dispose(); scoring?.dispose(); mediaProjectSubscription.terminate(); videoSync.terminate(); clearInterval(trackTimer); fileMenu.dispose(); importMenu.dispose(); if (videoUrl) URL.revokeObjectURL(videoUrl)}, {once: true})
    tell('Audio engine ready')
    return {start: async () => {
        const fresh = !service.hasProfile
        if (fresh) await run(() => newProject(!startInLite,!startInLite))
        scoring?.restoreMode()
        lite?.activate(startInLite)
        if (fresh && startWithLiteDemo && canLoadLiteDemo(service,!!videoFile)) {
            await lite?.loadExample()
            if (showExampleEdit && service.hasProfile) {
                const project=service.project, cue=readScoring(project).cues[1], take=cue?.takes?.[0]
                if (cue && take) {
                    requestScoringCue(project,cue.id);focusScoringTake(project,take,{openEditor:false})
                    seekTimeline(project,Math.round(project.tempoMap.secondsToPPQN((cue.start+cue.end)/2)))
                }
            }
        }
    }}
}
