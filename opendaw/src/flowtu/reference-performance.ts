import {LoopableRegion, PPQN} from '@opendaw/lib-dsp'
import {AudioRegionBoxAdapter, NoteRegionBoxAdapter} from '@opendaw/studio-adapters'
import {generateNotes, type Command, type Note} from './commands'

const maxReferenceEvents = 65536
function midiPhrase(region: NoteRegionBoxAdapter, duration: number, command: Command, variation: number): Note[] {
    const notes = region.optCollection.unwrapOrNull()?.events.asArray().filter(note => note.position < region.loopDuration && note.complete > 0 && note.velocity > 0) ?? []
    if (!notes.length) throw new Error('The MIDI reference has no notes in this range.')
    if (notes.length * Math.ceil(duration / region.loopDuration) > maxReferenceEvents)
        throw new Error('Shorten the cue or use a less dense reference.')
    const onsets = new Map<number, Note[]>()
    for (const pass of LoopableRegion.locateLoops(region, region.position, region.position + duration)) {
        for (const event of notes) {
            const start = Math.max(pass.resultStart, pass.rawStart + event.position)
            const end = Math.min(pass.resultEnd, pass.rawStart + event.complete)
            if (start >= end) continue
            const beat = (start - region.position) / PPQN.Quarter
            const note = {beat, length: (end - start) / PPQN.Quarter, pitch: event.pitch, velocity: event.velocity}
            const group = onsets.get(beat)
            if (group) group.push(note)
            else onsets.set(beat, [note])
        }
    }
    if (!onsets.size) throw new Error('The MIDI reference has no notes in this range.')
    return [...onsets].sort(([a], [b]) => a - b).flatMap(([, group], index) => {
        if (command.sparse && index % 2) return []
        group.sort((a, b) => a.pitch - b.pitch)
        if (command.pattern === 'bass') return [{...group[0], pitch: 36 + group[0].pitch % 12}]
        if (command.pattern === 'melody') return [group[group.length - 1]]
        if (command.pattern === 'arpeggio') return [group[(index + variation) % group.length]]
        return group
    })
}

/** Repeat a reference phrase at its native musical length, clipping only the final pass. */
export function referencePerformance(region: NoteRegionBoxAdapter | AudioRegionBoxAdapter, command: Command, duration: number, variation: number) {
    const phrase = Math.min(region.duration, duration)
    if (phrase < 1) throw new Error('Choose a reference at least one timeline tick long.')
    const beats = phrase / PPQN.Quarter, endBeat = duration / PPQN.Quarter
    const notes = region instanceof NoteRegionBoxAdapter ? midiPhrase(region, phrase, command, variation)
        : generateNotes(command, variation).filter(note => note.beat < beats)
    if (notes.length * Math.ceil(duration / phrase) > maxReferenceEvents) throw new Error('Shorten the cue or use a longer reference phrase.')
    const output: Note[] = []
    for (let offset = 0; offset < duration; offset += phrase) {
        for (const note of notes) {
            const beat = offset / PPQN.Quarter + note.beat
            const length = Math.min(note.length, beats - note.beat, endBeat - beat)
            if (length > 0) output.push({...note, beat, length})
        }
    }
    return output
}
