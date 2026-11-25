import {isHeaderSelected,watchHeaderSelection} from "@/flowtu/track-selection"
import {DefaultObservableValue, Lifecycle} from "@opendaw/lib-std"
import {StudioService} from "@/service/StudioService.ts"
import {createElement} from "@opendaw/lib-jsx"
import {AudioUnitTrackHeader} from "@/ui/timeline/tracks/audio-unit/headers/AudioUnitTrackHeader.tsx"
import {TrackClassName} from "@/ui/timeline/tracks/audio-unit/TrackStyles.ts"
import {AudioUnitBoxAdapter, TrackBoxAdapter} from "@opendaw/studio-adapters"
import {ClipLane} from "@/ui/timeline/tracks/audio-unit/clips/ClipLane.tsx"
import {RegionLane} from "@/ui/timeline/tracks/audio-unit/regions/RegionLane.tsx"
import {TracksManager} from "@/ui/timeline/tracks/audio-unit/TracksManager.ts"
import {installTrackResize} from "./TrackResize"

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
    trackManager: TracksManager
    audioUnitBoxAdapter: AudioUnitBoxAdapter
    trackBoxAdapter: TrackBoxAdapter
    unitHead: DefaultObservableValue<boolean>
}

export const Track = ({lifecycle, service, trackManager, audioUnitBoxAdapter, trackBoxAdapter, unitHead}: Construct) => {
    const element: HTMLElement = (
        <div className={TrackClassName}>
            <AudioUnitTrackHeader lifecycle={lifecycle}
                         service={service}
                         trackManager={trackManager}
                         audioUnitBoxAdapter={audioUnitBoxAdapter}
                         trackBoxAdapter={trackBoxAdapter}
                         unitHead={unitHead}/>
            <ClipLane lifecycle={lifecycle}
                      service={service}
                      adapter={trackBoxAdapter}
                      trackManager={trackManager}/>
            <RegionLane lifecycle={lifecycle}
                        adapter={trackBoxAdapter}
                        trackManager={trackManager}
                        range={service.timeline.range}/>
        </div>
    )
    const {box: {enabled}} = trackBoxAdapter
    element.setAttribute("role", "group")
    lifecycle.ownAll(
        watchHeaderSelection(service.project, () => {
            const selected = isHeaderSelected(service.project,trackBoxAdapter)
            element.classList.toggle("flowtu-track-focused", selected)
            element.setAttribute("aria-current", String(selected))
        }),
        trackBoxAdapter.catchupAndSubscribePath(path => element.setAttribute("aria-label",
            path.mapOr(parts => parts.filter(Boolean).join(" · "), "Timeline track")))
    )
    lifecycle.own(enabled.catchupAndSubscribe(owner => element.classList.toggle("mute", !owner.getValue())))
    installTrackResize(lifecycle, service, trackManager, trackBoxAdapter, element)
    return element
}
