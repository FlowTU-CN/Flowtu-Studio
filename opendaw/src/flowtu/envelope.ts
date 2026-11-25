// Automation nodes are stored in the region's repeating local time, not screen pixels.
export function envelopeLocalPosition(absolute: number, offset: number, loopDuration: number): number {
    if (!Number.isFinite(absolute) || !Number.isFinite(offset) || !Number.isFinite(loopDuration) || loopDuration <= 0) return 0
    return Math.max(0, Math.min(loopDuration - 1, Math.round(((absolute - offset) % loopDuration + loopDuration) % loopDuration)))
}

export function envelopeValue(y: number, top: number, bottom: number): number {
    return Math.max(0, Math.min(1, (bottom - y) / Math.max(1, bottom - top)))
}

// Keep neighbours ordered and retain same-time incoming/outgoing pairs created by the native editor.
export function boundedEnvelopePosition(position: number, duration: number, previous?: number, next?: number): number {
    const min = previous === undefined ? 0 : previous + 1
    const max = Math.min(duration - 1, next === undefined ? duration - 1 : next - 1)
    return Math.round(Math.max(min, Math.min(max, position)))
}
