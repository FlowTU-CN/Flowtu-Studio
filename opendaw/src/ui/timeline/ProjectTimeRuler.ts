import {seekTimeline, timelinePosition} from '@/flowtu/timeline-seek'
import {deferNextFrame, Events, Html} from "@opendaw/lib-dom"
import {Lifecycle} from "@opendaw/lib-std"
import type {StudioService} from "@/service/StudioService"
import {formatTimelineTime, getFrameRate} from "@/flowtu/time-format"
import {subscribeTimeSettings, timeSettings} from "@/flowtu/time-settings"
import {installRulerGesture} from "./RulerSelection"
import {WheelScaling} from "./WheelScaling"
import {rulerNames, type ClockRulerId, type RulerPreferences} from "./RulerPreferences"

function niceStep(target: number): number {
    const power = 10 ** Math.floor(Math.log10(Math.max(1, target)))
    return ([1, 2, 5, 10].find(n => n * power >= target) ?? 10) * power
}

export function createProjectTimeRuler(service: StudioService, lifecycle: Lifecycle, id: ClockRulerId, prefs: RulerPreferences) {
    const {range} = service.timeline
    const {tempoMap, engine} = service.project
    const ruler = document.createElement("div"), ticks = document.createElement("div")
    ruler.className = "project-time-ruler"
    ruler.dataset.ruler = id
    ruler.tabIndex = 0
    ruler.setAttribute("role", "group")
    ruler.setAttribute("aria-label", id === "seconds" ? "Project time ruler" : rulerNames[id] + " ruler")
    ruler.title = "Click to locate. Drag to select a time range. Use the arrow keys to step."
    ruler.append(ticks)
    const frameBased = id === "user" || id === "timecode"
    const rate = () => getFrameRate(id === "user" ? prefs.userRate : timeSettings.fps)
    const unitsPerSecond = () => frameBased ? rate().numerator / rate().denominator : id === "seconds" ? 1000 : service.audioContext.sampleRate
    const clock = document.createElement("output")
    clock.className = "ruler-clock"
    clock.setAttribute("role", "timer")
    clock.setAttribute("aria-live", "off")
    clock.setAttribute("aria-label", id === "seconds" ? "Timeline playhead time" : rulerNames[id] + " playhead")
    ruler.append(clock)
    let width = 0, clockWidth = 0, frameDivisions = 1
    const timecode = (units: number, divisions: number) => {
        const whole = Math.floor(units / divisions)
        const code = formatTimelineTime(whole / unitsPerSecond(), "timecode", rate())
        return divisions === 1 ? code : code + "." + String(units % divisions).padStart(divisions === 10 ? 1 : 2, "0")
    }
    const updateClock = () => {
        if (!prefs.visible[id] || !width) {return}
        const pulse = timelinePosition(service.project)
        const seconds = tempoMap.ppqnToSeconds(pulse)
        const text = id === "samples" ? String(Math.round(seconds * unitsPerSecond()))
            : frameBased ? timecode(Math.round(seconds * unitsPerSecond() * frameDivisions), frameDivisions)
            : formatTimelineTime(seconds, timeSettings.display, rate())
        if (clock.textContent !== text) {
            const sizeChanged = clock.textContent?.length !== text.length
            clock.textContent = text
            if (sizeChanged) {clockWidth = clock.offsetWidth}
        }
        const playheadX = range.unitToX(pulse)
        clock.style.visibility = playheadX < 0 || playheadX >= width ? "hidden" : "visible"
        const x = Math.max(0, Math.min(playheadX, width - clockWidth))
        clock.style.transform = `translateX(${x}px)`
    }
    const draw = () => {
        width = ruler.clientWidth
        if (!width || !range.width) {return}
        // Keeping the scale in integer subframes avoids drifting tick labels at fractional video rates.
        const scale = unitsPerSecond() * (frameBased ? 100 : 1)
        const start = Math.max(0, tempoMap.ppqnToSeconds(range.unitMin) * scale)
        const end = tempoMap.ppqnToSeconds(range.unitMax) * scale
        const spacing = frameBased ? 100 : 57
        const target = Math.max(1, (end - start) * spacing / width)
        const base = frameBased ? rate().nominal * 100 : scale
        let step = niceStep(target)
        if (id !== "samples" && target >= base) {
            step = base * ([1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
                .find(n => n * base >= target) ?? niceStep(target / base))
        } else if (frameBased && target >= 100) {
            step = Math.min(base, 100 * niceStep(target / 100))
        }
        frameDivisions = !frameBased || step >= 100 ? 1 : step >= 10 ? 10 : 100
        updateClock()
        clockWidth = clock.offsetWidth
        const minorStep = step % 5 === 0 ? step / 5 : step % 2 === 0 ? step / 2 : step
        const decimals = Math.max(0, 3 - Math.floor(Math.log10(step)))
        const tickText = (unit: number) => {
            if (id === "samples") {return String(unit)}
            if (id === "seconds") {return (unit / scale).toFixed(decimals)}
            return timecode(unit * frameDivisions / 100, frameDivisions)
        }
        const fragment = document.createDocumentFragment()
        let lastMajor = -Infinity, lastTick = -Infinity
        for (let i = Math.ceil(start / minorStep); i * minorStep <= end; i++) {
            const unit = i * minorStep, seconds = unit / scale
            const x = range.unitToX(tempoMap.secondsToPPQN(seconds))
            const major = unit % step === 0
            if (major ? x - lastMajor < spacing - 7 : x - lastTick < 5) {continue}
            const tick = document.createElement("span")
            tick.className = major ? "ruler-tick" : "ruler-minor"
            tick.style.left = `${x}px`
            if (major) {
                tick.textContent = tickText(unit)
                lastMajor = x
            }
            lastTick = x
            fragment.append(tick)
        }
        ticks.replaceChildren(fragment)
    }
    const {request} = lifecycle.own(deferNextFrame(draw))
    const seek = (seconds: number, direction = 0, scale = unitsPerSecond() * frameDivisions) => {
        const target = Math.max(0, Math.round(seconds * scale) / scale)
        let pulse = Math.round(tempoMap.secondsToPPQN(target))
        if (direction && pulse === timelinePosition(service.project)) {pulse = Math.max(0, pulse + direction)}
        if (service.audioContext.state === "suspended") {void service.audioContext.resume().catch(() => {})}
        seekTimeline(service.project, pulse)
    }
    lifecycle.ownAll(
        Html.watchResize(ruler, request), range.subscribe(request), tempoMap.subscribe(request),
        engine.position.subscribe(updateClock), {terminate: subscribeTimeSettings(request)}, prefs.watch(request),
        WheelScaling.install(ruler, range),
        Events.subscribe(ruler, "blur", () => {delete ruler.dataset.keyStep}),
        Events.subscribe(ruler, "keydown", event => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {return}
            event.preventDefault()
            event.stopPropagation()
            ruler.dataset.keyStep = ""
            const direction = event.key === "ArrowLeft" ? -1 : 1
            const step = id === "seconds" && timeSettings.display !== "time" ? rate().denominator / rate().numerator : 1 / (unitsPerSecond() * frameDivisions)
            seek(tempoMap.ppqnToSeconds(timelinePosition(service.project)) + direction * step, direction, 1 / step)
        })
    )
    installRulerGesture(ruler, service, lifecycle, pulse => {
        delete ruler.dataset.keyStep
        seek(tempoMap.ppqnToSeconds(pulse))
    })
    return ruler
}
