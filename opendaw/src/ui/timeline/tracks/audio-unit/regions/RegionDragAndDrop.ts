import {snapDroppedClip} from "@/ui/timeline/AudioClipSnap"
import {takeRegion} from "@/flowtu/scoring-model"
import {isAssetLane, displayTrack, playbackLanes} from "@/flowtu/playback-lanes"
import {overlapPartner, freeAudioLane, linkCrossfade} from "@/flowtu/crossfades"
import {placeAssetParts} from "@/flowtu/scoring-assets"
import {AudioRegionBoxAdapter, AudioUnitBoxAdapter, TrackBoxAdapter} from "@opendaw/studio-adapters"
import {RegionCaptureTarget} from "@/ui/timeline/tracks/audio-unit/regions/RegionCapturing.ts"
import {AudioContentFactory, ElementCapturing} from "@opendaw/studio-core"
import {CreateParameters, TimelineDragAndDrop} from "@/ui/timeline/tracks/audio-unit/TimelineDragAndDrop"
import {Snapping} from "@/ui/timeline/Snapping"
import {StudioService} from "@/service/StudioService"
import type {DragProjectAsset} from "@/ui/AnyDragData"
import {TimeBase} from "@opendaw/lib-dsp"
import {TransientPlayMode} from "@opendaw/studio-enums"

export class RegionDragAndDrop extends TimelineDragAndDrop<RegionCaptureTarget> {
    readonly #snapping: Snapping

    constructor(service: StudioService, capturing: ElementCapturing<RegionCaptureTarget>, snapping: Snapping) {
        super(service, capturing)

        this.#snapping = snapping
    }

    assetDrop(event: DragEvent, data: DragProjectAsset, commit = false): number | undefined {
        const project = this.project
        if (data.project !== project) return
        const region = takeRegion(project,data.id), hit = this.capturing.captureEvent(event)
        if (!region || !hit) return
        const raw = hit.type === 'track' ? hit.track.trackBoxAdapter : hit.region.trackBoxAdapter.unwrapOrNull()
        if (!raw || raw.type !== region.trackBoxAdapter.unwrap().type || isAssetLane(raw)) return
        const target = displayTrack(raw)
        if (project.audioUnitFreeze.isFrozen(project.boxAdapters.adapterFor(target.audioUnit, AudioUnitBoxAdapter))) return
        const x = event.clientX - this.capturing.element.getBoundingClientRect().left
        const map = project.tempoMap
        const start = region instanceof AudioRegionBoxAdapter
            ? snapDroppedClip(project,this.#snapping,x,event.shiftKey,{
                endAt: value => region.resolveComplete(value),
                startAt: end => region.timeBase===TimeBase.Seconds
                    ? map.secondsToPPQN(map.ppqnToSeconds(end)-region.box.duration.getValue()) : end-region.duration
            })
            : Math.max(0,event.shiftKey ? Math.round(this.#snapping.range.xToUnit(x)) : this.#snapping.xToUnitRound(x))
        if (commit && !placeAssetParts(project,data.parts ?? [data.id],target,start)) return
        return start
    }

    handleSample({event, trackBoxAdapter, audioFileBox, sample, type}: CreateParameters): void {
        const pointerX = event.clientX - this.capturing.element.getBoundingClientRect().left
        const {tempoMap} = this.project
        const secondsBased = type === "file" || sample.bpm === 0
        const duration = secondsBased ? sample.duration : AudioContentFactory.calculateDuration(sample, tempoMap, 0)
        const tail = {
            endAt: (start: number) => secondsBased
                ? tempoMap.secondsToPPQN(tempoMap.ppqnToSeconds(start) + duration) : start + duration,
            startAt: (end: number) => secondsBased
                ? tempoMap.secondsToPPQN(tempoMap.ppqnToSeconds(end) - duration) : end - duration
        }
        const pointerPulse = snapDroppedClip(this.project, this.#snapping, pointerX, event.shiftKey, tail)
        const boxGraph = this.project.boxGraph
        // Calculate duration to determine target track and handle overlaps. The tempo map keeps the
        // clip mask identical to the extent the created seconds-region will actually occupy.
        const complete = tail.endAt(pointerPulse)
        // Resolve target track (handles keep-existing by finding non-overlapping track)
        const candidates = playbackLanes(trackBoxAdapter).flatMap(lane => {
            const other = overlapPartner(lane, pointerPulse, complete)
            return other ? [{lane, other}] : []
        })
        const partner = candidates.length === 1 ? candidates[0] : null
        const targetTrack = partner ? this.project.boxAdapters.adapterFor(
            freeAudioLane(this.project, partner.lane, pointerPulse, complete), TrackBoxAdapter)
            : this.project.overlapResolver.resolveTargetTrack(trackBoxAdapter, pointerPulse, complete)
        // Capture overlap state before creating (handles clip/push-existing)
        const solver = this.project.overlapResolver.fromRange(targetTrack, pointerPulse, complete)
        // Create region on target track
        const box = type === "file" || sample.bpm === 0
            ? AudioContentFactory.createNotStretchedRegion({
                boxGraph,
                targetTrack: targetTrack.box,
                audioFileBox,
                sample,
                position: pointerPulse
            })
            : AudioContentFactory.createTimeStretchedRegion({
                boxGraph,
                targetTrack: targetTrack.box,
                audioFileBox,
                sample,
                position: pointerPulse,
                playbackRate: 1.0,
                transientPlayMode: TransientPlayMode.Pingpong
            })
        // Apply overlap resolution
        solver()
        if (partner) {
            const clip = this.project.boxAdapters.adapterFor(box, AudioRegionBoxAdapter)
            const [a, b] = pointerPulse < partner.other.position ? [clip, partner.other] : [partner.other, clip]
            if (a.complete > b.position && a.complete <= b.complete) {linkCrossfade(this.project, a, b)}
        }
    }
}
