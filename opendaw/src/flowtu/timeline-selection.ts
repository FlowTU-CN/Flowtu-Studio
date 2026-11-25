import {setWorkArea} from './work-area'
import {seekTimeline} from './timeline-seek'
import {UUID} from '@opendaw/lib-std'
import {type TrackBoxAdapter, TrackType} from '@opendaw/studio-adapters'
import type {Project} from '@opendaw/studio-core'
import {endTick, type AudioTimeRange} from './audio-range'

export type AudioRangeSelection = AudioTimeRange & {track: TrackBoxAdapter; tracks: readonly TrackBoxAdapter[]; signatures: readonly string[]}
type ExplicitRange = (AudioTimeRange & {track?: undefined; tracks?: undefined}) | AudioRangeSelection
// undefined follows the native clip selection, null represents a cleared time selection.
type Source = ExplicitRange | null | undefined
interface State {source: Source; listeners: Set<() => void>; gestureListeners: Set<(range: AudioTimeRange) => void>}
const states = new WeakMap<Project, State>()
// Timeline display order includes the underlying lanes used by the native region clipboard.
const trackOrders = new WeakMap<Project, () => readonly TrackBoxAdapter[]>()
export function bindTimelineTrackOrder(project:Project, order:() => readonly TrackBoxAdapter[]) {
    trackOrders.set(project,order)
    return {terminate() {if (trackOrders.get(project) === order) trackOrders.delete(project)}}
}
export function timelineTrackOrder(project:Project) {return trackOrders.get(project)?.() ?? []}
export function checkRangeTracks(project:Project, tracks:readonly TrackBoxAdapter[]) {
    if (tracks.length<=1) return
    const visible=timelineTrackOrder(project)
    if (tracks.some(track=>!visible.includes(track))) throw new Error('The track order changed. Select the range again.')
}
const notify = (state: State) => state.listeners.forEach(listener => listener())
const signature = (track: TrackBoxAdapter) => track.regions.collection.asArray()
    .map(r => `${UUID.toString(r.uuid)}:${r.position}:${r.duration}:${r.loopOffset}`).join('|')

function forProject(project: Project): State {
    const existing = states.get(project)
    if (existing) return existing
    const state: State = {source: undefined, listeners: new Set(), gestureListeners: new Set()}
    states.set(project, state)
    const followClips = () => {state.source = undefined; notify(state)}
    project.own(project.regionSelection.subscribe({onSelected: followClips, onDeselected: followClips}))
    project.own(project.timelineFocus.track.subscribe(() => {
        const range = state.source
        if (range?.track && (range.track.type === TrackType.Value || range.tracks.length > 1) && !project.timelineFocus.track.contains(range.track)) {
            change(project, {start:range.start, end:range.end})
        }
    }))
    project.own(project.editing.subscribe(() => {
        const range = state.source
        if (range?.track && range.tracks.some((track,i) => !track.box.isAttached() || signature(track) !== range.signatures[i])) {
            state.source = {start: range.start, end: range.end}
        }
        notify(state)
    }))
    return state
}

function change(project: Project, source: Source) {
    const state = forProject(project)
    if (state.source === source) return
    state.source = source
    notify(state)
}

export function subscribeTimelineSelection(project: Project, listener: () => void) {
    const {listeners} = forProject(project)
    listeners.add(listener)
    return {terminate: () => {listeners.delete(listener)}}
}

/** Notify on a finished user range gesture, never for previews, undo or programmatic selection. */
export function finishTimelineRangeGesture(project: Project) {
    const range = getExplicitTimelineSelection(project)
    if (range && range.end > range.start) forProject(project).gestureListeners.forEach(listener => listener(range))
}

export function subscribeTimelineRangeGesture(project: Project, listener: (range: AudioTimeRange) => void) {
    const {gestureListeners} = forProject(project)
    gestureListeners.add(listener)
    return {terminate: () => {gestureListeners.delete(listener)}}
}

export function getTimelineSelection(project: Project): AudioTimeRange | undefined {
    const {source} = forProject(project)
    if (source !== undefined) return source && source.end > source.start ? source : undefined
    let start = Infinity, end = 0
    for (const region of project.regionSelection.selected()) {
        start = Math.min(start, region.position)
        end = Math.max(end, endTick(region.position,region.complete))
    }
    return end > start ? {start, end} : undefined
}

export function getExplicitTimelineSelection(project: Project): ExplicitRange | undefined {
    return forProject(project).source ?? undefined
}

export function getAudioRange(project: Project): AudioRangeSelection | undefined {
    const range = getExplicitTimelineSelection(project)
    return range?.track && range.track.type !== TrackType.Value && range.end > range.start ? range : undefined
}

export function getEnvelopeRange(project: Project): AudioRangeSelection | undefined {
    const range = getExplicitTimelineSelection(project)
    return range?.track && range.track.type === TrackType.Value && range.end > range.start ? range : undefined
}

export function setTimelineSelection(project: Project, range: AudioTimeRange, track?: TrackBoxAdapter, tracks: readonly TrackBoxAdapter[] = track ? [track] : []) {
    const start = Math.max(0, Math.round(range.start)), end = Math.max(0, Math.round(range.end))
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || (track && (!tracks.includes(track) || tracks.some(row=>!row.box.isAttached() || row.type!==track.type)))) {
        throw new Error('Choose a valid timeline range.')
    }
    const previous = getExplicitTimelineSelection(project)
    const sameRows = !track || previous?.track === track && previous.tracks.length === tracks.length && tracks.every((row,i)=>row===previous.tracks[i])
    if (previous?.start === start && previous.end === end && previous.track === track && sameRows) return
    change(project, track ? {start, end, track, tracks, signatures:sameRows && previous?.track ? previous.signatures : tracks.map(signature)} : {start, end})
}

export function rememberTimelineSelection(project: Project) {
    const {source} = forProject(project)
    return () => change(project, source)
}

export const clearAudioRange = (project: Project) => change(project, null)
export const followSelectedClips = (project: Project) => change(project, undefined)

/** Apply an edit range to the engine's existing loop locators in one undo step. */
export function loopTimelineSelection(project: Project) {
    const range = getTimelineSelection(project)
    if (!range) return false
    setWorkArea(project, range, true)
    seekTimeline(project, range.start)
    return true
}
