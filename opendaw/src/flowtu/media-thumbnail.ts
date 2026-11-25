import {Peaks} from '@opendaw/lib-fusion'
import {AudioRegionBoxAdapter, NoteRegionBoxAdapter} from '@opendaw/studio-adapters'
import type {Terminator} from '@opendaw/lib-std'

export function drawMediaThumbnail(canvas: HTMLCanvasElement, region: AudioRegionBoxAdapter | NoteRegionBoxAdapter, owner: Terminator) {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width = 256, h = canvas.height = 88
    if (region instanceof NoteRegionBoxAdapter) {
        const notes = region.optCollection.unwrapOrNull()?.events.asArray() ?? []
        let low = 127, high = 0, end = 1
        for (const note of notes) {
            low = Math.min(low, note.pitch); high = Math.max(high, note.pitch); end = Math.max(end, note.complete)
        }
        ctx.fillStyle = '#e4a768'
        for (const note of notes) {
            const y = high === low ? h / 2 : 9 + (high - note.pitch) / (high - low) * (h - 20)
            ctx.fillRect(note.position / end * w, y, Math.max(2, note.duration / end * w), 3)
        }
        return
    }
    const loader = region.file.getOrCreateLoader()
    const draw = () => {
        const peaks = loader.peaks.unwrapOrNull()
        if (!peaks) return
        const stage = peaks.nearest(peaks.numFrames / w) ?? peaks.stages[0]
        if (!stage) return
        const samples = peaks.numFrames / w / stage.unitsEachPeak()
        ctx.clearRect(0, 0, w, h)
        ctx.fillStyle = '#83c3df'
        for (let x = 0; x < w; x++) {
            const from = Math.floor(x * samples)
            const to = Math.min(stage.numPeaks, Math.max(from + 1, Math.floor((x + 1) * samples)))
            let lo = 0, hi = 0
            for (const channel of peaks.data) {
                for (let i = from; i < to; i++) {
                    const bits = channel[stage.dataOffset + i]
                    lo = Math.min(lo, Peaks.unpack(bits, 0)); hi = Math.max(hi, Peaks.unpack(bits, 1))
                }
            }
            ctx.fillRect(x, h / 2 - hi * 40, 1, Math.max(1, (hi - lo) * 40))
        }
    }
    draw()
    owner.own(loader.subscribe(draw))
}
