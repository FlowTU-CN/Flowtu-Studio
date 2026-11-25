import {installControlReset} from "@/ui/hooks/control-reset"
import {Curve, type Lifecycle} from "@opendaw/lib-std"
import type {Project, TimelineRange} from "@opendaw/studio-core"
import {AudioUnitBoxAdapter} from "@opendaw/studio-adapters"
import type {TracksManager} from "@/ui/timeline/tracks/audio-unit/TracksManager"
import {RegionLabel} from "@/ui/timeline/RegionLabel"
import {crossfades, maintainCrossfades, crossfadeCurveMode, curveProgress, setCrossfadeCurveMode, type Crossfade} from "./crossfades"
import {editingTool} from "./editing-state"
import "./crossfade-zones.css"

const namespace = "http://www.w3.org/2000/svg"
export function plot(inSlope: number, outSlope: number, power: boolean) {
    const svg = document.createElementNS(namespace, "svg")
    svg.setAttribute("viewBox", "0 0 100 100")
    svg.setAttribute("preserveAspectRatio", "none")
    svg.setAttribute("aria-hidden", "true")
    for (const incoming of [false, true]) {
        const line = document.createElementNS(namespace, "polyline")
        line.setAttribute("points", Array.from({length: 49}, (_, i) => {
            const x = i / 48, v = curveProgress(x, incoming ? inSlope : outSlope, incoming, power)
            return `${x * 100},${2 + 96 * (incoming ? 1 - v : v)}`
        }).join(" "))
        line.setAttribute("class", incoming ? "incoming" : "outgoing")
        svg.append(line)
    }
    return svg
}
function frozen(project: Project, pair: Crossfade) {
    return [pair.a, pair.b].some(r => r.trackBoxAdapter.flatMap(t => t.optAudioUnit)
        .mapOr(unit => project.audioUnitFreeze.isFrozen(project.boxAdapters.adapterFor(unit, AudioUnitBoxAdapter)), true))
}
export function editCurves(project: Project, {a, b}: Crossfade) {
    const dialog = document.createElement("dialog")
    dialog.className = "ft-crossfade-editor"
    dialog.setAttribute("aria-label", "Crossfade curves")
    dialog.innerHTML = `<form method="dialog"><header><strong>Crossfade</strong><output></output></header>
        <div class="plot"></div><label>Fade out<input name="outgoing" type="range" min="1" max="99"></label>
        <label>Fade in<input name="incoming" type="range" min="1" max="99"></label>
        <footer><button type="button" data-law="linear">Linear</button><button type="button" data-law="constant-power">Constant power</button><button type="submit">Done</button></footer></form>`
    const form = dialog.querySelector("form")!
    const outgoing = form.elements.namedItem("outgoing") as HTMLInputElement
    const incoming = form.elements.namedItem("incoming") as HTMLInputElement
    const graph = dialog.querySelector<HTMLElement>(".plot")!
    const handles = [false, true].map(isIn => {
        const handle = document.createElement("span")
        handle.className = "ft-crossfade-handle " + (isIn ? "incoming" : "outgoing")
        handle.title = isIn ? "Drag fade in curve" : "Drag fade out curve"
        const x = isIn ? .65 : .35
        handle.style.left = `${x * 100}%`
        return {handle, isIn, x}
    })
    const redraw = () => {
        const law = crossfadeCurveMode(project, {a, b})
        const power = law === "constant-power"
        form.querySelectorAll<HTMLButtonElement>("[data-law]").forEach(btn => btn.setAttribute("aria-pressed", String(btn.dataset.law === law)))
        incoming.value = String(Math.round(curveProgress(.5, b.fading.inSlope, true, power) * 100))
        outgoing.value = String(Math.round((1 - curveProgress(.5, a.fading.outSlope, false, power)) * 100))
        graph.replaceChildren(plot(b.fading.inSlope, a.fading.outSlope, power))
        for (const {handle, x, isIn} of handles) {
            const v = curveProgress(x, isIn ? b.fading.inSlope : a.fading.outSlope, isIn, power)
            handle.style.top = `${2 + 96 * (isIn ? 1 - v : v)}%`
            graph.append(handle)
        }
    }
    const change = (inSlope: number, outSlope: number, mark: boolean) => {
        if (!a.trackBoxAdapter.nonEmpty() || !b.trackBoxAdapter.nonEmpty() || frozen(project, {a, b})) {dialog.close(); return}
        project.editing.modify(() => {
            setCrossfadeCurveMode(project, {a, b}, "custom")
            a.fading.outSlopeField.setValue(outSlope)
            b.fading.inSlopeField.setValue(inSlope)
        }, mark)
        redraw()
    }
    const resetTarget = (isIn: boolean) => {
        const power = crossfadeCurveMode(project, {a, b}) === "constant-power"
        change(isIn ? .5 : curveProgress(.5, b.fading.inSlope, true, power),
            isIn ? curveProgress(.5, a.fading.outSlope, false, power) : .5, true)
    }
    const resets = [
        installControlReset(incoming, () => resetTarget(true)),
        installControlReset(outgoing, () => resetTarget(false)),
        ...handles.map(({handle, isIn}) => installControlReset(handle, () => resetTarget(isIn)))
    ]
    let drag: {pointer: number, x: number, isIn: boolean, before: [number, number], law: ReturnType<typeof crossfadeCurveMode>} | undefined
    graph.onpointerdown = e => {
        if (e.button !== 0 || drag) {return}
        const target = handles.find(h => e.target === h.handle)
        if (!target) {return}
        e.preventDefault()
        drag = {pointer: e.pointerId, x: target.x, isIn: target.isIn, before: [incoming.valueAsNumber / 100, 1 - outgoing.valueAsNumber / 100], law: crossfadeCurveMode(project, {a, b})}
        graph.setPointerCapture(e.pointerId)
    }
    graph.onpointermove = e => {
        if (!drag || drag.pointer !== e.pointerId) {return}
        const bounds = graph.getBoundingClientRect()
        const y = ((e.clientY - bounds.top) / bounds.height - .02) / .96
        const gain = drag.isIn ? 1 - y : y
        // The pointer fixes gain at this handle's time. Solve the engine's monotonic curve for its slope.
        let lo = .01, hi = .99
        for (let i = 0; i < 16; i++) {
            const mid = (lo + hi) / 2
            if (Curve.normalizedAt(drag.x, mid) < gain) {lo = mid} else {hi = mid}
        }
        const slope = (lo + hi) / 2
        change(drag.isIn ? slope : drag.before[0], drag.isIn ? drag.before[1] : slope, false)
    }
    graph.onpointerup = e => {
        if (drag?.pointer === e.pointerId) {drag = undefined; project.editing.mark()}
    }
    graph.onlostpointercapture = () => {
        if (drag) {
            const {before: [i, o], law} = drag
            drag = undefined
            change(i, o, false)
            project.editing.modify(() => setCrossfadeCurveMode(project, {a, b}, law))
            redraw()
        }
    }
    for (const slider of [outgoing, incoming]) {
        slider.oninput = () => change(incoming.valueAsNumber / 100, 1 - outgoing.valueAsNumber / 100, false)
        slider.onchange = () => project.editing.mark()
    }
    for (const law of ["linear", "constant-power"] as const) {
        form.querySelector<HTMLButtonElement>(`[data-law="${law}"]`)!.onclick = () => {
            project.editing.modify(() => setCrossfadeCurveMode(project, {a, b}, law))
            redraw()
        }
    }
    dialog.querySelector("output")!.value = `${Math.round(1000 * (project.tempoMap.ppqnToSeconds(a.complete) -
        project.tempoMap.ppqnToSeconds(b.position)))} ms`
    dialog.onclose = () => {
        resets.forEach(reset => reset.terminate())
        project.editing.mark()
        dialog.remove()
    }
    document.body.append(dialog)
    redraw()
    dialog.showModal()
}
export function installCrossfadeZones(host: HTMLElement, manager: TracksManager, range: TimelineRange, lifecycle: Lifecycle) {
    const {project} = manager.service
    const layer = document.createElement("div")
    layer.className = "ft-crossfade-zones"
    host.append(layer)
    let frame = 0
    const render = () => {
        frame = 0
        layer.replaceChildren()
        const pairs = crossfades(project)
        if (!pairs.length) {return}
        const tracks = manager.tracks(), scroll = manager.scrollableContainer.scrollTop
        for (const pair of pairs) {
            const {a, b} = pair
            if (b.position >= range.unitMax || a.complete <= range.unitMin - range.unitPadding) {continue}
            const x = range.unitToX(b.position), width = range.unitToX(a.complete) - x
            const rows = new Set([a, b].flatMap(r => r.trackBoxAdapter.mapOr(t => [manager.displayTrack(t)], [])))
            const power = crossfadeCurveMode(project, pair) === "constant-power"
            for (const row of rows) {
                const track = tracks.find(t => t.trackBoxAdapter === row)
                if (!track) {continue}
                const top = track.position - scroll + RegionLabel.labelHeight()
                const zone = document.createElement("button")
                zone.type = "button"
                zone.className = "ft-crossfade-zone"
                zone.title = zone.ariaLabel = `Edit crossfade · ${a.label} → ${b.label}`
                zone.disabled = frozen(project, pair)
                zone.style.left = `${x}px`
                zone.style.top = `${top}px`
                zone.style.width = `${Math.max(1, width)}px`
                zone.style.height = `${Math.max(1, track.size - RegionLabel.labelHeight() - 1)}px`
                zone.append(plot(b.fading.inSlope, a.fading.outSlope, power))
                zone.onclick = e => {e.stopPropagation(); editCurves(project, pair)}
                layer.append(zone)
            }
        }
    }
    const request = () => {if (!frame) {frame = requestAnimationFrame(render)}}
    const blockWaveformGesture = (e: Event) => {
        if ((e.target as Element).closest(".ft-crossfade-zone")) {e.stopImmediatePropagation()}
    }
    host.addEventListener("pointerdown", blockWaveformGesture, true)
    manager.scrollableContainer.addEventListener("scroll", request)
    const resize = new ResizeObserver(request)
    resize.observe(host)
    lifecycle.ownAll(maintainCrossfades(project), range.subscribe(request), project.boxGraph.subscribeTransaction({onBeginTransaction() {}, onEndTransaction: request}),
        editingTool.catchupAndSubscribe(tool => {layer.dataset.interactive = String(["select", "fade"].includes(tool.getValue()))}),
        {terminate: () => {
            cancelAnimationFrame(frame)
            host.removeEventListener("pointerdown", blockWaveformGesture, true)
            manager.scrollableContainer.removeEventListener("scroll", request)
            resize.disconnect()
            layer.remove()
        }})
    request()
}
