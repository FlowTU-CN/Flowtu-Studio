import {type Lifecycle, UUID} from "@opendaw/lib-std"
import type {Project} from "@opendaw/studio-core"
import type {AudioUnitBoxAdapter} from "@opendaw/studio-adapters"
import {createToolbarMenu} from "./ToolbarMenu"
import {setTrackColor, trackPalette} from "./track-color"
import {readFolders} from "./folder-tree"

export function trackColorPicker(lifecycle: Lifecycle, project: Project, unit: AudioUnitBoxAdapter, icon: HTMLElement) {
    const member = UUID.toString(unit.uuid), menu = createToolbarMenu("Track color")
    menu.element.classList.add("ft-track-color")
    menu.trigger.setAttribute("aria-label", "Track color · " + unit.label)
    menu.trigger.title = "Track color"
    menu.panel.setAttribute("aria-label", "Track color options")
    for (const [label, hex] of Object.entries({...trackPalette, "Default / folder color": ""})) {
        const option = document.createElement("button")
        option.type = "button"
        option.textContent = label
        option.dataset.color = hex
        if (hex) {option.style.setProperty("--swatch", hex)}
        option.onclick = () => setTrackColor(project, member, hex || undefined)
        menu.panel.append(option)
    }
    const selection = () => {
        const color = readFolders(project).colors[member] ?? ""
        for (const choice of menu.panel.querySelectorAll<HTMLButtonElement>("button")) {
            choice.setAttribute("aria-pressed", String(choice.dataset.color === color))
        }
    }
    menu.trigger.addEventListener("click", selection)
    menu.trigger.addEventListener("keydown", selection)
    // A short click on the instrument color also opens the palette. Native drag still reorders the track.
    icon.onclick = () => menu.trigger.click()
    lifecycle.own({terminate: menu.dispose})
    return menu.element
}
