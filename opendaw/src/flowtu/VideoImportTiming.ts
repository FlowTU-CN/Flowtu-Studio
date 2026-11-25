import {frameToSeconds, secondsToFrame, type FrameRate} from './time-format'

/** Correct a tiny pulse conversion error at a video frame boundary when paused. */
export function referenceVideoSeekTime(wanted: number, duration: number, rate?: FrameRate, tolerance=.001): number {
    let time = Math.max(0, Math.min(duration, wanted))
    if (rate) {
        const boundary = frameToSeconds(secondsToFrame(time, rate), rate)
        if (Math.abs(boundary - time) < tolerance) time = Math.max(0, Math.min(duration, boundary))
    }
    return time
}
