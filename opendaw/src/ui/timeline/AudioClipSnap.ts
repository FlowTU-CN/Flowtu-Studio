import {isAssetLane} from "@/flowtu/playback-lanes"
import {BinarySearch, NumberComparator} from "@opendaw/lib-std"
import {TimeBase} from "@opendaw/lib-dsp"
import {AudioRegionBoxAdapter, type AnyRegionBoxAdapter, TrackType} from "@opendaw/studio-adapters"
import type {Project} from "@opendaw/studio-core"
import type {Snapping} from "./Snapping"

type Edit = "move" | "start" | "end"
const radiusPixels = 8

function nearest(edges: readonly number[], value: number) {
    const index = BinarySearch.leftMost(edges, value, NumberComparator)
    const before = edges[index - 1], after = edges[index]
    if (before === undefined) {return after}
    if (after === undefined) {return before}
    return value - before <= after - value ? before : after
}

// Snapshot target edges once per gesture. Copies can also snap to the clips left at their original positions.
function clipEdges(project: Project, selected: readonly AnyRegionBoxAdapter[], includeNotes = false) {
    const others = new Set<number>(), originals = new Set<number>(), moving = new Set(selected)
    for (const unit of project.rootBoxAdapter.audioUnits.adapters()) {
        for (const track of unit.tracks.values()) {
            if ((track.type !== TrackType.Audio && !(includeNotes && track.type === TrackType.Notes)) || isAssetLane(track)) {continue}
            for (const region of track.regions.collection.asArray()) {
                const edges = moving.has(region) ? originals : others
                edges.add(region.position)
                edges.add(region.complete)
            }
        }
    }
    return {others: [...others].sort(NumberComparator), originals: [...originals].sort(NumberComparator)}
}

type MovingEnd = {endAt(start: number): number, startAt(end: number): number}

function magnet(snapping: Snapping, raw: number, targets: ReturnType<typeof clipEdges>,
                includeOriginals: boolean, tail?: MovingEnd) {
    let distance = Infinity, result: number | undefined, guide: number | null = null
    const consider = (pulse: number, trailing: boolean) => {
        for (const edges of includeOriginals ? [targets.others, targets.originals] : [targets.others]) {
            const edge = nearest(edges, pulse)
            if (edge === undefined) {continue}
            const diff = Math.abs(edge - pulse)
            if (diff >= distance || diff > radiusPixels * snapping.range.unitsPerPixel) {continue}
            // Seconds-based ends may fall between native integer positions. Round to the outside of
            // a butt joint to avoid accidentally creating a one-tick crossfade.
            const aligned = trailing ? Math.floor(tail!.startAt(edge) + 1e-7) : Math.ceil(edge - 1e-7)
            if (aligned < 0) {continue}
            distance = diff; result = aligned; guide = edge
        }
    }
    if (snapping.target !== "grid") {
        consider(raw, false)
        if (tail) {consider(tail.endAt(raw), true)}
    }
    if (result === undefined) {
        result = snapping.round(raw)
        if (snapping.gridEnabled) {guide = result}
    }
    snapping.guide.setValue(guide)
    return result
}

export function clipDragSnap(project: Project, snapping: Snapping, selected: readonly AnyRegionBoxAdapter[],
                             region: AnyRegionBoxAdapter, edit: Edit, pointerDown: number) {
    const origin = edit === "end" ? region.complete : region.position
    if (!(region instanceof AudioRegionBoxAdapter)) {
        return (x: number) => snapping.computeDelta(pointerDown, x, edit === "end" ? region.duration : origin)
    }
    const targets = clipEdges(project, selected)
    const tail: MovingEnd | undefined = edit !== "move" ? undefined : {
        endAt: start => region.resolveComplete(start),
        startAt: end => region.timeBase === TimeBase.Seconds
            ? project.tempoMap.secondsToPPQN(project.tempoMap.ppqnToSeconds(end) - region.box.duration.getValue())
            : end - region.duration
    }
    return (x: number, bypass = false, copy = false) => {
        const delta = snapping.range.xToUnit(x) - pointerDown
        if (bypass || !snapping.enabled || delta === 0) {
            snapping.guide.setValue(null)
            return Math.round(delta)
        }
        return magnet(snapping, origin + delta, targets, copy, tail) - origin
    }
}

export function snapDroppedClip(project: Project, snapping: Snapping, x: number, bypass: boolean, tail: MovingEnd) {
    const raw = snapping.range.xToUnit(x)
    if (bypass || !snapping.enabled) {return Math.max(0, Math.round(raw))}
    const position = magnet(snapping, raw, clipEdges(project, []), false, tail)
    snapping.guide.setValue(null)
    return Math.max(0, position)
}

/** Work area handles also magnetize to MIDI clip edges. Collect them once on pointer down. */
export function locatorSnap(project: Project, snapping: Snapping) {
    const targets = clipEdges(project, [], true)
    return (raw: number, bypass: boolean) => {
        if (bypass || !snapping.enabled) {
            snapping.guide.setValue(null)
            return Math.round(raw)
        }
        return magnet(snapping, raw, targets, false)
    }
}
