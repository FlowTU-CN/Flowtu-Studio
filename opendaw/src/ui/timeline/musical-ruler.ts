import {Iterables} from "@opendaw/lib-std"
import {PPQN} from "@opendaw/lib-dsp"
import type {SignatureTrackAdapter} from "@opendaw/studio-adapters"
import type {TimelineRange} from "@opendaw/studio-core"

export type MusicalTick = {x: number, kind: "bar" | "beat" | "division", label: string}

// Only subdivide a beat by exact factors. With 960 PPQN the binary divisions eventually reach
// 15 ticks, then 5 and 1; all labels correspond to positions the engine can actually address.
function tickStep(bar: number, beat: number, minimum: number): number {
    if (bar < minimum) {return bar * 2 ** Math.ceil(Math.log2(minimum / bar))}
    if (beat < minimum) {return bar}
    let step = beat
    for (const factor of [2, 3, 5]) {
        while (step % factor === 0 && step / factor >= minimum) {step /= factor}
    }
    return step
}

export function musicalRulerTicks(range: TimelineRange, signatures: SignatureTrackAdapter, barOffset: number): MusicalTick[] {
    const scale = range.unitsPerPixel
    if (!(scale > 0 && Number.isFinite(scale))) {return []}
    const spacing = 56
    const left = Math.max(0, range.xToUnit(-spacing))
    const right = range.xToUnit(range.width)
    const result: MusicalTick[] = []
    for (const [event, next] of Iterables.pairWise(signatures.iterateAll())) {
        const start = event.accumulatedPpqn
        if (start >= right) {break}
        const end = Math.min(right, next?.accumulatedPpqn ?? right)
        const beat = PPQN.fromSignature(1, event.denominator)
        const bar = beat * event.nominator
        if (left >= end || bar <= 0) {continue}
        const step = tickStep(bar, beat, scale * spacing)
        const first = start + Math.max(0, Math.ceil((left - start) / step)) * step
        for (let pulse = first; pulse < end; pulse += step) {
            // Leave room for the next meter's first bar label even if the old meter skipped bars.
            if (next && next.accumulatedPpqn - pulse < scale * spacing) {continue}
            const local = pulse - start
            const barLabel = String(event.accumulatedBars + Math.floor(local / bar) + barOffset)
            const x = Math.floor(range.unitToX(pulse))
            if (local % bar === 0) {result.push({x, kind: "bar", label: barLabel}); continue}
            const beatLabel = `${barLabel}•${Math.floor((local % bar) / beat) + 1}`
            const inBeat = local % beat
            if (inBeat === 0) {result.push({x, kind: "beat", label: beatLabel}); continue}
            const semiquaver = Math.floor(inBeat / PPQN.SemiQuaver) + 1
            const tick = inBeat % PPQN.SemiQuaver
            const label = `${beatLabel}•${semiquaver}` + (tick ? ":" + tick.toString().padStart(3, "0") : "")
            result.push({x, kind: "division", label})
        }
    }
    return result
}
