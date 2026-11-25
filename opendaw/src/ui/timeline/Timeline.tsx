import css from "./Timeline.sass?inline"
import {Lifecycle} from "@opendaw/lib-std"
import {createElement, Inject} from "@opendaw/lib-jsx"
import {StudioService} from "@/service/StudioService"
import {TracksFooter} from "@/ui/timeline/tracks/footer/TracksFooter.tsx"
import {TimelineHeader} from "@/ui/timeline/TimelineHeader.tsx"
import {TimelineNavigation} from "@/ui/timeline/TimelineNavigation.tsx"
import {PrimaryTracks} from "./tracks/primary/PrimaryTracks"
import {AudioUnitsTimeline} from "./tracks/audio-unit/AudioUnitsTimeline.tsx"
import {ClipsHeader} from "@/ui/timeline/tracks/audio-unit/clips/ClipsHeader.tsx"
import {ppqn} from "@opendaw/lib-dsp"
import {deferNextFrame, Html} from "@opendaw/lib-dom"

import {createComposer} from "@/flowtu/Composer"
import {PanelType} from "@/ui/workspace/PanelType"

import {createFilmTrack} from "@/flowtu/FilmTrack"
import {RulerPreferences} from "./RulerPreferences"

const className = Html.adoptStyleSheet(css, "Timeline")

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
}

export const Timeline = ({lifecycle, service}: Construct) => {
    const {project, timeline} = service
    const {engine} = project
    const {snapping, clips, followCursor, primaryVisibility: {markers, tempo, signature}} = timeline
    const snappingName = Inject.value(snapping.unit.name)
    lifecycle.own(snapping.subscribe(snapping => {snappingName.value = snapping.unit.name}))
    const rulers = new RulerPreferences()
    const timelineHeader = <TimelineHeader lifecycle={lifecycle} service={service} rulers={rulers}/>
    const tracksFooter = <TracksFooter lifecycle={lifecycle} service={service}/>
    const primaryTracks: HTMLElement = <PrimaryTracks lifecycle={lifecycle} service={service}/>
    const audioTracks: HTMLElement = <AudioUnitsTimeline lifecycle={lifecycle} service={service}/>
    const filmTrack=createFilmTrack(service,lifecycle)
    const composer = createComposer(service, lifecycle)
    const element: HTMLElement = (
        <div className={`${className} flowtu-timeline`}>
            {timelineHeader}
            <ClipsHeader lifecycle={lifecycle} service={service}/>
            <TimelineNavigation lifecycle={lifecycle} service={service} rulers={rulers}/>
            {primaryTracks}
            {filmTrack}
            {audioTracks}
            {tracksFooter}
            {composer}
        </div>
    )
    const updateRecordingState = () =>
        element.classList.toggle("recording", engine.isRecording.getValue() || engine.isCountingIn.getValue())
    const {request} = lifecycle.own(deferNextFrame(() =>
        element.classList.toggle("primary-tracks-visible", markers.getValue() || tempo.getValue() || signature.getValue())))
    const updateCursorHeight = () => {
        const cursorHeight = element.clientHeight
            - timelineHeader.clientHeight
            - tracksFooter.clientHeight
            - composer.clientHeight
        element.style.setProperty("--cursor-height", `${cursorHeight - 1}px`)
    }
    // Leave a scrollable track row beneath the conductor when the lower dock is short.
    const limits = service.panelLayout.getByType(PanelType.Timeline).panelState.unwrapOrNull()?.constrains
    const baseMinimum = limits?.type === "flex" ? limits.minSize : 0
    const updateMinimum = () => {
        const host = element.closest<HTMLElement>('[data-panel-type="Timeline"]')
        if (!host || limits?.type !== "flex") {return}
        const top = audioTracks.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop
        const composerHeight = composer.offsetHeight === 0 ? 0 : composer.offsetHeight + parseFloat(getComputedStyle(composer).marginBottom)
        limits.minSize = Math.max(baseMinimum, Math.ceil(top + 100 + tracksFooter.offsetHeight + composerHeight + 3))
        host.style.minHeight = `${limits.minSize}px`
    }
    lifecycle.ownAll(
        Html.watchResize(primaryTracks, updateMinimum),
        Html.watchResize(filmTrack,updateMinimum),
        Html.watchResize(composer, updateMinimum),
        Html.watchResize(timelineHeader, updateMinimum),
        {terminate: () => {if (limits?.type === "flex") {limits.minSize = baseMinimum}}},
        Html.watchResize(element, updateCursorHeight),
        Html.watchResize(timelineHeader, updateCursorHeight),
        engine.isRecording.subscribe(updateRecordingState),
        engine.isCountingIn.subscribe(updateRecordingState),
        followCursor.subscribe(owner => {
            if (owner.getValue()) {
                const range = service.timeline.range
                const position = engine.position.getValue()
                if (position < range.unitMin || position > range.unitMax) {
                    range.moveToUnit(position)
                }
            }
        }),
        engine.position.subscribe((() => {
            let lastPosition: ppqn = 0
            return owner => {
                if (!followCursor.getValue() || service.regionModifierInProgress) {return}
                const range = service.timeline.range
                const position = owner.getValue()
                if (lastPosition <= range.unitMax && position > range.unitMax) {
                    range.moveUnitBy(range.unitMax - range.unitMin)
                } else if (lastPosition >= range.unitMin && position < range.unitMin) {
                    range.moveUnitBy(range.unitMin - range.unitMax)
                }
                lastPosition = position
            }
        })()),
        clips.visible.catchupAndSubscribe(owner => { return element.classList.toggle("clips-visible", owner.getValue()) }),
        clips.count.catchupAndSubscribe(owner => {
            element.style.setProperty("--clips-count", String(owner.getValue()))
            clips.columns.setValue(Math.max(clips.columns.getValue(), owner.getValue()))
        }),
        markers.catchupAndSubscribe(request),
        tempo.catchupAndSubscribe(request),
        signature.catchupAndSubscribe(request)
    )
    return element
}
