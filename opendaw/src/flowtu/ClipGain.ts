import {deferNextFrame, Events, Html} from "@opendaw/lib-dom"
import {type Lifecycle} from "@opendaw/lib-std"
import {AudioRegionBoxAdapter, TrackType} from "@opendaw/studio-adapters"
import type {Project, TimelineRange} from "@opendaw/studio-core"
import type {TracksManager} from "@/ui/timeline/tracks/audio-unit/TracksManager"
import {installControlReset, resetHint} from "@/ui/hooks/control-reset"
import "./clip-gain.css"

const minDb = -60, maxDb = 12
export function setClipGain(project: Project, region: AudioRegionBoxAdapter, value: number, mark = true) {
    if (!Number.isFinite(value) || !region.box.isAttached()) {return}
    const gain = Math.max(minDb, Math.min(maxDb, Math.round(value * 10) / 10))
    project.editing.modify(() => region.gain.setValue(gain), mark)
}

export function gainFader(project: Project, region: AudioRegionBoxAdapter, owner: Lifecycle, focus: () => void) {
    const life = owner.spawn()
    const control = document.createElement("button")
    control.type = "button"
    control.className = "ft-clip-gain"
    control.setAttribute("role", "slider")
    control.setAttribute("aria-orientation", "vertical")
    control.setAttribute("aria-valuemin", String(minDb))
    control.setAttribute("aria-valuemax", String(maxDb))
    control.innerHTML = '<i aria-hidden="true"></i><span></span>'
    const output = control.querySelector("span")!
    const update = () => {
        const db = region.gain.getValue()
        const label = (db > 0 ? "+" : "") + db.toFixed(1) + " dB"
        output.textContent = label
        control.setAttribute("aria-valuenow", db.toFixed(1))
        control.setAttribute("aria-valuetext", label)
        control.style.setProperty("--gain-y", (90 - (db - minDb) / (maxDb - minDb) * 80) + "%")
        control.title = "Clip Gain · " + label + " · Drag up or down · Shift for fine adjustment · " + resetHint
    }
    let drag: {id: number, y: number, original: number, gain: number} | undefined
    const finish = (cancel: boolean) => {
        if (!drag) {return}
        const {id, original} = drag
        drag = undefined
        if (cancel) {setClipGain(project, region, original, false)}
        project.editing.mark()
        if (control.hasPointerCapture(id)) {control.releasePointerCapture(id)}
        control.classList.remove("dragging")
    }
    control.onpointerdown = event => {
        if (event.button !== 0 || drag || control.disabled) {return}
        event.preventDefault()
        control.focus({preventScroll: true})
        focus()
        project.regionSelection.deselectAll()
        project.regionSelection.select(region)
        project.editing.mark()
        drag = {id: event.pointerId, y: event.clientY, original: region.gain.getValue(), gain: region.gain.getValue()}
        control.classList.add("dragging")
        control.setPointerCapture(event.pointerId)
    }
    control.onpointermove = event => {
        if (!drag || drag.id !== event.pointerId) {return}
        const delta = (drag.y - event.clientY) * (event.shiftKey ? .025 : .2)
        drag.gain = Math.max(minDb, Math.min(maxDb, drag.gain + delta))
        drag.y = event.clientY
        setClipGain(project, region, drag.gain, false)
    }
    control.onpointerup = e => {if (e.pointerId === drag?.id) {finish(false)}}
    control.onlostpointercapture = () => finish(true)
    control.onkeydown = event => {
        if (event.key === "Escape" && drag) {event.preventDefault(); event.stopPropagation(); finish(true); return}
        const sign = ["ArrowUp", "ArrowRight"].includes(event.key) ? 1 : ["ArrowDown", "ArrowLeft"].includes(event.key) ? -1 : 0
        if (!sign) {return}
        event.preventDefault()
        event.stopPropagation()
        setClipGain(project, region, region.gain.getValue() + sign * (event.shiftKey ? 1 : .1))
    }
    life.ownAll(region.gain.catchupAndSubscribe(update),
        installControlReset(control, () => {if (!control.disabled) {finish(false); setClipGain(project, region, 0)}}),
        {terminate: () => {finish(true); control.remove()}})
    return {control, life}
}

export function createClipGainLayer(manager: TracksManager, range: TimelineRange, lifecycle: Lifecycle) {
    const {project} = manager.service, scroller = manager.scrollableContainer
    const layer = document.createElement("div")
    layer.className = "ft-clip-gain-layer"
    const faders = new Map<AudioRegionBoxAdapter, ReturnType<typeof gainFader>>()
    const layout = () => {
        const visible = new Set<AudioRegionBoxAdapter>()
        for (const track of manager.tracks()) {
            const top = track.position - scroller.scrollTop
            if (track.trackBoxAdapter.type !== TrackType.Audio || top + track.size <= 0 || top >= layer.clientHeight) {continue}
            const frozen = track.audioUnitBoxAdapter.mapOr(unit => project.audioUnitFreeze.isFrozen(unit), false)
            const rendered: {x: number, y: number, width: number}[] = []
            for (const lane of manager.playbackLanes(track.trackBoxAdapter)) {
                for (const region of lane.regions.collection.iterateRange(range.xToUnit(0), range.xToUnit(layer.clientWidth))) {
                    if (region.position > range.unitMax + range.unitPadding) {break}
                    if (!(region instanceof AudioRegionBoxAdapter)) {continue}
                    const left = Math.max(0, range.unitToX(region.position)), right = Math.min(layer.clientWidth, range.unitToX(region.complete))
                    // Keep both trim edges and the move/selection gestures reachable at small zoom levels.
                    const width = Math.min(52, right - left - 16)
                    const x = Math.round(right - 8 - width)
                    if (width < 12 || x >= layer.clientWidth) {continue}
                    visible.add(region)
                    let record = faders.get(region)
                    if (!record) {
                        record = gainFader(project, region, lifecycle, () =>
                            region.trackBoxAdapter.ifSome(actual => project.timelineFocus.focusTrack(manager.displayTrack(actual))))
                        layer.append(record.control); faders.set(region, record)
                    }
                    let y = Math.round(top + track.size - 23)
                    if (rendered.some(other => x < other.x + other.width && x + width > other.x && Math.abs(y - other.y) < 18)) {
                        y -= 17
                    }
                    rendered.push({x, y, width})
                    const c = record.control
                    c.disabled = frozen
                    c.setAttribute("aria-label", "Clip gain · " + region.label)
                    c.style.left = x + "px"
                    c.style.top = y + "px"
                    c.style.width = width + "px"
                    c.classList.toggle("compact", width < 48)
                }
            }
        }
        for (const [region, {life}] of faders) {
            if (!visible.has(region)) {life.terminate(); faders.delete(region)}
        }
    }
    const {request} = lifecycle.own(deferNextFrame(layout))
    lifecycle.ownAll(Html.watchResize(layer, request), range.subscribe(request), Events.subscribe(scroller, "scroll", request),
        project.boxGraph.subscribeTransaction({onBeginTransaction() {}, onEndTransaction: request}))
    return layer
}
