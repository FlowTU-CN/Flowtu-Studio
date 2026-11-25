import {copyAssetTo, displayTrack, playbackLanes, overlapLaneOrigin} from "./playback-lanes"
import {updateTakeMembership} from './scoring-model'
import {Curve, UUID} from "@opendaw/lib-std"
import {type AnyRegionBoxAdapter, AudioRegionBoxAdapter, AudioUnitBoxAdapter, MetaData, RegionEditing, TrackBoxAdapter, TrackType} from "@opendaw/studio-adapters"
import {AudioRegionBox} from "@opendaw/studio-boxes"
import type {Project} from "@opendaw/studio-core"

const origin = "flowtu:crossfades:v1"
type Link = {a: string, b: string, aUnit: string, bUnit: string, previousOut: number, previousIn: number, previousOutSlope: number, previousInSlope: number, previousOutPower?: boolean, previousInPower?: boolean}
export type Crossfade = {a: AudioRegionBoxAdapter, b: AudioRegionBoxAdapter}
export type CrossfadeCurveMode = "linear" | "constant-power" | "custom"
export function curveProgress(x: number, slope: number, incoming: boolean, power: boolean) {
    return power ? incoming ? Math.sin(x * Math.PI / 2) : 1 - Math.cos(x * Math.PI / 2) : Curve.normalizedAt(x, slope)
}
export function crossfadeCurveMode(_project: Project, {a, b}: Crossfade): CrossfadeCurveMode {
    if (a.box.fading.outEqualPower?.getValue() && b.box.fading.inEqualPower?.getValue()) {return "constant-power"}
    return a.fading.outSlope === 0.5 && b.fading.inSlope === 0.5 ? "linear" : "custom"
}

// Called in the caller's edit transaction. Both realtime and offline engines read these region fields.
export function setCrossfadeCurveMode(_project: Project, {a, b}: Crossfade, mode: CrossfadeCurveMode) {
    a.box.fading.outEqualPower.setValue(mode === "constant-power")
    b.box.fading.inEqualPower.setValue(mode === "constant-power")
    if (mode === "linear") {
        a.fading.outSlopeField.setValue(0.5)
        b.fading.inSlopeField.setValue(0.5)
    }
}
const id = (region: AudioRegionBoxAdapter) => UUID.toString(region.uuid)

function links(project: Project): Link[] {
    const value = MetaData.read(project.rootBox, origin)
    if (!Array.isArray(value)) {return []}
    return value.filter((p): p is Link => !!p && typeof p === "object" && !Array.isArray(p) &&
        typeof p.a === "string" && UUID.validateString(p.a) && typeof p.b === "string" && UUID.validateString(p.b) &&
        [p.previousIn, p.previousOut, p.previousOutSlope, p.previousInSlope].every(n => typeof n === "number" && Number.isFinite(n)))
}
function regionById(project: Project, uuid: string) {
    const box = project.boxGraph.findBox(UUID.parse(uuid)).unwrapOrNull()
    return box instanceof AudioRegionBox ? project.boxAdapters.adapterFor(box, AudioRegionBoxAdapter) : null
}
const unitId = (r: AudioRegionBoxAdapter) => r.trackBoxAdapter.flatMap(t => t.optAudioUnit).mapOr(unit => UUID.toString(unit.address.uuid), "")
function length(a: AudioRegionBoxAdapter, b: AudioRegionBoxAdapter) {
    // resolveComplete is valid even inside a transaction moving a seconds-based region across a tempo change.
    const end = a.resolveComplete(a.position)
    return a.position <= b.position && end <= b.resolveComplete(b.position) ? Math.max(0, end - b.position) : 0
}
export function crossfades(project: Project): Crossfade[] {
    return links(project).flatMap(link => {
        const a = regionById(project, link.a), b = regionById(project, link.b)
        return a && b && length(a, b) > 0 ? [{a, b}] : []
    })
}
// Call inside the same edit that moves, trims or deletes the source clips, so undo restores the whole transition.
export function syncCrossfades(project: Project) {
    const previous = links(project)
    const current = previous.filter(link => {
        const a = regionById(project, link.a), b = regionById(project, link.b)
        const duration = a && b && unitId(a) === link.aUnit && unitId(b) === link.bUnit ? length(a, b) : 0
        if (duration && a && b) {
            a.fading.outField.setValue(duration)
            b.fading.inField.setValue(duration)
            return true
        }
        if (a) {
            a.fading.outField.setValue(Math.min(link.previousOut, a.duration))
            a.fading.outSlopeField.setValue(link.previousOutSlope)
            a.box.fading.outEqualPower.setValue(link.previousOutPower ?? false)
        }
        if (b) {
            b.fading.inField.setValue(Math.min(link.previousIn, b.duration))
            b.fading.inSlopeField.setValue(link.previousInSlope)
            b.box.fading.inEqualPower.setValue(link.previousInPower ?? false)
        }
        return false
    })
    if (previous.length !== current.length) {MetaData.store(project.rootBox, current, origin)}
}
export function linkCrossfade(project: Project, a: AudioRegionBoxAdapter, b: AudioRegionBoxAdapter,
                              inSlope = .5, outSlope = .5) {
    const duration = length(a, b)
    if (!duration) {throw new Error("Place the start of clip B inside the end of clip A.")}
    const all = links(project), aId = id(a), bId = id(b)
    const linked = all.find(pair => pair.a === aId && pair.b === bId)
    if (!linked) {
        if (all.some(pair => pair.a === aId || pair.b === bId)) {
            throw new Error("This clip edge already belongs to a crossfade.")
        }
        all.push({a: aId, b: bId, aUnit: unitId(a), bUnit: unitId(b), previousOut: a.fading.out, previousIn: b.fading.in,
            previousOutSlope: a.fading.outSlope, previousInSlope: b.fading.inSlope,
            previousOutPower: a.box.fading.outEqualPower.getValue(), previousInPower: b.box.fading.inEqualPower.getValue()})
        MetaData.store(project.rootBox, all, origin)
    }
    a.fading.outField.setValue(duration)
    b.fading.inField.setValue(duration)
    setCrossfadeCurveMode(project, {a,b}, "custom")
    a.fading.outSlopeField.setValue(outSlope)
    b.fading.inSlopeField.setValue(inSlope)
}
export function overlapPartner(target: TrackBoxAdapter, start: number, end: number, moving?: AudioRegionBoxAdapter) {
    if (target.type !== TrackType.Audio || !target.enabled.getValue()) {return null}
    const overlaps = target.regions.collection.asArray().filter(r => r !== moving && r.position < end && r.complete > start)
    if (overlaps.length !== 1) {return null}
    const [r] = overlaps
    if (!(r instanceof AudioRegionBoxAdapter) || r.mute) {return null}
    return (r.position <= start && r.complete <= end) || (start <= r.position && end <= r.complete) ? r : null
}
export function freeAudioLane(project: Project, target: TrackBoxAdapter, start: number, end: number, moving?: AudioRegionBoxAdapter) {
    const unit = target.audioUnit
    const lane = playbackLanes(target).find(t =>
        t !== target && t.type === TrackType.Audio && t.enabled.getValue() && t.regions.collection.asArray().every(r =>
            r === moving || r.complete <= start || r.position >= end))
    if (lane) {return lane.box}
    const created = project.api.createAudioTrack(unit, target.indexField.getValue() + 1)
    MetaData.store(created, UUID.toString(displayTrack(target).uuid), overlapLaneOrigin)
    return created
}
// Keep both sources at full length. The engine mixes independent playback lanes on one audio unit.
export function moveIntoCrossfade(project: Project, r: AudioRegionBoxAdapter, target: TrackBoxAdapter, start: number, copy = false) {
    if (r.mute || project.audioUnitFreeze.isFrozen(project.boxAdapters.adapterFor(target.audioUnit, AudioUnitBoxAdapter))) {return false}
    const end = r.resolveComplete(start)
    const overlaps = playbackLanes(target).flatMap(lane => {
        const partner = overlapPartner(lane, start, end, copy ? undefined : r)
        return partner && partner !== r ? [{lane, partner}] : []
    })
    if (overlaps.length !== 1) {return false}
    const {partner, lane: occupiedLane} = overlaps[0]
    const movingFirst = start < partner.position || (start === partner.position && end < partner.complete)
    const previous = links(project)
    const occupiedEdge = previous.some(link => movingFirst ?
        link.b === id(partner) && (copy || link.a !== id(r)) : link.a === id(partner) && (copy || link.b !== id(r)))
    if (occupiedEdge) {return false}
    project.editing.modify(() => {
        const lane = freeAudioLane(project, occupiedLane, start, end, copy ? undefined : r)
        const clip = copy ? copyAssetTo(r, project.boxAdapters.adapterFor(lane, TrackBoxAdapter), start) : r
        if (!copy) {r.box.regions.refer(lane.regions); r.position = start}
        else {project.regionSelection.deselectAll(); project.regionSelection.select(clip)}
        syncCrossfades(project)
        const [a, b] = movingFirst ? [clip, partner] : [partner, clip]
        if (!links(project).some(link => link.a === id(a) && link.b === id(b))) {linkCrossfade(project, a, b)}
    }, true)
    return true
}

/** Keep concurrent signals on separate playback lanes of the same mixer channel. */
export function settleAudioOverlap(project:Project, region:AudioRegionBoxAdapter, target:TrackBoxAdapter) {
    const start=region.position, end=region.resolveComplete(start), owner=displayTrack(target)
    const lanes=playbackLanes(owner)
    const others=lanes.flatMap(lane=>lane.regions.collection.asArray().filter((r):r is AudioRegionBoxAdapter=>
        r instanceof AudioRegionBoxAdapter && r!==region && r.position<end && r.resolveComplete(r.position)>start))
    const lane=region.trackBoxAdapter.unwrap()
    if(others.some(r=>r.trackBoxAdapter.contains(lane))) {
        const free=lanes.find(t=>t.enabled.getValue() && !others.some(other=>other.trackBoxAdapter.contains(t)))
        region.box.regions.refer((free?.box ?? freeAudioLane(project,owner,start,end,region)).regions)
    }
    syncCrossfades(project)
    if(region.mute || !region.trackBoxAdapter.unwrap().enabled.getValue())return
    const linked=crossfades(project)
    const audible=others.filter(r=>!r.mute && r.trackBoxAdapter.unwrap().enabled.getValue())
    for (const other of audible) {
        const [a,b]=other.position<start ? [other,region] : [region,other]
        const out=a.resolveComplete(a.position)
        if(a.position>=b.position || out>=b.resolveComplete(b.position) || out<=b.position) continue
        if(linked.some(pair=>pair.a===a || pair.b===b)) continue
        if(audible.some(third=>third!==other && third.position<out && third.resolveComplete(third.position)>b.position)) continue
        linkCrossfade(project,a,b)
    }
}

// Editing notifications settle after region adapters and the tempo map invalidate cached seconds durations.
// Appending only a necessary correction keeps cuts, deletes and tempo edits in their originating undo step.
export function maintainCrossfades(project: Project) {
    let pending = false, active = true
    const check = () => {
        if (pending) {return}
        pending = true
        queueMicrotask(() => {
            pending = false
            if (!active) {return}
            const dirty = links(project).some(link => {
                const a = regionById(project, link.a), b = regionById(project, link.b)
                if (!a || !b || unitId(a) !== link.aUnit || unitId(b) !== link.bUnit) {return true}
                const duration = length(a, b)
                return duration <= 0 || Math.abs(a.fading.out - duration) >= 1 || Math.abs(b.fading.in - duration) >= 1
            })
            if (dirty) {project.editing.append(() => syncCrossfades(project))}
        })
    }
    const subscription = project.boxGraph.subscribeTransaction({onBeginTransaction() {}, onEndTransaction: check})
    return {terminate() {active = false; subscription.terminate()}}
}
export function cutWithCrossfade<R extends AnyRegionBoxAdapter>(project: Project, region: R, pulse: number, consolidate: boolean) {
    const start = region.position, end = region.complete
    const fade = region instanceof AudioRegionBoxAdapter ? {
        in:region.fading.in, out:region.fading.out, inPower:region.box.fading.inEqualPower.getValue(), outPower:region.box.fading.outEqualPower.getValue()
    } : undefined
    const right = RegionEditing.cut(region, pulse, consolidate)
    right.ifSome(fragment => {
        fragment.box.mute.setValue(region.mute)
        updateTakeMembership(project,UUID.toString(region.uuid),UUID.toString(fragment.uuid))
        if (!fade || !(region instanceof AudioRegionBoxAdapter) || !(fragment instanceof AudioRegionBoxAdapter)) return
        // Keep the outside fades. Cutting a sustained clip should not introduce a new fade at the seam.
        const before = pulse - start, after = end - pulse
        region.fading.inField.setValue(Math.min(fade.in,before))
        region.fading.outField.setValue(Math.max(0,fade.out-after))
        fragment.fading.inField.setValue(Math.max(0,fade.in-before))
        fragment.fading.outField.setValue(Math.min(fade.out,after))
        fragment.box.fading.inEqualPower.setValue(fade.inPower)
        fragment.box.fading.outEqualPower.setValue(fade.outPower)
        const all = links(project), outgoing = all.find(pair => pair.a === id(region)), incoming = all.find(pair => pair.b === id(region))
        if (outgoing) {
            // The outgoing edge belongs to the right-hand fragment after a cut before the transition.
            const b = regionById(project, outgoing.b)
            if (b && pulse <= b.position) {
                outgoing.a = id(fragment)
                region.fading.outField.setValue(0)
                region.box.fading.outEqualPower.setValue(false)
                MetaData.store(project.rootBox, all, origin)
            } else {fragment.fading.outField.setValue(0)}
        }
        if (incoming) {fragment.fading.inField.setValue(0)}
        if (outgoing || incoming) {syncCrossfades(project)}
    })
    return right
}
