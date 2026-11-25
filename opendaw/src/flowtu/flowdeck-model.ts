import {AudioRegionBoxAdapter, MetaData, NoteRegionBoxAdapter} from '@opendaw/studio-adapters'
import type {Project} from '@opendaw/studio-core'
import {UUID} from '@opendaw/lib-std'
import {readScoring, takeRegion, writeScoring} from './scoring-model'
import {copyAssetTo, reserveAssetLane} from './scoring-assets'

const childrenKey = 'flowtu:deck:versions:v1'
export type DeckEdit = {kind: 'midi'; transpose: number; velocity: number} | {kind: 'audio'; gain: number; fadeIn?: number; fadeOut?: number}
function childIds(source: NoteRegionBoxAdapter | AudioRegionBoxAdapter) {
    const ids = MetaData.read(source.box, childrenKey)
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && UUID.validateString(id)) : []
}
export function deckVersions(project: Project, sourceId: string) {
    const source = takeRegion(project, sourceId)
    return source ? childIds(source).flatMap((id, i) => {
        const region = takeRegion(project, id)
        return region ? [{id, number: i + 1, name: region.label}] : []
    }) : []
}

function bounded(value: number, min: number, max: number) {
    return Number.isFinite(value) && value >= min && value <= max
}
/** The version owns its own events; its disabled asset lane keeps the arrangement and mix intact. */
export function saveDeckVersion(project: Project, sourceId: string, edit: DeckEdit) {
    const source = takeRegion(project, sourceId), track = source?.trackBoxAdapter.unwrapOrNull()
    if (!source || !track) throw new Error('Choose an asset that is still in this project.')
    if (edit.kind === 'midi') {
        if (!(source instanceof NoteRegionBoxAdapter) || !Number.isInteger(edit.transpose) || !bounded(edit.transpose,-48,48)
            || !bounded(edit.velocity,1,200)) throw new Error('Use −48 to +48 semitones and 1–200% velocity.')
        if (source.optCollection.unwrap().events.asArray().some(e => !bounded(e.box.pitch.getValue() + edit.transpose,0,127)))
            throw new Error('That transposition exceeds the MIDI note range.')
    } else if (!(source instanceof AudioRegionBoxAdapter) || !bounded(edit.gain,-60,12) ||
        [edit.fadeIn, edit.fadeOut].some(ms => ms !== undefined && !bounded(ms,0,Number.MAX_SAFE_INTEGER))) {
        throw new Error('Use −60 to +12 dB and positive fade lengths.')
    }
    const versions = childIds(source)
    const state = readScoring(project), cue = state.cues.find(c => c.takes?.includes(sourceId))
    const map = project.tempoMap, start = map.ppqnToSeconds(source.position), end = map.ppqnToSeconds(source.complete)
    let fadeIn = 0, fadeOut = 0
    if (source instanceof AudioRegionBoxAdapter && edit.kind === 'audio') {
        if ((edit.fadeIn ?? 0) + (edit.fadeOut ?? 0) > (end - start) * 1000 + 1e-5)
            throw new Error('The two fades must fit within the clip.')
        fadeIn = edit.fadeIn === undefined ? source.fading.in : map.secondsToPPQN(start + edit.fadeIn / 1000) - source.position
        fadeOut = edit.fadeOut === undefined ? source.fading.out : source.complete - map.secondsToPPQN(end - edit.fadeOut / 1000)
        if ((edit.fadeIn !== undefined || edit.fadeOut !== undefined) && fadeIn + fadeOut > source.duration + 1e-5)
            throw new Error('The two fades must fit within the clip.')
    }
    return project.editing.modify(() => {
        const lane = reserveAssetLane(project, track, source.position, source.complete)
        const version = copyAssetTo(source, lane, source.position)
        version.box.label.setValue((source.label || 'Asset') + ' · v' + (versions.length + 1))
        if (version instanceof NoteRegionBoxAdapter && edit.kind === 'midi') {
            for (const note of version.optCollection.unwrap().events.asArray()) {
                note.box.pitch.setValue(note.box.pitch.getValue() + edit.transpose)
                note.box.velocity.setValue(Math.min(1, note.box.velocity.getValue() * edit.velocity / 100))
            }
        } else if (version instanceof AudioRegionBoxAdapter && edit.kind === 'audio') {
            version.gain.setValue(Math.round(edit.gain * 10) / 10)
            if (edit.fadeIn !== undefined) version.fading.inField.setValue(fadeIn)
            if (edit.fadeOut !== undefined) version.fading.outField.setValue(fadeOut)
        }
        const id = UUID.toString(version.uuid)
        MetaData.store(source.box, [...versions, id], childrenKey)
        if (cue) {
            cue.takes = [...(cue.takes ?? []), id]
            writeScoring(project, state)
        }
        return id
    }, true).unwrap()
}
