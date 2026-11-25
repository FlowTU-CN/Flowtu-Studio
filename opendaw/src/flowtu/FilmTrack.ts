import {deferNextFrame,Html} from '@opendaw/lib-dom'
import type {Lifecycle} from '@opendaw/lib-std'
import type {StudioService} from '../service/StudioService'
import {currentFilm,selectFilmSheet,updateFilmTrack,watchFilmBook} from './film-sheets'
import {watchPictureReport,type PictureReport} from './lite-model'
import {seekTimeline} from './timeline-seek'
import {tr,watchStudioLanguage} from './studio-language'
import './film-sheet.css'

export function createFilmTrack(service:StudioService,lifecycle:Lifecycle) {
    const project=service.project, range=service.timeline.range
    const row=document.createElement('section')
    row.className='ft-film-track'; row.hidden=true
    row.innerHTML='<header><button type="button" data-fold></button><button type="button" data-sheet></button><button type="button" data-remove>×</button></header><div class="ft-film-strip"><div class="ft-film-frames"></div><i></i></div><div role="separator" tabindex="0" aria-orientation="horizontal"></div>'
    const title=row.querySelector<HTMLButtonElement>('[data-sheet]')!, fold=row.querySelector<HTMLButtonElement>('[data-fold]')!
    const remove=row.querySelector<HTMLButtonElement>('[data-remove]')!, grip=row.querySelector<HTMLElement>('[role=separator]')!
    const strip=row.querySelector<HTMLElement>('.ft-film-strip')!, frames=strip.querySelector<HTMLElement>('div')!, cursor=strip.querySelector('i')!
    let film=currentFilm(project), report:PictureReport|undefined, dragging:number|undefined
    const x=(seconds:number)=>range.unitToX(project.tempoMap.secondsToPPQN(seconds))
    function renderCursor() {cursor.style.left=range.unitToX(project.engine.position.getValue())+'px'}
    function render() {
        row.hidden=!film?.hasVideo
        if (!film || !film.hasVideo) return
        const {duration,offset,folded,height,name}=film
        row.classList.toggle('folded',folded)
        if (dragging===undefined) row.style.height=(folded ? 27 : height)+'px'
        fold.textContent=folded?'▸':'▾';fold.ariaExpanded=String(!folded)
        fold.title=fold.ariaLabel=tr('Fold video track')
        title.textContent=name;title.title=tr('Cue sheets')
        remove.title=remove.ariaLabel=tr('Remove video track')
        grip.ariaLabel=tr('Resize video track');grip.ariaValueNow=String(height)
        const left=x(offset), right=x(offset+duration)
        frames.style.left=Math.max(0,left)+'px'
        frames.style.width=Math.max(0,Math.min(range.width,right)-Math.max(0,left))+'px'
        frames.replaceChildren()
        if (!folded && report) {
            for (const scene of report.scenes) {
                const start=Math.max(0,left,x(offset+scene.start)), end=Math.min(range.width,right,x(offset+scene.end))
                if (end<=start) continue
                const frame=document.createElement('div')
                frame.style.left=(start-Math.max(0,left))+'px';frame.style.width=(end-start)+'px'
                // Each visible section tiles its actual analyzed frame as the timeline zooms.
                frame.style.backgroundImage='url("'+scene.thumbnail+'")'
                frame.title=scene.title
                frames.append(frame)
            }
        }
        renderCursor()
    }
    const {request}=lifecycle.own(deferNextFrame(render))
    title.onclick=()=>document.dispatchEvent(new CustomEvent('ft-open-film-sheets',{detail:project}))
    fold.onclick=()=>{if(film) updateFilmTrack(project,film.id,{folded:!film.folded})}
    remove.onclick=()=>selectFilmSheet(project,null)
    strip.onpointerdown=e=>{
        if(e.button!==0) return
        seekTimeline(project,Math.max(0,Math.round(range.xToUnit(e.clientX-strip.getBoundingClientRect().left))))
    }
    const clamp=(h:number)=>Math.max(32,Math.min(180,Math.round(h)))
    let startY=0,startHeight=0
    grip.onpointerdown=e=>{
        if (!film || e.button!==0) return
        e.preventDefault();grip.setPointerCapture(e.pointerId);dragging=e.pointerId
        startY=e.clientY;startHeight=row.clientHeight
    }
    grip.onpointermove=e=>{if (dragging===e.pointerId) row.style.height=clamp(startHeight+e.clientY-startY)+'px'}
    grip.onpointerup=e=>{
        if (!film || dragging!==e.pointerId) return
        dragging=undefined
        updateFilmTrack(project,film.id,{height:clamp(startHeight+e.clientY-startY),folded:false})
        request()
    }
    grip.onlostpointercapture=()=>{dragging=undefined;request()}
    grip.onkeydown=e=>{
        if (!film || !['ArrowUp','ArrowDown'].includes(e.key)) return
        e.preventDefault()
        updateFilmTrack(project,film.id,{height:clamp(film.height+(e.key==='ArrowDown' ? 8 : -8)),folded:false})
    }
    lifecycle.ownAll(watchFilmBook(project,()=>{film=currentFilm(project);request()}),
        watchPictureReport(project,data=>{report=data;request()}),range.subscribe(request),Html.watchResize(strip,request),
        project.tempoMap.subscribe(request),project.engine.position.subscribe(renderCursor),{terminate:watchStudioLanguage(request)})
    request()
    return row
}
