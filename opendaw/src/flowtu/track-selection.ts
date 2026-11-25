import type {Project} from '@opendaw/studio-core'
import type {TrackBoxAdapter} from '@opendaw/studio-adapters'
import {deleteTracksWithMedia} from './track-delete'
import {displayTrack} from './playback-lanes'

type Modifiers = {shiftKey:boolean;metaKey:boolean;ctrlKey:boolean}
type HeaderSelection = {
    tracks: Set<TrackBoxAdapter>
    anchor?: TrackBoxAdapter
    updating: boolean
    listeners: Set<()=>void>
}

const selectionByProject=new WeakMap<Project,HeaderSelection>()

function stateFor(project:Project): HeaderSelection {
    const known=selectionByProject.get(project)
    if (known) return known
    const state:HeaderSelection={tracks:new Set(),updating:false,listeners:new Set()}
    selectionByProject.set(project,state)
    project.own(project.timelineFocus.track.catchupAndSubscribe(focus=>{
        if (state.updating) return
        const current=focus.mapOr(displayTrack,undefined)
        state.tracks.clear()
        state.anchor=current
        if (current) state.tracks.add(current)
        state.listeners.forEach(notify=>notify())
    }))
    return state
}

export function isHeaderSelected(project:Project,track:TrackBoxAdapter) {
    return stateFor(project).tracks.has(track)
}

export function headerTargets(project:Project,track:TrackBoxAdapter): TrackBoxAdapter[] {
    const state=stateFor(project)
    return (state.tracks.has(track) ? [...state.tracks] : [track]).filter(t=>t.box.isAttached())
}

export function watchHeaderSelection(project:Project,notify:()=>void) {
    const {listeners}=stateFor(project)
    listeners.add(notify);notify()
    return {terminate:()=>{listeners.delete(notify)}}
}

export function selectHeader(project:Project,track:TrackBoxAdapter,visible:ReadonlyArray<TrackBoxAdapter>,keys:Modifiers) {
    const state=stateFor(project), toggle=keys.metaKey||keys.ctrlKey
    let focus:TrackBoxAdapter|undefined=track
    const anchor=state.anchor && visible.includes(state.anchor) ? state.anchor : track
    if(keys.shiftKey) {
        const a=visible.indexOf(anchor), b=visible.indexOf(track)
        if(!toggle)state.tracks.clear()
        for(const item of visible.slice(Math.min(a,b),Math.max(a,b)+1))state.tracks.add(item)
    } else {
        state.anchor=track
        if(!toggle)state.tracks.clear()
        if(toggle && state.tracks.delete(track)) focus=[...state.tracks].filter(t=>t.box.isAttached()).at(-1)
        else state.tracks.add(track)
    }
    state.updating=true
    try {
        if(focus) project.timelineFocus.focusTrack(focus)
        else project.timelineFocus.clear()
    } finally {state.updating=false}
    state.listeners.forEach(notify=>notify())
}

export function deleteHeaderSelection(project:Project,track:TrackBoxAdapter) {
    deleteTracksWithMedia(project,headerTargets(project,track))
}
