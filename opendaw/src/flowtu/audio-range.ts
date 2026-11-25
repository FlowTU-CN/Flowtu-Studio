export type AudioTimeRange = {start:number;end:number}
export function normalizeAudioRange(anchor:number,cursor:number,maximum:number):AudioTimeRange {
    const a=Math.max(0,Math.min(maximum,Math.round(anchor))),b=Math.max(0,Math.min(maximum,Math.round(cursor)))
    return {start:Math.min(a,b),end:Math.max(a,b)}
}
/** Seconds-based clip lengths are stored as Float32; compare edges on the integer edit grid. */
export function endTick(position:number,complete:number):number {
    return Math.max(position+1,Math.round(complete))
}
export function intersectsAudioRange(position:number,complete:number,range:AudioTimeRange):boolean {
    return complete>position&&endTick(position,complete)>range.start&&position<range.end
}
/** Keep a usable body on compact clips and a consistent grab strip on tall tracks. */
export const smartMoveBoundary = (height: number, labelHeight: number) =>
    labelHeight + Math.min(20, Math.max(0, height - labelHeight) * .28)

export const smartEdgeWidth = (width: number) => Math.min(8, Math.max(0, width) / 4)

export function isSmartRangeZone(x: number, y: number, start: number, end: number,
                                 top: number, bottom: number, labelHeight: number, previous?: boolean): boolean {
    const edge = smartEdgeWidth(end - start)
    // A small dead band keeps hand jitter around the divider from changing the operation.
    const tolerance = previous === undefined ? 0 : previous ? -2 : 2
    return x > start + edge && x < end - edge && y >= top + smartMoveBoundary(bottom - top, labelHeight) + tolerance
        && y < bottom - 3
}
