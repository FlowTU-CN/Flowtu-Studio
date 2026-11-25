import css from "./PanelResizer.sass?inline"
import {clamp, Lifecycle, Option} from "@opendaw/lib-std"
import {Dragging, Events, Html} from "@opendaw/lib-dom"
import {createElement} from "@opendaw/lib-jsx"
import {Workspace} from "@/ui/workspace/Workspace.ts"
import {ContentGlue} from "@/ui/workspace/ContentGlue.ts"
import {AxisProperty} from "@/ui/workspace/AxisProperty.ts"
import {PanelContents} from "@/ui/workspace/PanelContents.tsx"

const className = Html.adoptStyleSheet(css, "PanelResizer")

type Construct = {
    lifecycle: Lifecycle
    orientation: Workspace.Orientation
    siblings: ReadonlyArray<ContentGlue>
    panelContents: PanelContents
    target: Element
}

export const PanelResizer = ({lifecycle, orientation, siblings, panelContents, target}: Construct) => {
    const horizontalBar = orientation === "vertical"
    const element: HTMLElement = <div className={Html.buildClassList(className, orientation)}
                                      data-role="panel-resizer" role="separator" tabIndex={0}
                                      aria-orientation={horizontalBar ? "horizontal" : "vertical"}
                                      aria-label={horizontalBar ? "Resize panel heights" : "Resize panel widths"}/>
    const direction = AxisProperty[orientation]
    const beginResize = () => {
        const at = siblings.findIndex(sibling => sibling.element === target)
        const visible = siblings.flatMap(({element, content}, index) => panelContents.isClosed(content) ? [] :
            [{index, element, limits: content.constrains, size: element[direction.size]}])
        const before = visible.findLast(panel => panel.index <= at)
        const after = visible.find(panel => panel.index > at)
        if (!before || !after) {return}
        const a = before.limits
        const b = after.limits
        if (a.type === "fixed" || b.type === "fixed") {return}
        const total = before.size + after.size
        const minimum = Math.max(a.minSize, total - (b.maxSize ?? Infinity))
        const maximum = Math.min(a.maxSize ?? Infinity, total - b.minSize)
        const parent = element.parentElement
        const rack = horizontalBar && parent?.querySelector(":scope > .flowtu-panel-cards") ? parent : null
        const overflowing = rack !== null && rack.scrollHeight > rack.clientHeight + 1
        const scrollTop = rack?.scrollTop ?? 0
        if (rack === null && maximum <= minimum) {return}

        // Base flex weights on measured sizes so an unrelated third panel keeps its height.
        const flexible = visible.flatMap(({element, size, limits}) =>
            limits.type === "flex" && limits.flex > 0 ? [{element, size, limits}] : [])
        const pixels = flexible.reduce((sum, panel) => sum + panel.size, 0)
        if (pixels <= 0) {return}
        const scale = flexible.reduce((sum, panel) => sum + panel.limits.flex, 0) / pixels
        return (delta: number) => {
            const wanted = before.size + delta
            // Beyond a dock's minimums, extend its scrollable stack without moving the grip away from the pointer.
            const extend = rack !== null && (overflowing || wanted < minimum || wanted > maximum)
            const firstSize = extend ? clamp(wanted, a.minSize, a.maxSize ?? Infinity) : clamp(wanted, minimum, maximum)
            const secondSize = extend ? clamp(after.size - delta, b.minSize, b.maxSize ?? Infinity) : total - firstSize
            for (const {element, size, limits} of flexible) {
                const nextSize = element === before.element ? firstSize : element === after.element ? secondSize : size
                element.style.flexBasis = extend ? `${nextSize}px` : ""
                limits.flex = nextSize * scale
                element.style.flexGrow = String(limits.flex)
            }
            if (rack) {rack.scrollTop = scrollTop + firstSize - before.size - delta}
        }
    }
    lifecycle.ownAll(
        Dragging.attach(element, start => {
            const resize = beginResize()
            return resize ? Option.wrap({
                update: (event: Dragging.Event) => resize(event[direction.pointer] - start[direction.pointer])
            }) : Option.None
        }),
        Events.subscribe(element, "keydown", event => {
            const keys = horizontalBar ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"]
            const index = keys.indexOf(event.key)
            if (index < 0) {return}
            const resize = beginResize()
            if (!resize) {return}
            event.preventDefault()
            event.stopPropagation()
            resize(index === 0 ? -12 : 12)
        })
    )
    return element
}
