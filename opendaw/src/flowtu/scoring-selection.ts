import type {Project} from '@opendaw/studio-core'

import {clearAudioRange, getTimelineSelection} from './timeline-selection'

interface CueSelection {
    cleared?: boolean
    selected?: string
    listeners: Set<() => void>
    requests: Set<(id: string) => void>
}

// Views of the same open project share a selection, without adding undo steps.
const selections = new WeakMap<Project, CueSelection>()

function forProject(project: Project): CueSelection {
    let selection = selections.get(project)
    if (!selection) {
        selection = {listeners: new Set(), requests: new Set()}
        selections.set(project, selection)
    }
    return selection
}

export const getSelectedScoringCue = (project: Project) => selections.get(project)?.selected

export const wasScoringSelectionCleared = (project: Project) => selections.get(project)?.cleared === true

export function clearScoringSelection(project: Project) {
    const selection = forProject(project)
    project.regionSelection.deselectAll()
    clearAudioRange(project)
    selection.selected = undefined
    selection.cleared = true
    selection.listeners.forEach(notify => notify())
}

/** A new timeline selection can target the composer after the user removes the scene chip. */
export function scoringSelectionSeconds(project: Project) {
    const range = getTimelineSelection(project)
    return range && {start:project.tempoMap.ppqnToSeconds(range.start), end:project.tempoMap.ppqnToSeconds(range.end)}
}

export function setSelectedScoringCue(project: Project, id: string | undefined, reveal = false) {
    const selection = forProject(project)
    if (selection.selected === id && !reveal) return
    if (id !== undefined) selection.cleared = false
    selection.selected = id
    selection.listeners.forEach(notify => notify())
}

export function requestScoringCue(project: Project, id: string) {
    selections.get(project)?.requests.forEach(handle => handle(id))
}

export function subscribeScoringSelection(project: Project, notify: () => void) {
    const {listeners} = forProject(project)
    listeners.add(notify)
    return () => {listeners.delete(notify)}
}

export function subscribeScoringCueRequest(project: Project, handle: (id: string) => void) {
    const {requests} = forProject(project)
    requests.add(handle)
    return () => {requests.delete(handle)}
}
