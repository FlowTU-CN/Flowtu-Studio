import {Events} from "@opendaw/lib-dom"
import {Terminable, UUID} from "@opendaw/lib-std"
import type {AudioUnitBoxAdapter} from "@opendaw/studio-adapters"
import {DragAndDrop} from "@/ui/DragAndDrop"

// Keep the strip's controls, menus and resize edge independent of the draggable background.
export function installUnitHeaderDrag(header: HTMLElement, unit: AudioUnitBoxAdapter, lane?: () => UUID.String | undefined) {
    if (unit.isOutput) {return Terminable.Empty}
    let laneId: UUID.String | undefined
    const grip = document.createElement("span")
    grip.className = "ft-track-grip"
    grip.dataset.i18n = ""
    grip.title = "Drag to reorder track"
    grip.setAttribute("aria-hidden", "true")
    header.appendChild(grip)
    header.classList.add("unit-reorder")
    const source = DragAndDrop.installSource(header, () => laneId
        ? {type: "track", uuid: laneId}
        : {type: "channelstrip", uuid: UUID.toString(unit.uuid), start_index: unit.indexField.getValue()})
    const arm = Events.subscribe(header, "pointerdown", (event: PointerEvent) => {
        const target = event.target
        const inLabel = target instanceof Element && !!target.closest(".labels")
        header.draggable = event.button === 0 && target instanceof Element &&
            (target === header || target === grip || inLabel ||
             !!target.closest(".icon-container")) && !target.closest("[popover], input, select")
        laneId = inLabel && target.closest(".control-label") ? lane?.() : undefined
    }, {capture: true})
    return Terminable.many(source, arm, {terminate: () => {
        header.classList.remove("unit-reorder")
        header.draggable = false
        grip.remove()
    }})
}
