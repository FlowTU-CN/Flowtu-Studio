import type {Note} from './commands'

const styles = {
    cinematic: {label: 'Cinematic', gate: 1.02, accent: .08, pulse: 0, voices: .25},
    electronic: {label: 'Electronic', gate: .73, accent: .12, pulse: .34, voices: 0},
    ambient: {label: 'Ambient', gate: 1.08, accent: -.03, pulse: -.30, voices: .22},
    acoustic: {label: 'Acoustic', gate: .89, accent: .05, pulse: .12, voices: -.15}
} as const
export type ScoreStyle = 'prompt' | keyof typeof styles
export type ScoreDirection = {style: ScoreStyle; melody: number; arrangement: number; emotion: number; character: number}
export const neutralDirection: ScoreDirection = {style: 'prompt', melody: 0, arrangement: 0, emotion: 0, character: 0}
export const styleNames = Object.entries(styles).map(([value, {label}]) => ({value, label}))

// Both pointers use the circular bounds of the original scoring prompt panel.
export function boundPad(x: number, y: number) {
    const scale = 100 / Math.max(100, Math.hypot(x, y))
    return [Math.round(x * scale), Math.round(y * scale)] as const
}

export function readDirection(data: unknown): ScoreDirection | undefined {
    if (!data || typeof data !== 'object') return
    const fields = data as Partial<ScoreDirection>
    const axis = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(-100, Math.min(100, value)) : 0
    const [melody, arrangement] = boundPad(axis(fields.melody), axis(fields.arrangement))
    const [emotion, character] = boundPad(axis(fields.emotion), axis(fields.character))
    const style = fields.style && Object.hasOwn(styles, fields.style) ? fields.style : 'prompt'
    if (style === 'prompt' && !melody && !arrangement && !emotion && !character) return
    return {style, melody, arrangement, emotion, character}
}

export function directionText(value: ScoreDirection): string {
    const words = [value.style === 'prompt' ? '' : styles[value.style].label]
    for (const [level, low, high] of [
        [value.melody, 'simple melody', 'intricate melody'], [value.arrangement, 'spare voicing', 'layered voicing'],
        [value.emotion, 'restrained dynamics', 'expressive dynamics'], [value.character, 'subtle accents', 'pronounced accents']
    ] as const) {
        if (level) words.push(level > 0 ? high : low)
    }
    return words.filter(Boolean).join(' · ')
}

/** Articulate the parsed musical phrase while preserving its harmony, meter and boundaries. */
export function shapeScoringNotes(notes: Note[], direction?: ScoreDirection): Note[] {
    if (!direction) return notes
    const profile = direction.style === 'prompt' ? undefined : styles[direction.style]
    const intensity = 1 + direction.character / 100
    const complexity = Math.max(-1, Math.min(1, direction.melody / 100 + (profile?.pulse ?? 0) * intensity))
    const thickness = Math.max(-1, Math.min(1, direction.arrangement / 100 + (profile?.voices ?? 0) * intensity))
    const gate = 1 + ((profile?.gate ?? 1) - 1) * intensity
    const groups = new Map<number, Note[]>()
    for (const note of notes) {
        const group = groups.get(note.beat)
        if (group) group.push(note)
        else groups.set(note.beat, [note])
    }
    const result: Note[] = []
    const beats = [...groups.keys()].sort((a, b) => a - b)
    for (const [index, beat] of beats.entries()) {
        // Distribute ornaments and doubled voices over the phrase deterministically.
        const pulse = ((index * 37 + 13) % 100) / 100
        if (beat % 4 && complexity < 0 && pulse < -complexity * .8) continue
        const chord = groups.get(beat)!.sort((a, b) => a.pitch - b.pitch)
        const voices = chord.slice(0, Math.max(1, Math.round(chord.length * (1 + Math.min(thickness, 0) * .8))))
        const top = voices[voices.length - 1]
        if (thickness > pulse && top.pitch <= 108) voices.push({...top, pitch: top.pitch + 12, velocity: top.velocity * .76})
        const accent = (beat % 2 === 0 ? 1 : -.55) * ((profile?.accent ?? 0) * intensity + direction.character * .0007)
        for (const voice of voices) {
            const velocity = Math.min(.98, Math.max(.10, voice.velocity + direction.emotion * .0021 + accent))
            const length = Math.min(voice.length * gate, (beats[index + 1] ?? (beat + voice.length)) - beat)
            const split = voice === top && complexity > pulse
            result.push({...voice, beat, length: split ? length * .48 : length, velocity})
            if (split) result.push({...voice, beat: beat + length / 2, length: length * .46, velocity: velocity * .86})
        }
    }
    return result
}
