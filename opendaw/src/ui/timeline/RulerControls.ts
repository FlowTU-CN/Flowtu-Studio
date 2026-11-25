import {tr, watchStudioLanguage} from "@/flowtu/studio-language"
import {type Lifecycle} from "@opendaw/lib-std"
import type {StudioService} from "@/service/StudioService"
import {FRAME_RATES, getFrameRate} from "@/flowtu/time-format"
import {timeSettings, subscribeTimeSettings} from "@/flowtu/time-settings"
import {workAreaControl} from "./WorkAreaLane"
import {editTimelineNote} from "./TimelineNotes"
import {rulerNames, type RulerId, type RulerPreferences} from "./RulerPreferences"

export function createRulerControls(service: StudioService, lifecycle: Lifecycle, prefs: RulerPreferences) {
    const button = document.createElement("button"), popover = document.createElement("div")
    button.dataset.i18n = ""
    button.className = "ft-ruler-menu-button"
    button.type = "button"
    button.textContent = "Rulers ▾"
    button.setAttribute("aria-label", "Rulers")
    popover.className = "ft-ruler-menu"
    popover.popover = "auto"
    popover.id = `rulers-${crypto.randomUUID()}`
    button.popoverTargetElement = popover
    button.setAttribute("aria-controls", popover.id)
    const fields = new Map<RulerId, HTMLInputElement>()
    for (const id of Object.keys(rulerNames) as RulerId[]) {
        const label = document.createElement("label"), check = document.createElement("input")
        check.type = "checkbox"
        check.onchange = () => prefs.show(id, check.checked)
        fields.set(id, check)
        label.append(check, rulerNames[id])
        popover.append(label)
    }
    const rate = document.createElement("select")
    rate.dataset.i18n = ""
    rate.setAttribute("aria-label", "User ruler frame rate")
    for (const fps of FRAME_RATES) {rate.add(new Option(fps.label, fps.id))}
    rate.onchange = () => prefs.setUserRate(rate.value)
    popover.append(rate)
    const add = document.createElement("button")
    add.type = "button"
    add.textContent = "Add note at playhead…"
    add.onclick = () => {
        prefs.show("notes", true)
        popover.hidePopover()
        editTimelineNote(service.project, service.engine.position.getValue(), lifecycle)
    }
    popover.append(add)
    button.setAttribute("aria-expanded", "false")
    popover.addEventListener("beforetoggle", event => {
        const open = (event as ToggleEvent).newState === "open"
        if (open) {
            const box = button.getBoundingClientRect()
            popover.style.left = `${Math.max(4, Math.min(box.left, window.innerWidth - 205))}px`
            popover.style.top = `${box.bottom + 240 <= window.innerHeight ? box.bottom + 4 : Math.max(4, box.top - 240)}px`
        }
        button.setAttribute("aria-expanded", String(open))
    })
    lifecycle.own(prefs.watch(() => {
        fields.forEach((check, id) => check.checked = prefs.visible[id])
        rate.value = prefs.userRate
    }))
    return [button, popover] as const
}

export function rulerLabels(service: StudioService, lifecycle: Lifecycle, prefs: RulerPreferences) {
    const labels = document.createElement("div")
    labels.className = "ft-ruler-labels"
    
    const cue = document.createElement("span")
    cue.className = "ft-ruler-cue-label"
    cue.textContent = "Cues"
    labels.append(cue)
    const rows = Object.keys(rulerNames).map(key => {
        const id = key as RulerId, row = id === "loop" ? workAreaControl(service, lifecycle) : document.createElement("span")
        row.dataset.ruler = id
        if (id !== "loop") row.textContent = rulerNames[id]
        labels.append(row)
        return {id, row}
    })
    const bars = document.createElement("span")
    bars.textContent = "Bars / Beats"
    bars.className = "ft-ruler-bars-label"
    labels.append(bars)
    const refresh = () => {
        rows.forEach(({id, row}) => {
            row.hidden = !prefs.visible[id]
            if (id === "samples") {row.title = tr("Project audio · {0} Hz", service.audioContext.sampleRate)}
            if (id === "timecode") {row.title = getFrameRate(timeSettings.fps).label}
            if (id === "user") {row.textContent = tr("{0} fps (User)", getFrameRate(prefs.userRate).id)}
        })
    }
    lifecycle.ownAll(prefs.watch(refresh), {terminate: subscribeTimeSettings(refresh)}, {terminate: watchStudioLanguage(refresh)})
    return labels
}
