import {editingTool} from "@/flowtu/editing-state"
import {trackColors} from "@/flowtu/track-color"
import {subscribeTimelineSelection} from "@/flowtu/timeline-selection"
import {Html} from "@opendaw/lib-dom"
import {Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {RegionRenderer} from "@/ui/timeline/tracks/audio-unit/regions/RegionRenderer.ts"
import {TrackBoxAdapter, TrackType} from "@opendaw/studio-adapters"
import {TracksManager} from "@/ui/timeline/tracks/audio-unit/TracksManager.ts"
import {CanvasPainter, TimelineRange} from "@opendaw/studio-core"
import {RegionLaneClassName} from "@/ui/timeline/tracks/audio-unit/TrackStyles.ts"

const className = RegionLaneClassName

type Construct = {
    lifecycle: Lifecycle
    trackManager: TracksManager
    range: TimelineRange
    adapter: TrackBoxAdapter
}

export const RegionLane = ({lifecycle, trackManager, range, adapter}: Construct) => {
    let visible = false
    const canvas: HTMLCanvasElement = <canvas/>
    const element: Element = (<div className={className}>{canvas}</div>)
    const painter = lifecycle.own(new CanvasPainter(canvas, ({context}) => {
        if (visible) {
            RegionRenderer.render(context, trackManager, range, adapter.listIndex)
        }
    }))
    const requestUpdate = painter.requestUpdate
    if (adapter.type === TrackType.Value) lifecycle.own(subscribeTimelineSelection(trackManager.service.project, requestUpdate))
    const {timelineFocus} = trackManager.service.project
    lifecycle.ownAll(
        trackColors(trackManager.service.project).subscribe(requestUpdate),
        range.subscribe(requestUpdate),
        editingTool.subscribe(requestUpdate),
        adapter.regions.subscribeChanges(requestUpdate),
        adapter.enabled.subscribe(requestUpdate),
        trackManager.service.project.timelineBoxAdapter.signatureTrack.subscribe(requestUpdate),
        timelineFocus.track.catchupAndSubscribe(owner =>
            element.classList.toggle("focused", owner.mapOr(t => trackManager.displayTrack(t) === adapter, false))),
        Html.watchIntersection(element, entries => entries
                .forEach(({isIntersecting}) => {
                    visible = isIntersecting
                    // A hidden lane's canvas can lose its backing pixels when its folder collapses.
                    if (visible) {requestUpdate()}
                }),
            {root: trackManager.scrollableContainer})
    )
    return element
}
