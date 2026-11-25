import {createElement} from "@opendaw/lib-jsx"
import {Lifecycle} from "@opendaw/lib-std"
import {Icon} from "@/ui/components/Icon"
import {ContentGlue} from "./ContentGlue"
import {PanelContents} from "./PanelContents"
import {PanelType} from "./PanelType"
import {paletteMenu} from "@/flowtu/device-colors"
import "./panel-cards.css"

export const PanelCards = (lifecycle: Lifecycle, panels: PanelContents, siblings: ContentGlue[]): HTMLElement => {
    const cards = new Map<PanelType, HTMLButtonElement>()
    const types = new Map([
        [PanelType.ContentEditor, "Editor"],
        [PanelType.DevicePanel, "Inst & FX"],
        [PanelType.CompactMixer, "Mixer"]
    ])
    for (const {content, element} of siblings) {
        if (content.type !== "panel") {continue}
        const type = content.panelType, label = types.get(type)
        if (!label) {continue}
        element.classList.add("flowtu-dock-panel")
        element.id = `flowtu-dock-${type}`
        const toggle = () => {
            panels.toggleVisibility(type)
            if (!content.isMinimized && !panels.getByType(type).isPopout) {
                element.scrollIntoView({block: "nearest", inline: "nearest"})
            }
        }
        const button: HTMLButtonElement = (
            <button type="button" aria-controls={element.id} onclick={toggle}>
                <Icon symbol={content.icon}/><span>{label}</span>
            </button>
        )
        cards.set(type, button)
    }
    const openOrder = new Set([...cards.keys()].filter(type => panels.getByType(type).isVisible))

    const single: HTMLButtonElement = <button type="button" title="Open one panel at a time">Single</button>
    const multiple: HTMLButtonElement = <button type="button" title="Open several panels together">Multiple</button>
    const palette = paletteMenu(document)
    lifecycle.own(palette)
    const sync = () => {
        palette.element.hidden = !cards.has(PanelType.DevicePanel) || !panels.getByType(PanelType.DevicePanel).isVisible
        for (const [type, button] of cards) {
            const visible = String(panels.getByType(type).isVisible)
            button.setAttribute("aria-pressed", visible)
            button.setAttribute("aria-expanded", visible)
        }
        single.setAttribute("aria-pressed", String(!panels.multipleDockPanels))
        multiple.setAttribute("aria-pressed", String(panels.multipleDockPanels))
    }
    const keepOnly = (keep: PanelType | undefined) => {
        for (const type of cards.keys()) {
            if (type !== keep) {panels.getByType(type).hide()}
        }
    }
    const setMultiple = (enabled: boolean) => {
        panels.multipleDockPanels = enabled
        if (!enabled) {keepOnly([...openOrder].pop())}
        sync()
    }
    single.onclick = () => setMultiple(false)
    multiple.onclick = () => setMultiple(true)
    lifecycle.own(panels.visibilityChanged.subscribe(type => {
        if (!cards.has(type)) {return}
        openOrder.delete(type)
        if (panels.getByType(type).isVisible) {
            openOrder.add(type)
            if (!panels.multipleDockPanels) {keepOnly(type)}
        }
        sync()
    }))
    if (!panels.multipleDockPanels && openOrder.size > 1) {keepOnly([...openOrder].pop())}
    sync()
    return (
        <div className="flowtu-panel-cards" role="group" aria-label="Lower panels">
            <div className="dock-choices" role="group" aria-label="Panels">{Array.from(cards.values())}</div>
            {palette.element}
            <div className="dock-mode" role="group" aria-label="Panel selection mode">{single}{multiple}</div>
        </div>
    )
}
