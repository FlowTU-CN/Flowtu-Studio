import type {Project} from '@opendaw/studio-core'
import type {AudioTimeRange} from './audio-range'
import {retimeFilmCue} from './cue-analysis'
import {currentFilm} from './film-sheets'
import {readScoring,writeScoring} from './scoring-model'
import {getSelectedScoringCue,requestScoringCue} from './scoring-selection'
import {getExplicitTimelineSelection,setTimelineSelection} from './timeline-selection'
import {setWorkArea} from './work-area'

export type CuePreview = AudioTimeRange & {id:string}
type Hooks = {
    timeAt(x:number):number
    snap(): (seconds:number,bypass:boolean)=>number
    preview(cue?:CuePreview):void
    resetSnap():void
}

const followed = new WeakMap<Project,{id:string; bounds:AudioTimeRange}>()
const watched = new WeakSet<Project>()
function cueTicks(project:Project,cue:AudioTimeRange) {
    const start=Math.round(project.tempoMap.secondsToPPQN(cue.start))
    return {start,end:Math.max(start+1,Math.round(project.tempoMap.secondsToPPQN(cue.end)))}
}

/** Keep the transient range with an edited scene when project history replays its timing.
 * An independently chosen audio range has its own owner and takes precedence. */
function followEditedCue(project:Project,id:string,bounds:AudioTimeRange) {
    followed.set(project,{id,bounds})
    if (watched.has(project)) return
    watched.add(project)
    project.own(project.editing.subscribe(()=>{
        const link=followed.get(project)
        if (!link) return
        const selection=getExplicitTimelineSelection(project)
        if (selection?.track || selection?.start!==link.bounds.start || selection.end!==link.bounds.end || getSelectedScoringCue(project)!==link.id) {
            followed.delete(project)
            return
        }
        const cue=readScoring(project).cues.find(c=>c.id===link.id)
        if (!cue) {followed.delete(project);return}
        const bounds=cueTicks(project,cue)
        if (link.bounds.start!==bounds.start || link.bounds.end!==bounds.end) {
            link.bounds=bounds
            setTimelineSelection(project,bounds)
        }
    }))
}

/** Commit the scene and its export/loop locators as one undoable edit. */
export function applyCueTiming(project:Project, edit:CuePreview) {
    const state=readScoring(project), cue=state.cues.find(c=>c.id===edit.id)
    if (!cue) return
    const cues=state.cues.map(c=>c===cue ? retimeFilmCue(c,edit.start,edit.end) : c)
    // An old auto-end marker used to follow the next start. When a scene moves into
    // a neighbour, keep that neighbour intact so their intended overlap is preserved.
    const starts=[...new Set(cues.map(c=>c.start))].sort((a,b)=>a-b)
    const following=new Map(starts.slice(0,-1).map((start,i)=>[start,starts[i+1]]))
    for (const c of cues) {
        const next=following.get(c.start)
        if (c.autoEnd && next!==undefined && next!==c.end) c.autoEnd=false
    }
    const ticks=cueTicks(project,edit)
    project.editing.modify(()=>{
        writeScoring(project,{...state,cues})
        setWorkArea(project,ticks)
    },true)
    requestScoringCue(project,cue.id)
    setTimelineSelection(project,ticks)
    followEditedCue(project,cue.id,ticks)
}

/** Capture on the lane, so changing rows or replacing a marker cannot interrupt the gesture. */
export function bindFilmCueDrag(lane:HTMLElement,project:Project,hooks:Hooks) {
    const controller=new AbortController()
    let cancel:(()=>void)|undefined, ignoreClick=false
    const options={signal:controller.signal}
    lane.addEventListener('pointerdown',e=>{
        if(e.button!==0 || !e.isPrimary || !(e.target instanceof Element)) return
        const button=e.target.closest<HTMLButtonElement>('button[data-cue-id]')
        if (!button) return
        const scene=readScoring(project).cues.find(c=>c.id===button.dataset.cueId)
        if (!scene) return
        cancel?.()
        ignoreClick=false
        const edge=e.target.closest<HTMLElement>('[data-cue-edge]')?.dataset.cueEdge
        const id=e.pointerId, down=e.clientX
        const secondsAt=(clientX:number)=>hooks.timeAt(clientX-lane.getBoundingClientRect().left)
        const origin=secondsAt(down), span=scene.end-scene.start
        const snap=hooks.snap(), film=currentFilm(project)
        const min=film?.hasVideo ? Math.min(scene.start,Math.max(0,film.offset)) : 0
        const limit=project.tempoMap.ppqnToSeconds(0x7ffffffe)
        const max=film?.hasVideo && film.duration>0 ? Math.max(scene.end,film.offset+film.duration) : limit
        // Preserve even older scenes shorter than ten milliseconds.
        const minimum=Math.min(.01,span)
        const clamp=(value:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,value))
        const events=new AbortController(), tracking={signal:events.signal}
        let draft:CuePreview|undefined
        const finish=()=>{
            events.abort()
            cancel=undefined
            if (lane.hasPointerCapture(id)) lane.releasePointerCapture(id)
            hooks.resetSnap()
            hooks.preview()
        }
        cancel=finish
        const update=(move:PointerEvent)=>{
            if (move.pointerId!==id || (!draft && Math.abs(move.clientX-down)<3)) return
            const delta=secondsAt(move.clientX)-origin
            let start=scene.start,end=scene.end
            if (edge==='end') end=clamp(snap(end+delta,move.shiftKey),start+minimum,max)
            else if (edge==='start') start=clamp(snap(start+delta,move.shiftKey),min,end-minimum)
            else {start=clamp(snap(start+delta,move.shiftKey),min,max-span);end=start+span}
            draft={id:scene.id,start,end}
            ignoreClick=true
            hooks.preview(draft)
        }
        // Keep keyboard focus on the scene, including after it changes overlap row.
        button.focus({preventScroll:true})
        lane.setPointerCapture(id)
        lane.addEventListener('pointermove',update,tracking)
        lane.addEventListener('pointerup',up=>{
            if(up.pointerId!==id) return
            update(up)
            const result=draft
            finish()
            if(result) {
                const latest=readScoring(project).cues.find(c=>c.id===scene.id)
                if(currentFilm(project)?.id===film?.id && latest?.start===scene.start && latest.end===scene.end) applyCueTiming(project,result)
            } else {
                // The capture target is the lane, so its synthetic click won't hit the button.
                requestScoringCue(project,scene.id)
                ignoreClick=true
            }
        },tracking)
        for (const type of ['pointercancel','lostpointercapture'] as const) lane.addEventListener(type,ev=>{if(ev.pointerId===id)finish()},tracking)
        window.addEventListener('keydown',ev=>{
            if (ev.key==='Escape') {ev.preventDefault();ev.stopImmediatePropagation();ignoreClick=true;finish()}
        },{...tracking,capture:true})
        window.addEventListener('blur',finish,tracking)
        e.stopPropagation()
    },options)
    lane.addEventListener('click',e=>{
        if(e.detail && ignoreClick){e.stopImmediatePropagation();e.preventDefault();ignoreClick=false}
    },{...options,capture:true})
    return ()=>{cancel?.();controller.abort()}
}
