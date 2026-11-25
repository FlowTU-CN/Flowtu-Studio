import {Terminator} from '@opendaw/lib-std'
import type {StudioService} from '../service/StudioService'
import type {createTakeAudition} from './take-audition'
import {installAssetDrag} from './asset-drag'
import {bounceAsset, projectAssets, renameAsset, type ProjectAsset} from './scoring-assets'
import {takeRegion} from './scoring-model'
import {drawMediaThumbnail} from './media-thumbnail'
import {MetaData} from '@opendaw/studio-adapters'
import {readFilmBook,selectFilmSheet} from './film-sheets'
import {pictureReportOrigin} from './lite-model'
import {mediaRemoveButton} from './media-removal'
import {watchStudioLanguage} from './studio-language'
import {videoSourceDescription} from './video-source'
import './asset-library.css'

type LibraryOptions = {
    audition: ReturnType<typeof createTakeAudition>
    openDeck: (id: string) => void
    edit: (id: string) => void
    useForGeneration: (id: string) => void
    showVideo: () => void
    importAudio: () => void
    tell: (message: string, error?: boolean) => void
}

export function createAssetLibrary(service: StudioService, options: LibraryOptions) {
    const element = document.createElement('section')
    element.className = 'ft-asset-library'
    element.setAttribute('aria-label','Project assets')
    element.innerHTML = `<div class="ft-asset-filters"><input type="search" aria-label="Search media" placeholder="Search media"><select aria-label="Asset type"><option>All</option><option>Video</option><option>Audio</option><option>MIDI</option></select><button type="button" title="Import audio or MIDI" aria-label="Import audio or MIDI">＋</button></div><div class="ft-asset-list"></div>`
    const search = element.querySelector('input')!, filter = element.querySelector('select')!, list = element.querySelector<HTMLElement>('.ft-asset-list')!
    const drags = new Terminator()
    let project: StudioService['project'] | undefined, assets: ProjectAsset[] = [], signature = ''
    type VideoInfo = {sourceInfo?:string; url: string; name: string; duration: number; ready: boolean}
    let video: VideoInfo | undefined, cancelPoster: (() => void) | undefined
    const poster = document.createElement('canvas')
    poster.className = 'ft-asset-thumb ft-film-thumb'
    function setVideo(info: VideoInfo) {
        if (video?.url === info.url && video.ready === info.ready && video.sourceInfo === info.sourceInfo) return
        cancelPoster?.()
        poster.width = 256; poster.height = 100
        video = info
        if (info.url && info.ready) {
            const decoder = document.createElement('video')
            decoder.preload = 'auto'; decoder.muted = true; decoder.playsInline = true
            const release = () => {
                decoder.onloadedmetadata = decoder.onloadeddata = decoder.onseeked = decoder.onerror = null
                decoder.removeAttribute('src'); decoder.load()
                cancelPoster = undefined
            }
            const capture = () => {
                if (decoder.readyState < 2) return
                const scale = Math.min(poster.width / decoder.videoWidth, poster.height / decoder.videoHeight)
                const w = decoder.videoWidth * scale, h = decoder.videoHeight * scale
                poster.getContext('2d')?.drawImage(decoder, (poster.width - w) / 2, (poster.height - h) / 2, w, h)
                release()
            }
            decoder.onloadedmetadata = () => {
                decoder.currentTime = Math.min(.5, info.duration / 2)
            }
            decoder.onloadeddata = () => {if (!decoder.seeking) capture()}
            decoder.onseeked = capture; decoder.onerror = release
            cancelPoster = release; decoder.src = info.url
        }
        draw()
    }
    let rendering: AbortController | undefined
    element.querySelector('button')!.onclick = options.importAudio
    const report = (error: unknown) => options.tell(error instanceof Error ? error.message : String(error),true)
    const thumbnails = new Terminator()
    function draw() {
        thumbnails.terminate()
        drags.terminate()
        list.replaceChildren()
        const rows = assets.filter(a => (filter.value === 'All' || filter.value === a.kind) && a.name.toLowerCase().includes(search.value.trim().toLowerCase()))
        const book=project ? readFilmBook(project) : {active:null,sheets:[]}
        const films=book.sheets.filter(item=>item.hasVideo)
        const visibleFilms=films.filter(item=>['All','Video'].includes(filter.value) && item.name.toLowerCase().includes(search.value.trim().toLowerCase()))
        for (const movie of visibleFilms) {
            const entry=document.createElement('div'),card=document.createElement('button'),title=document.createElement('strong'),type=document.createElement('small')
            entry.className='ft-film-entry';entry.dataset.id=movie.id
            card.className='ft-film-card';card.type='button'
            card.onclick=()=>{
                if (!project || !service.hasProfile || service.project!==project) return
                selectFilmSheet(project,movie.id)
                options.showVideo()
            }
            const active=movie.id===book.active
            card.setAttribute('aria-pressed',String(active))
            title.textContent=movie.name
            type.textContent=movie.source ? videoSourceDescription(movie.source) : 'Reference video'
            card.title=movie.name+' · '+type.textContent
            if (active && video?.ready && video.name===movie.name) card.append(poster)
            else if (project) {
                const key=active ? pictureReportOrigin : pictureReportOrigin+'/'+movie.id
                const report=MetaData.read(project.rootBox,key) as {scenes?:{thumbnail?:string}[]}|null
                const thumbnail=report?.scenes?.[0]?.thumbnail
                if (thumbnail?.startsWith('data:image/jpeg;base64,')) {
                    const img=document.createElement('img');img.className='ft-asset-thumb ft-film-thumb';img.src=thumbnail;img.alt='';card.append(img)
                }
            }
            card.append(title,type)
            entry.append(card,mediaRemoveButton(service,{...movie,kind:'Video'},refresh,report,true))
            list.append(entry)
        }
        if (!rows.length && !visibleFilms.length) {
            const empty = document.createElement('p')
            empty.textContent = assets.length || films.length ? 'No matching media.' : 'Import video, audio or MIDI to see it here.'
            list.append(empty)
        }
        for (const asset of rows) {
            const row = document.createElement('article')
            row.className = 'ft-asset-row'
            row.dataset.id = asset.id
            row.dataset.kind = asset.kind
            row.innerHTML = `<div class="ft-asset-line"><button class="ft-asset-play" type="button">▶</button><button class="ft-asset-name" type="button"><strong></strong><small></small></button><button class="ft-asset-deck" type="button" title="FlowDeck" aria-label="FlowDeck"><span>FlowDeck</span></button><button class="ft-asset-more" type="button" aria-expanded="false">⋯</button></div><div class="ft-asset-actions" hidden><button type="button" data-reference>Use for generation</button><button type="button" data-edit>Edit</button><button type="button" data-rename>Rename</button></div>`
            const play = row.querySelector<HTMLButtonElement>('.ft-asset-play')!, title = row.querySelector<HTMLButtonElement>('.ft-asset-name')!
            const extra = row.querySelector<HTMLElement>('.ft-asset-actions')!, more = row.querySelector<HTMLButtonElement>('.ft-asset-more')!
            title.querySelector('strong')!.textContent = asset.name
            title.querySelector('small')!.textContent = [asset.kind, Math.floor(asset.seconds/60) + ':' + String(Math.floor(asset.seconds % 60)).padStart(2,'0'), asset.cue && 'Cue ' + asset.cue, asset.sourceName && 'From ' + asset.sourceName].filter(Boolean).join(' · ')
            title.title = 'Edit ' + asset.name + ' · Drag onto a matching track'
            title.onclick = () => options.edit(asset.id)
            play.title = play.ariaLabel = 'Preview ' + asset.name
            play.onclick = () => {void options.audition.play(asset.id).catch(report)}
            row.querySelector<HTMLButtonElement>('.ft-asset-deck')!.onclick = () => options.openDeck(asset.id)
            more.title = more.ariaLabel = 'Options for ' + asset.name
            more.onclick = () => {extra.hidden = !extra.hidden; more.setAttribute('aria-expanded',String(!extra.hidden))}
            extra.querySelector<HTMLButtonElement>('[data-edit]')!.onclick = () => options.edit(asset.id)
            extra.querySelector<HTMLButtonElement>('[data-reference]')!.onclick = () => options.useForGeneration(asset.id)
            extra.querySelector<HTMLButtonElement>('[data-rename]')!.onclick = () => {
                const field = document.createElement('input')
                field.ariaLabel = 'Asset name'; field.value = asset.name; field.maxLength = 128
                extra.replaceChildren(field); field.focus(); field.select()
                field.onkeydown = event => {
                    event.stopPropagation()
                    if (event.key === 'Escape') {event.preventDefault(); draw()}
                    if (event.key === 'Enter') {
                        event.preventDefault()
                        try {if (project) renameAsset(project,asset.id,field.value); refresh(); if (field.isConnected) draw()}
                        catch (error) {report(error)}
                    }
                }
                field.onblur = () => {if (field.isConnected) draw()}
            }
            extra.append(mediaRemoveButton(service,asset,()=>{
                if (options.audition.current()===asset.id) options.audition.stop()
                refresh()
            },report))
            if (asset.kind === 'MIDI') {
                const render = document.createElement('button')
                render.type = 'button'; render.textContent = 'Render audio'
                render.onclick = async () => {
                    if (rendering) return options.tell('An audio render is in progress.')
                    rendering = new AbortController()
                    const job = rendering
                    try {
                        options.tell('Rendering ' + asset.name + '…')
                        await bounceAsset(service,asset.id,job.signal)
                        refresh(); options.tell('Audio added to Assets.')
                    } catch (error) {if (!job.signal.aborted) report(error)}
                    finally {if (job === rendering) rendering = undefined}
                }
                extra.append(render)
            }
            const thumbnail = document.createElement('canvas')
            thumbnail.className = 'ft-asset-thumb'
            thumbnail.setAttribute('aria-hidden','true')
            row.prepend(thumbnail)
            thumbnail.ondblclick = () => options.edit(asset.id)
            if (project) {
                const region = takeRegion(project, asset.id)
                if (region) drawMediaThumbnail(thumbnail, region, thumbnails)
            }
            if (project) drags.own(installAssetDrag(row,project,asset.id))
            list.append(row)
        }
    }
    function refresh(_cueId?: string) {
        const p = service.hasProfile ? service.project : undefined
        const changed = p !== project
        if (changed) {rendering?.abort(); rendering = undefined}
        project = p
        assets = project ? projectAssets(project) : []
        const next = JSON.stringify([assets,project ? readFilmBook(project) : null])
        if (changed || next !== signature) {signature = next; draw()}
        else if (project) {
            thumbnails.terminate()
            for (const row of list.querySelectorAll<HTMLElement>('.ft-asset-row')) {
                const region = takeRegion(project, row.dataset.id!)
                if (region) drawMediaThumbnail(row.querySelector('canvas')!, region, thumbnails)
            }
        }
    }
    const refreshPreview = () => {
        const id = options.audition.current()
        for (const row of list.querySelectorAll<HTMLElement>('.ft-asset-row')) {
            const button = row.querySelector<HTMLButtonElement>('.ft-asset-play')!, current = row.dataset.id === id
            button.setAttribute('aria-pressed',String(current))
            const icon = current ? (options.audition.loading() ? '…' : '■') : '▶'
            if (icon !== button.textContent) button.textContent = icon
        }
    }
    search.oninput = filter.onchange = draw
    const stopWatchingLanguage=watchStudioLanguage(draw)
    return {element, refresh, refreshPreview, setVideo, dispose() {stopWatchingLanguage(); cancelPoster?.(); rendering?.abort(); thumbnails.terminate(); drags.terminate()}}
}
