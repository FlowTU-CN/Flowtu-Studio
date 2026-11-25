import type {Dragging} from '@opendaw/lib-dom'
import type {AudioRegionBoxAdapter} from '@opendaw/studio-adapters'
import type {Project, RegionBound, TimelineRange} from '@opendaw/studio-core'
import {curveProgress} from './crossfades'
import {handleX} from './fades'

type Fade = Pick<AudioRegionBoxAdapter['fading'], 'in' | 'out' | 'inSlope' | 'outSlope'>
type HorizontalRange = Pick<TimelineRange, 'unitToX'>
type FadeHandle = 'fade-in' | 'fade-out' | 'curve-in' | 'curve-out'
const directions = ['in','out'] as const

function fadeSide(range: HorizontalRange, fading: Fade, bound: RegionBound, start: number, end: number,
                  side: 'in' | 'out', power = false) {
    const incoming = side === 'in'
    const scale = Math.min(1, (end - start) / Math.max(1, fading.in + fading.out))
    const length = fading[side] * scale
    const left = range.unitToX(incoming ? start : end - length)
    const right = range.unitToX(incoming ? start + length : end)
    const slope = incoming ? fading.inSlope : fading.outSlope
    const yAt = (fraction: number) => {
        const progress = curveProgress(fraction, slope, incoming, power)
        return bound.top + (incoming ? 1 - progress : progress) * (bound.bottom - bound.top)
    }
    return {left, right, yAt, squareX: handleX(range.unitToX(start), range.unitToX(end), incoming ? right : left),
        squareY: bound.top + 7, pointX: (left + right) / 2, pointY: yAt(.5), showPoint: right - left >= 12 && !power}
}

export function hitFadeHandle(range: HorizontalRange, fading: Fade, bound: RegionBound, start: number, end: number,
                              x: number, y: number): FadeHandle | undefined {
    let bestDistance = 8, hit: FadeHandle | undefined
    for (const side of directions) {
        const f = fadeSide(range, fading, bound, start, end, side)
        const squareDistance = Math.hypot(x - f.squareX, y - f.squareY)
        if (squareDistance < bestDistance) {
            hit = side === 'in' ? 'fade-in' : 'fade-out'
            bestDistance = squareDistance
        }
        const pointDistance = Math.hypot(x - f.pointX, y - f.pointY)
        if (f.showPoint && pointDistance < bestDistance) {
            hit = side === 'in' ? 'curve-in' : 'curve-out'
            bestDistance = pointDistance
        }
    }
    return hit
}

/** A midpoint at x=.5 has gain=slope for fade in, and gain=1-slope for fade out. */
export function fadeCurveDrag(project: Project, region: AudioRegionBoxAdapter, incoming: boolean, startY: number, height: number): Dragging.Process {
    const field = incoming ? region.fading.inSlopeField : region.fading.outSlopeField
    const before = field.getValue()
    const set = (slope: number) => {
        if (region.box.isAttached() && Math.abs(field.getValue() - slope) > 1e-7) {
            project.editing.modify(() => field.setValue(slope), false)
        }
    }
    return {
        update(event) {
            const delta = (startY - event.clientY) / Math.max(1, height)
            set(Math.min(.99, Math.max(.01, before + (incoming ? delta : -delta))))
        },
        approve: () => project.editing.mark(),
        cancel() {set(before); project.editing.mark()}
    }
}

export const AudioFadingRenderer = {
    render(ctx: CanvasRenderingContext2D, range: TimelineRange, region: AudioRegionBoxAdapter,
           bound: RegionBound, start: number, end: number) {
        const dpr = devicePixelRatio
        ctx.save()
        ctx.scale(dpr, dpr)
        const width = ctx.canvas.width / dpr
        for (const side of directions) {
            const power = (side === 'in' ? region.box.fading.inEqualPower : region.box.fading.outEqualPower).getValue()
            const f = fadeSide(range, region.fading, bound, start, end, side, power)
            const first = Math.max(0, f.left), last = Math.min(width, f.right)
            if (last > first) {
                const path = new Path2D()
                const ordinate = (x: number) => f.yAt((x - f.left) / (f.right - f.left))
                path.moveTo(first, ordinate(first))
                for (let x = first + 2; x < last; x += 2) path.lineTo(x, ordinate(x))
                path.lineTo(last, ordinate(last))
                ctx.strokeStyle = '#acd5ff'; ctx.lineWidth = 1.25; ctx.stroke(path)
                path.lineTo(last, bound.top); path.lineTo(first, bound.top); path.closePath()
                ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill(path)
            }
            ctx.fillStyle = side === 'in' ? '#5aaff8' : '#ff9b47'
            ctx.strokeStyle = '#0b1622'; ctx.lineWidth = 1
            ctx.beginPath(); ctx.roundRect(f.squareX - 4, f.squareY - 4, 8, 8, 2)
            ctx.fill(); ctx.stroke()
            if (f.showPoint) {
                ctx.beginPath(); ctx.arc(f.pointX, f.pointY, 4, 0, 2 * Math.PI)
                ctx.fill(); ctx.stroke()
            }
        }
        ctx.restore()
    }
}
