import {Browser, Keyboard} from "@opendaw/lib-dom"
import {type Editing, Terminable} from "@opendaw/lib-std"

export const resetHint = Browser.isMacOS() ? "⌘-click to reset" : "Ctrl-click to reset"

export function installControlReset(element: Element, reset: () => void): Terminable {
    const press = (event: Event) => {
        const pointer = event as PointerEvent
        if (pointer.button !== 0) {return}
        // macOS can report a Control-click as button 0 before its secondary-click menu.
        if (Browser.isMacOS() && pointer.ctrlKey) {event.stopImmediatePropagation(); return}
        if (!Keyboard.isControlKey(pointer)) {return}
        event.preventDefault()
        event.stopImmediatePropagation()
        if (event.type === "pointerdown") {reset()}
    }
    element.addEventListener("pointerdown", press, true)
    element.addEventListener("click", press, true)
    return {terminate: () => {
        element.removeEventListener("pointerdown", press, true)
        element.removeEventListener("click", press, true)
    }}
}

export function installModelReset(element: Element, model: object, editing?: Editing): Terminable {
    if (!("reset" in model) || typeof model.reset !== "function") {return Terminable.Empty}
    const reset = model.reset.bind(model)
    return installControlReset(element, () => editing ? editing.modify(reset, true) : reset())
}
