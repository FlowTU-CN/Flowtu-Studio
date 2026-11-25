import {MetaData, TrackType} from '@opendaw/studio-adapters'
import type {Project} from '@opendaw/studio-core'
import {isAssetLane} from './playback-lanes'
import type {AudioTimeRange} from './audio-range'

const origin = 'flowtu:export-work-area:v1'
const pictureEnds = new WeakMap<Project, number>()
const pictureChanges = new WeakMap<Project, Set<() => void>>()

export function setWorkAreaPictureEnd(project: Project, seconds: number) {
    pictureEnds.set(project, Number.isFinite(seconds) ? Math.max(0, seconds) : 0)
    pictureChanges.get(project)?.forEach(notify => notify())
}

export function subscribeWorkAreaPicture(project: Project, notify: () => void) {
    const listeners = pictureChanges.get(project) ?? new Set<() => void>()
    pictureChanges.set(project, listeners)
    listeners.add(notify)
    return {terminate: () => {listeners.delete(notify)}}
}

function valid(area: AudioTimeRange) {
    return Number.isSafeInteger(area.start) && Number.isSafeInteger(area.end) &&
        area.start >= 0 && area.end > area.start && area.end <= 0x7fffffff
}

function locators(project: Project) {
    const loop = project.timelineBox.loopArea
    return {start: loop.from.getValue(), end: loop.to.getValue()}
}

export function manualWorkArea(project: Project): AudioTimeRange | undefined {
    const data = MetaData.read(project.rootBox, origin)
    const native = locators(project)
    const loop = project.timelineBox.loopArea
    const legacyLoop = data === null && (loop.enabled.getValue() || native.start !== loop.from.initValue || native.end !== loop.to.initValue)
    if (data === 'manual' || legacyLoop) {
        return valid(native) ? native : undefined
    }
    // Before the shared locator lane, saved work areas had a separate pair of coordinates.
    if (!data || typeof data !== 'object' || Array.isArray(data)) return
    if (typeof data.start !== 'number' || typeof data.end !== 'number') return
    const area = {start: data.start, end: data.end}
    return valid(area) ? area : undefined
}

export function projectExtent(project: Project): AudioTimeRange {
    let end = Math.ceil(project.tempoMap.secondsToPPQN(pictureEnds.get(project) ?? 0))
    for (const unit of project.rootBoxAdapter.audioUnits.adapters()) {
        for (const track of unit.tracks.values()) {
            if ((track.type !== TrackType.Audio && track.type !== TrackType.Notes) || isAssetLane(track)) continue
            for (const region of track.regions.collection.asArray()) end = Math.max(end, Math.round(region.complete))
        }
    }
    return {start: 0, end}
}

export const getWorkArea = (project: Project): AudioTimeRange => manualWorkArea(project) ?? projectExtent(project)

function writeLocators(project: Project, area: AudioTimeRange) {
    const loop = project.timelineBox.loopArea
    loop.from.setValue(area.start)
    loop.to.setValue(area.end)
    if (area.end === area.start) loop.enabled.setValue(false)
}

export function setWorkArea(project: Project, area?: AudioTimeRange, enableLoop = false) {
    if (area && !valid(area)) throw new Error('Set Out after In, within the timeline.')
    const mode = area ? 'manual' : 'auto'
    const next = area ?? projectExtent(project), current = locators(project)
    const loop = project.timelineBox.loopArea
    const previousMode = MetaData.read(project.rootBox, origin)
    if (previousMode === mode && current.start === next.start && current.end === next.end &&
        (!enableLoop || loop.enabled.getValue())) return
    project.editing.modify(() => {
        if (previousMode !== mode) MetaData.store(project.rootBox, mode, origin)
        writeLocators(project, next)
        if (enableLoop && valid(next)) loop.enabled.setValue(true)
    }, true)
}

// Materialize derived auto bounds for the audio engine without making every clip edit
// produce a second undo step. Manual coordinates live exclusively on the native loop.
export function installSharedLocators(project: Project) {
    let alive = true, pending = false
    const sync = () => {
        if (!alive) return
        const previousMode = MetaData.read(project.rootBox, origin)
        const manual = manualWorkArea(project)
        const mode = manual ? 'manual' : 'auto'
        const next = manual ?? projectExtent(project), current = locators(project)
        if (previousMode === mode && current.start === next.start && current.end === next.end &&
            (valid(next) || !project.timelineBox.loopArea.enabled.getValue())) return
        project.boxGraph.beginTransaction()
        try {
            if (previousMode !== mode) MetaData.store(project.rootBox, mode, origin)
            writeLocators(project, next)
            project.boxGraph.endTransaction()
        } catch (error) {
            if (project.boxGraph.inTransaction()) project.boxGraph.abortTransaction()
            throw error
        }
    }
    const request = () => {
        if (pending || !alive) return
        pending = true
        queueMicrotask(() => {pending = false; sync()})
    }
    sync()
    const listeners = [project.editing.subscribe(request), project.tempoMap.subscribe(request), subscribeWorkAreaPicture(project, request)]
    return {terminate() {alive = false; listeners.forEach(item => item.terminate())}}
}
