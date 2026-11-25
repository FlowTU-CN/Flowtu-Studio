import {isSmartRangeZone, smartEdgeWidth} from "@/flowtu/audio-range"
import {clipAtSharedTitle} from "@/flowtu/playback-lanes"
import {
    AnyLoopableRegionBoxAdapter,
    AnyRegionBoxAdapter,
    AudioRegionBoxAdapter,
    UnionAdapterTypes
} from "@opendaw/studio-adapters"
import {BinarySearch, isDefined, isInstanceOf, Nullable, NumberComparator} from "@opendaw/lib-std"
import {PointerRadiusDistance} from "@/ui/timeline/constants.ts"
import {TracksManager} from "@/ui/timeline/tracks/audio-unit/TracksManager.ts"
import {TrackContext} from "@/ui/timeline/tracks/audio-unit/TrackContext.ts"
import {ExtraSpace} from "@/ui/timeline/tracks/audio-unit/Constants"
import {AudioUnitFreeze, ElementCapturing, TimelineRange} from "@opendaw/studio-core"
import {RegionLabel} from "@/ui/timeline/RegionLabel"
import {hitFadeHandle} from "@/flowtu/FadeHandles"
import {isEnvelopeTrack} from "@/flowtu/EnvelopeTools"
import {editingTool} from "@/flowtu/editing-state"

export type RegionCaptureTarget =
    | { type: "region", part: "position" | "range", region: AnyRegionBoxAdapter }
    | { type: "region", part: "start", region: AnyLoopableRegionBoxAdapter }
    | { type: "region", part: "complete", region: AnyRegionBoxAdapter }
    | { type: "region", part: "content-start", region: AnyRegionBoxAdapter }
    | { type: "region", part: "loop-duration", region: AnyRegionBoxAdapter }
    | { type: "region", part: "fade-in" | "fade-out" | "curve-in" | "curve-out", region: AudioRegionBoxAdapter }
    | { type: "track", track: TrackContext }

export namespace RegionCapturing {
    export const create = (element: Element, manager: TracksManager, range: TimelineRange, audioUnitFreeze: AudioUnitFreeze) => {
        let lastBody: AnyRegionBoxAdapter | undefined
        let lastRange = false
        return new ElementCapturing<RegionCaptureTarget>(element, {
            capture: (x: number, y: number): Nullable<RegionCaptureTarget> => {
                y += manager.scrollableContainer.scrollTop
                if (y > manager.scrollableContainer.scrollHeight - ExtraSpace) {
                    return null
                }
                const tracks = manager.tracks()
                const trackIndex = BinarySearch
                    .rightMostMapped(tracks, y, NumberComparator, component => component.position)
                if (trackIndex < 0 || trackIndex >= tracks.length) {return null}
                const track = tracks[trackIndex]
                // A y outside the resolved lane's own bounds sits in a band no TrackContext covers (the
                // synthetic unit lane): capture nothing there.
                if (y >= track.position + track.size) {return null}
                if (track.audioUnitBoxAdapter.mapOr(unit => audioUnitFreeze.isFrozen(unit), false)) {
                    return {type: "track", track}
                }
                const tool = editingTool.getValue()
                if (tool === 'select' && isEnvelopeTrack(track.trackBoxAdapter)) {
                    const pulse = range.xToUnit(x)
                    const region = track.trackBoxAdapter.regions.collection.lowerEqual(pulse)
                    return region && pulse < region.complete
                        ? {type:"region",part:"range",region}
                        : {type:"track",track}
                }
                const bound = {top: RegionLabel.labelHeight() + 1, bottom: track.size}
                const position = Math.floor(range.xToUnit(x))
                const threshold = range.unitsPerPixel * (tool === "select" ? 8 : PointerRadiusDistance)
                const lanes = manager.playbackLanes(track.trackBoxAdapter)
                const underTitle: AnyRegionBoxAdapter[] = []
                let edgeCapture: Nullable<RegionCaptureTarget> = null
                let edgeDistance = Infinity
                let edgeIsInside = false
                let bodyRegion: Nullable<AnyRegionBoxAdapter> = null
                for (const lane of lanes) for (const region of lane.regions.collection.iterateFrom(position - threshold)) {
                    if (region.position > position + threshold) { break }
                    if (position >= region.complete + threshold) { continue }
                    if (lanes.length > 1 && y < track.position + RegionLabel.labelHeight()) {underTitle.push(region)}
                    const x0 = range.unitToX(region.position)
                    const x1 = range.unitToX(region.complete)
                    if (isInstanceOf(region, AudioRegionBoxAdapter) && (tool === 'select' || tool === 'fade')) {
                        const part = hitFadeHandle(range, region.fading, bound, region.position, region.complete, x, y - track.position)
                        if (part) {return {type: "region", part, region}}
                    }
                    if (UnionAdapterTypes.isLoopableRegion(region)) {
                        const bottomEdge = y > track.position + RegionLabel.labelHeight()
                        const cursorInside = position >= region.position && position < region.complete
                        const edgeWidth = region instanceof AudioRegionBoxAdapter ? smartEdgeWidth(x1 - x0) : PointerRadiusDistance
                        const isBetter = (distance: number): boolean =>
                            distance <= edgeWidth
                            && (cursorInside && !edgeIsInside
                                || cursorInside === edgeIsInside && distance < edgeDistance)
                        // loop line first: on a tie with the region edge the loop handle wins
                        if (bottomEdge && !(region instanceof AudioRegionBoxAdapter)) {
                            const loopDistance = Math.abs(x - range.unitToX(region.offset + region.loopDuration))
                            if (isBetter(loopDistance)) {
                                edgeDistance = loopDistance
                                edgeIsInside = cursorInside
                                edgeCapture = {type: "region", part: "loop-duration", region}
                            }
                        }
                        const completeDistance = Math.abs(x - x1)
                        if (isBetter(completeDistance)) {
                            edgeDistance = completeDistance
                            edgeIsInside = cursorInside
                            edgeCapture = {type: "region", part: "complete", region}
                        }
                        const startDistance = Math.abs(x - x0)
                        if (isBetter(startDistance)) {
                            edgeDistance = startDistance
                            edgeIsInside = cursorInside
                            edgeCapture = bottomEdge && !(region instanceof AudioRegionBoxAdapter)
                                ? {type: "region", part: "content-start", region}
                                : {type: "region", part: "start", region}
                        }
                    }
                    if (position >= region.position && position < region.complete) bodyRegion = region
                }
                bodyRegion = clipAtSharedTitle(underTitle, position) ?? bodyRegion
                if (isDefined(bodyRegion) && tool !== 'select') {
                    const region = bodyRegion
                    const left = position < (region.position + region.complete) / 2
                    if (tool === 'fade' && region instanceof AudioRegionBoxAdapter)
                        return {type:'region',part:left?'fade-in':'fade-out',region}
                    if (tool === 'trim' && UnionAdapterTypes.isLoopableRegion(region))
                        return left ? {type:'region',part:'start',region} : {type:'region',part:'complete',region}
                    return {type:'region',part:'position',region}
                }
                if (tool === 'select' && isDefined(edgeCapture)) { return edgeCapture }
                if (tool === 'select' && bodyRegion instanceof AudioRegionBoxAdapter) {
                    lastRange = isSmartRangeZone(x, y, range.unitToX(bodyRegion.position), range.unitToX(bodyRegion.complete),
                        track.position, track.position + track.size, RegionLabel.labelHeight(),
                        lastBody === bodyRegion ? lastRange : undefined)
                    lastBody = bodyRegion
                    return {type: "region", part: lastRange ? "range" : "position", region: bodyRegion}
                }
                lastBody = undefined
                if (isDefined(bodyRegion)) { return {type: "region", part: "position", region: bodyRegion} }
                return {type: "track", track}
            }
        })
    }
}
