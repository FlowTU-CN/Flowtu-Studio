import {getEnvelopeRange} from '@/flowtu/timeline-selection'
import {smartMoveBoundary} from "@/flowtu/audio-range"
import {editingTool} from "@/flowtu/editing-state"
import {trackTint} from "@/flowtu/track-color"
import {crossfades} from "@/flowtu/crossfades"
import {int, Iterables, Option, unitValue} from "@opendaw/lib-std"
import {LoopableRegion, ValueEvent} from "@opendaw/lib-dsp"
import {AudioRegionBoxAdapter, NoteRegionBoxAdapter, ValueRegionBoxAdapter} from "@opendaw/studio-adapters"
import {renderEnvelopeNodes} from "@/flowtu/EnvelopeTools"
import {
    AudioRenderer,
    NotesRenderer,
    RegionBound,
    RegionModifyStrategies,
    RegionModifyStrategy,
    TimelineRange,
    ValueStreamRenderer
} from "@opendaw/studio-core"
import {TracksManager} from "@/ui/timeline/tracks/audio-unit/TracksManager.ts"
import {Context2d} from "@opendaw/lib-dom"
import {RegionPaintBucket} from "@/ui/timeline/tracks/audio-unit/regions/RegionPaintBucket"
import {RegionLabel} from "@/ui/timeline/RegionLabel"
import {TimelineLabels} from "@/ui/timeline/TimelineLabels"
import {AudioFadingRenderer} from "@/flowtu/FadeHandles"

export namespace RegionRenderer {
    let audioRenderStrategy: AudioRenderer.Strategy = AudioRenderer.DefaultStrategy

    // noinspection JSUnusedGlobalSymbols
    export const setAudioRenderStrategy = (strategy: AudioRenderer.Strategy): void => {audioRenderStrategy = strategy}

    export const render = (context: CanvasRenderingContext2D,
                           tracks: TracksManager,
                           range: TimelineRange,
                           index: int): void => {
        const canvas = context.canvas
        const {width, height} = canvas
        const row = tracks.getByIndex(index).unwrapOrNull()?.trackBoxAdapter
        const tint = trackTint(row)
        const {fontFamily} = getComputedStyle(canvas)

        // subtract one pixel to avoid making special cases for a possible outline
        const unitMin = range.unitMin - range.unitPadding - range.unitsPerPixel
        const unitMax = range.unitMax

        const dpr = devicePixelRatio
        const cssLabelHeight = RegionLabel.labelHeight()
        const fontSize = RegionLabel.fontSize() * dpr
        const labelHeight = cssLabelHeight * dpr
        const bound: RegionBound = {top: cssLabelHeight + 1, bottom: canvas.clientHeight}

        context.clearRect(0, 0, width, height)
        context.textBaseline = "middle"
        context.font = `${fontSize}px ${fontFamily}`

        const renderRegions = (strategy: RegionModifyStrategy, filterSelected: boolean, hideSelected: boolean): void => {
            const optTrack = tracks.getByIndex(strategy.translateTrackIndex(index))
            if (optTrack.isEmpty()) {return}
            const trackBoxAdapter = optTrack.unwrap().trackBoxAdapter
            const trackDisabled = !trackBoxAdapter.enabled.getValue()
            const spans = tracks.playbackLanes(trackBoxAdapter).flatMap(lane =>
                [...Iterables.pairWise(strategy.iterateRange(lane.regions.collection, unitMin, unitMax))])
            for (const [region, next] of spans) {
                if (region.isSelected ? hideSelected : !filterSelected) {continue}
                const actualComplete = strategy.readComplete(region)
                const position = strategy.readPosition(region)
                const complete = region.isSelected
                    ? actualComplete
                    : // for no-stretched audio region
                    Math.min(actualComplete, next?.position ?? Number.POSITIVE_INFINITY)
                const x0Raw = Math.floor(range.unitToX(Math.max(position, unitMin))) * dpr
                const x1Int = Math.max(Math.floor(range.unitToX(Math.min(complete, unitMax))) * dpr, x0Raw + dpr)
                // start one pixel late to let the grid line through
                const x0Int = x1Int - x0Raw < 2 * dpr ? x0Raw : x0Raw + dpr
                const xnInt = x1Int - x0Int
                const selected = region.isSelected && !filterSelected
                const {labelColor, labelBackground, contentColor, contentBackground, loopStrokeColor} =
                    RegionPaintBucket.create(region, selected, trackDisabled, tint)
                context.clearRect(x0Int, 0, xnInt, height)
                context.fillStyle = labelBackground
                context.fillRect(x0Int, 0, xnInt, labelHeight)
                context.fillStyle = contentBackground
                context.fillRect(x0Int, labelHeight, xnInt, height - labelHeight)
                const maxTextWidth = xnInt - 3 * dpr // subtract text-padding
                context.fillStyle = labelColor
                if (strategy.readMirror(region)) {
                    context.font = `italic ${fontSize}px ${fontFamily}`
                } else {
                    context.font = `${fontSize}px ${fontFamily}`
                }
                const text = TimelineLabels.forRegion(region)
                context.fillText(Context2d.truncateText(context, text, maxTextWidth).text, x0Int + 3 * dpr, 1 + labelHeight / 2)
                if (region.hasCollection) {
                    const loops = Array.from(LoopableRegion.locateLoops({
                        position, complete,
                        loopOffset: strategy.readLoopOffset(region),
                        loopDuration: strategy.readLoopDuration(region)
                    }, unitMin, unitMax))
                    context.fillStyle = loopStrokeColor
                    loops.filter(pass => pass.index > 0).forEach(pass =>
                        context.fillRect(Math.floor(range.unitToX(pass.resultStart) * dpr), labelHeight, 1, height - labelHeight))
                    context.fillStyle = contentColor
                    context.save()
                    context.beginPath()
                    context.rect(x0Int, labelHeight, xnInt, height - labelHeight)
                    context.clip()
                    region.accept({
                        visitNoteRegionBoxAdapter: (region: NoteRegionBoxAdapter): void =>
                            region.optCollection.ifSome(collection => loops.forEach(pass =>
                                NotesRenderer.render(context, range, collection, bound, contentColor, pass))),
                        visitAudioRegionBoxAdapter: (region: AudioRegionBoxAdapter): void =>
                            region.optFile.ifSome(file => {
                                const tempoMap = region.trackBoxAdapter.unwrap("trackBoxAdapter").context.tempoMap
                                loops.forEach(pass => AudioRenderer.render(context, range, file, tempoMap,
                                    region.observableOptPlayMode, region.waveformOffset.getValue(),
                                    region.gain.getValue(), bound, contentColor, pass, true, audioRenderStrategy))
                                AudioFadingRenderer.render(context, range, region, bound, position, complete)
                            }),
                        visitValueRegionBoxAdapter: (region: ValueRegionBoxAdapter): void => {
                            const top = bound.top * dpr
                            const bottom = bound.bottom * dpr
                            const valueToY = (value: unitValue): number => bottom + value * (top - bottom)
                            const events = region.events.unwrap("events")
                            const selection = getEnvelopeRange(tracks.service.project)
                            loops.forEach(pass => {
                                const adapters = ValueEvent.iterateWindow(events,
                                    pass.resultStart - pass.rawStart, pass.resultEnd - pass.rawStart)
                                context.beginPath()
                                ValueStreamRenderer.render(context, range, adapters, valueToY, contentColor, 0.2, 0.0, pass)
                                context.stroke()
                                renderEnvelopeNodes(context, range, region, bound, pass, selection?.tracks.includes(trackBoxAdapter) ? selection : undefined)
                            })
                        }
                    })
                    context.restore()
                }
                if (region instanceof AudioRegionBoxAdapter && editingTool.getValue() === "select") {
                    const divider = Math.round(smartMoveBoundary(canvas.clientHeight, cssLabelHeight) * dpr)
                    context.fillStyle = "rgba(200,228,248,.05)"
                    context.fillRect(x0Int, labelHeight, xnInt, divider - labelHeight)
                    context.fillStyle = "rgba(200,228,248,.32)"
                    context.fillRect(x0Int, divider, xnInt, dpr)
                }
                if (selected) {
                    context.fillStyle = labelBackground
                    context.fillRect(x0Int, labelHeight, dpr, height - labelHeight)
                    context.fillRect(x1Int - dpr, labelHeight, dpr, height - labelHeight)
                    context.fillRect(x0Int, height - dpr, xnInt, dpr)
                }
            }
        }

        const modifier: Option<RegionModifyStrategies> = tracks.currentRegionModifier
        const strategy = modifier.unwrapOrElse(RegionModifyStrategies.Identity)

        renderRegions(strategy.unselectedModifyStrategy(), true, !strategy.showOrigin())
        renderRegions(strategy.selectedModifyStrategy(), false, false)
        if (modifier.nonEmpty()) {return}
        if (!row || tracks.playbackLanes(row).length < 2) {return}
        for (const {a, b} of crossfades(tracks.service.project)) {
            if (a.trackBoxAdapter.mapOr(t => tracks.displayTrack(t) !== row, true) ||
                b.trackBoxAdapter.mapOr(t => tracks.displayTrack(t) !== row, true)) {continue}
            const start = Math.max(unitMin, b.position), end = Math.min(unitMax, a.complete)
            if (end <= start) {continue}
            const x = range.unitToX(start) * dpr, w = (range.unitToX(end) * dpr) - x
            // Keep both clips individually addressable even when their full spans coincide.
            const split = range.unitToX((a.complete + b.position) / 2) * dpr
            for (const [r, lo, hi] of [[a, x, Math.min(x+w, split)], [b, Math.max(x, split), x+w]] as const) {
                if (hi <= lo) {continue}
                const bucket = RegionPaintBucket.create(r, r.isSelected, !row.enabled.getValue(), tint)
                context.clearRect(lo, 0, hi-lo, labelHeight)
                context.fillStyle = bucket.labelBackground
                context.fillRect(lo, 0, hi-lo, labelHeight)
                if (hi-lo < 26*dpr) {continue}
                context.fillStyle = bucket.labelColor
                context.fillText(Context2d.truncateText(context, TimelineLabels.forRegion(r), hi-lo-6*dpr).text,
                    lo + 3*dpr, 1 + labelHeight/2)
            }
            context.save()
            context.beginPath()
            context.rect(x, labelHeight, w, height - labelHeight)
            context.clip()
            context.clearRect(x, labelHeight, w, height - labelHeight)
            context.globalCompositeOperation = "lighter"
            const incoming = tint ? `hsl(${tint.h} ${tint.s*100}% 73% / 0.5)` : "rgba(134,202,250,0.5)"
            const outgoing = tint ? `hsl(${tint.h} ${tint.s*100}% 48% / 0.5)` : "rgba(255,183,128,0.5)"
            for (const [r, color] of [[a, outgoing], [b, incoming]] as const) {
                r.optFile.ifSome(file => {
                    for (const loop of LoopableRegion.locateLoops(r, start, end)) {
                        AudioRenderer.render(context, range, file, tracks.service.project.tempoMap,
                            r.observableOptPlayMode, r.waveformOffset.getValue(), r.gain.getValue(),
                            bound, color, loop, true, audioRenderStrategy)
                    }
                })
            }
            context.restore()
        }

    }
}
