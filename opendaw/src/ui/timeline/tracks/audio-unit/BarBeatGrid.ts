import {Iterables, Lifecycle} from "@opendaw/lib-std"
import {PPQN} from "@opendaw/lib-dsp"
import {SignatureTrackAdapter} from "@opendaw/studio-adapters"
import {CanvasPainter, TimelineRange} from "@opendaw/studio-core"

type Props = {lifecycle: Lifecycle, range: TimelineRange, signatureTrack: SignatureTrackAdapter}

/** A single backdrop stays aligned underneath every arrangement lane, including empty space. */
export const BarBeatGrid = ({lifecycle, range, signatureTrack}: Props) => {
    const canvas = document.createElement("canvas")
    canvas.className = "bar-beat-grid"
    canvas.setAttribute("aria-hidden", "true")
    const painter = lifecycle.own(new CanvasPainter(canvas, surface => renderBarBeatGrid(surface, range, signatureTrack)))
    lifecycle.ownAll(range.subscribe(painter.requestUpdate), signatureTrack.subscribe(painter.requestUpdate))
    return canvas
}

export function renderBarBeatGrid(
    {context, width, actualHeight, devicePixelRatio: dpr}: Pick<CanvasPainter, "context" | "width" | "actualHeight" | "devicePixelRatio">,
    range: TimelineRange, signatureTrack: SignatureTrackAdapter
) {
    const scale = range.unitsPerPixel
    if (!(scale > 0 && Number.isFinite(scale))) {return}
    const left = Math.max(0, range.xToUnit(0))
    const right = range.xToUnit(width)
    const toX = (pulse: number) => Math.floor(range.unitToX(pulse)) * dpr
    for (const [meter, next] of Iterables.pairWise(signatureTrack.iterateAll())) {
        const start = meter.accumulatedPpqn
        if (start >= right) {break}
        const end = Math.min(right, next?.accumulatedPpqn ?? right)
        const beat = PPQN.fromSignature(1, meter.denominator)
        const bar = beat * meter.nominator
        if (left >= end || bar <= 0 || beat <= 0) {continue}
        // At film-overview scales keep measure groups visible instead of omitting every bar.
        const barsPerGroup = Math.max(1, 2 ** Math.ceil(Math.log2(4 * scale / bar)))
        const group = bar * barsPerGroup
        const firstGroup = Math.floor((Math.max(left, start) - start) / group)
        for (let i = firstGroup, pulse = start + i * group; pulse < end; ++i, pulse += group) {
            const x = toX(pulse)
            const groupEnd = Math.min(pulse + group, end)
            if ((Math.floor(meter.accumulatedBars / barsPerGroup) + i) % 2 === 1) {
                context.fillStyle = "rgba(186, 199, 213, 0.13)"
                context.fillRect(x, 0, toX(groupEnd) - x, actualHeight)
            }
            context.fillStyle = "#525b65"
            context.fillRect(x, 0, dpr, actualHeight)
            if (beat < 4 * scale) {continue}
            context.fillStyle = "#393c40"
            const firstBeat = Math.max(1, Math.ceil((left - pulse) / beat))
            for (let tick = pulse + firstBeat * beat; tick < groupEnd; tick += beat) {
                context.fillRect(toX(tick), 0, dpr, actualHeight)
            }
        }
    }
}
