import {seekTimeline, timelinePosition} from '@/flowtu/timeline-seek'
import {Browser} from "@opendaw/lib-dom"
import type {Lifecycle} from "@opendaw/lib-std"
import type {StudioService} from "@/service/StudioService"
import {locatorSnap} from "./AudioClipSnap"
import {setWorkArea} from "@/flowtu/work-area"
import {clearAudioRange, finishTimelineRangeGesture, getTimelineSelection, rememberTimelineSelection, setTimelineSelection, subscribeTimelineSelection} from "@/flowtu/timeline-selection"

/** A ruler click locates using its own units. A drag uses the same edit grid as the waveform. */
export function installRulerGesture(element: HTMLElement, service: StudioService, lifecycle: Lifecycle, locate: (pulse: number) => void) {
    const {project, timeline: {range, snapping}} = service
    let cancel: (() => void) | undefined
    const down = (event: PointerEvent) => {
        if (event.button !== 0 || !event.isPrimary || (Browser.isMacOS() && event.ctrlKey) || event.defaultPrevented ||
            (event.target instanceof Element && event.target.closest("[data-component=end-marker]"))) {return}
        cancel?.()
        const raw = (clientX: number) => Math.max(0, range.xToUnit(clientX - element.getBoundingClientRect().left))
        const snap = locatorSnap(project, snapping)
        const originX = event.clientX, origin = raw(originX), anchor = snap(origin, event.shiftKey)
        const restore = rememberTimelineSelection(project)
        const events = new AbortController(), options = {signal: events.signal}
        const pointer = event.pointerId
        const position = timelinePosition(project), playing = project.engine.isPlaying.getValue()
        let dragged = false
        element.setPointerCapture(pointer)
        element.focus({preventScroll: true})
        event.preventDefault()
        if (!playing) {locate(origin)}
        const finish = () => {
            snapping.guide.setValue(null)
            events.abort()
            cancel = undefined
            if (element.hasPointerCapture(pointer)) {element.releasePointerCapture(pointer)}
        }
        cancel = () => {
            finish()
            if (dragged) {restore()}
            if (!playing && !project.engine.isPlaying.getValue()) {seekTimeline(project, position)}
        }
        const update = (next: PointerEvent) => {
            if (next.pointerId !== pointer || (!dragged && Math.abs(next.clientX - originX) < 3)) {return}
            dragged = true
            const pulse = raw(next.clientX), edge = snap(pulse, next.shiftKey)
            if (next.type === "pointermove") {
                if (pulse < range.unitMin) {range.moveToUnit(pulse)}
                else if (pulse > range.unitMax) {range.moveToUnit(pulse - range.unitRange)}
            }
            if (edge === anchor) {clearAudioRange(project); return}
            setTimelineSelection(project, {start: Math.min(anchor, edge), end: Math.max(anchor, edge)})
        }
        const up = (next: PointerEvent) => {
            if (next.pointerId !== pointer) {return}
            update(next)
            finish()
            const selection = dragged && getTimelineSelection(project)
            if (!selection) {
                clearAudioRange(project)
                if (playing) {locate(origin)}
            }
            else {
                setWorkArea(project, selection)
                finishTimelineRangeGesture(project)
                if (!project.engine.isPlaying.getValue()) {seekTimeline(project, selection.start)}
            }
        }
        element.addEventListener("pointermove", update, options)
        element.addEventListener("pointerup", up, options)
        for (const type of ["pointercancel", "lostpointercapture"] as const) {
            element.addEventListener(type, next => {if (next.pointerId === pointer) {cancel?.()}}, options)
        }
        window.addEventListener("blur", cancel, options)
        window.addEventListener("keydown", e => {
            if (e.key === "Escape") {e.preventDefault(); e.stopPropagation(); cancel?.()}
        }, {...options, capture: true})
    }
    element.addEventListener("pointerdown", down)
    lifecycle.own({terminate: () => {cancel?.(); element.removeEventListener("pointerdown", down)}})
}

/** One set of coordinates drives all visible time and musical rulers, including after a zoom. */
export function displayRulerSelection(navigation: HTMLElement, service: StudioService, lifecycle: Lifecycle) {
    const {project, timeline: {range}} = service
    const paint = () => {
        const selection = getTimelineSelection(project)
        const left = selection ? Math.max(0, range.unitToX(selection.start)) : 0
        const right = selection ? Math.min(range.width, range.unitToX(selection.end)) : 0
        navigation.toggleAttribute("data-time-selection", right > left)
        if (right > left) {
            navigation.style.setProperty("--selection-left", left + "px")
            navigation.style.setProperty("--selection-width", (right - left) + "px")
        }
    }
    lifecycle.ownAll(subscribeTimelineSelection(project, paint), range.subscribe(paint))
    paint()
}
