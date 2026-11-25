import {UUID} from "@opendaw/lib-std"
import type {Project} from "@opendaw/studio-core"
import type {AudioUnitBoxAdapter} from "@opendaw/studio-adapters"
import {DragAndDrop} from "@/ui/DragAndDrop"
import type {AnyDragData} from "@/ui/AnyDragData"
import {folderTree, moveEntry, readFolders, toggleFolder, type DropSide} from "@/flowtu/folder-tree"
import {openTrackFolderEditor} from "@/flowtu/track-folders"

type Unit = {adapter: AudioUnitBoxAdapter, unitTracks: HTMLElement}
export class TimelineFolders {
    readonly rows = new Map<HTMLElement, number>()
    readonly #headers = new Map<string, ReturnType<TimelineFolders["createRow"]>>()
    readonly #drop
    #highlight?: HTMLElement
    #state: ReturnType<typeof readFolders>

    constructor(readonly project: Project, readonly container: Element) {
        this.#state = readFolders(project)
        const locate = (event: DragEvent, data: AnyDragData) => {
            if (data.type !== "channelstrip" && data.type !== "track-folder" || !this.#state.folders.length) {return}
            const el = (event.target as Element).closest<HTMLElement>("[data-folder-id],[data-flowtu-unit]")
            let side: DropSide = "root", target = ""
            if (el) {
                const rect = el.getBoundingClientRect(), y = (event.clientY - rect.top) / rect.height
                target = el.dataset.folderId ?? el.dataset.flowtuUnit!
                side = el.dataset.folderId && y >= .2 && y <= .8 ? "inside" : y < .5 ? "before" : "after"
            }
            return {el, side, target, source: data.uuid}
        }
        this.#drop = DragAndDrop.installTarget(container as HTMLElement, {
            drag: (event, data) => {
                const drop = locate(event, data)
                if (!drop) {return false}
                event.stopImmediatePropagation()
                this.clearDrop()
                if (drop.el && drop.source !== drop.target) {
                    this.#highlight = drop.el
                    drop.el.dataset.folderDrop = drop.side
                }
                return true
            },
            drop: (event, data) => {
                this.clearDrop()
                const drop = locate(event, data)
                if (drop) {moveEntry(project, drop.source, drop.target, drop.side)}
            },
            enter() {}, leave: () => this.clearDrop()
        })
        container.addEventListener("dragend", this.clearDrop)
    }

    private readonly clearDrop = () => {
        if (this.#highlight) {delete this.#highlight.dataset.folderDrop; this.#highlight = undefined}
    }

    reload() {this.#state = readFolders(this.project)}
    terminate() {
        this.#drop.terminate()
        this.container.removeEventListener("dragend", this.clearDrop)
        this.clearDrop()
        this.#headers.forEach(header => header.terminate())
        this.#headers.clear()
    }
    private createRow(id: string) {
        const row = document.createElement("div"), toggle = document.createElement("button")
        const title = document.createElement("span"), count = document.createElement("small"), edit = document.createElement("button")
        row.className = "ft-track-folder"
        row.dataset.folderId = id
        toggle.type = edit.type = "button"
        toggle.append(title, count)
        toggle.title = "Click to expand or collapse. Drag to move this folder."
        toggle.onclick = () => toggleFolder(this.project, id)
        const source = DragAndDrop.installSource(toggle, () => ({type: "track-folder", uuid: id}), row)
        const switchButton = (key: "mute" | "solo") => {
            const button = document.createElement("button")
            button.type = "button"
            button.className = "ft-folder-switch"
            button.dataset.switch = key
            button.textContent = key === "mute" ? "M" : "S"
            button.onclick = () => toggleFolder(this.project, id, key)
            return button
        }
        const mute = switchButton("mute"), solo = switchButton("solo")
        edit.textContent = "⋯"
        edit.onclick = () => openTrackFolderEditor(this.project, id)
        row.append(toggle, mute, solo, edit)
        this.container.append(row)
        return {row, toggle, title, count, edit, mute, solo, terminate: () => {source.terminate(); row.remove()}}
    }

    layout(units: ReadonlyArray<Unit>): number {
        let row = 0
        const ordered = units.toSorted((a,b) => a.adapter.indexField.getValue() - b.adapter.indexField.getValue())
        const unitMap = new Map<string, Unit>(ordered.map(unit => [UUID.toString(unit.adapter.uuid), unit]))
        const {byId, children} = folderTree(this.#state, [...unitMap.keys()])
        this.rows.clear()
        const place = (id: string, depth: number, hidden: boolean, color?: string): number => {
            const folder = byId.get(id)
            if (folder) {
                let header = this.#headers.get(id)
                if (!header) {header = this.createRow(id); this.#headers.set(id, header)}
                const {row: el, title, count, toggle, edit} = header
                el.hidden = hidden
                if (!hidden) {el.style.gridRow = String(++row)}
                el.style.setProperty("--folder-color", folder.color)
                el.style.setProperty("--ft-depth", String(depth))
                title.textContent = folder.name
                toggle.setAttribute("aria-expanded", String(!folder.collapsed))
                toggle.setAttribute("aria-label", `${folder.collapsed ? "Expand" : "Collapse"} ${folder.name}`)
                edit.setAttribute("aria-label", `Edit folder ${folder.name}`)
                let size = 0
                for (const child of children.get(id) ?? []) {size += place(child, depth + 1, hidden || folder.collapsed, folder.color)}
                count.textContent = String(size)
                for (const key of ["mute", "solo"] as const) {
                    const button = header[key]
                    button.setAttribute("aria-label", `${key === "mute" ? "Mute" : "Solo"} folder ${folder.name}`)
                    button.setAttribute("aria-pressed", String(folder[key] === true))
                    button.title = button.getAttribute("aria-label")!
                }
                return size
            }
            const unit = unitMap.get(id)
            if (!unit) {return 0}
            const el = unit.unitTracks, trackColor = this.#state.colors[id] ?? color
            el.toggleAttribute("data-folder-hidden", hidden)
            el.toggleAttribute("data-colored", !!trackColor)
            el.style.setProperty("--ft-track-color", trackColor ?? "")
            el.style.setProperty("--ft-depth", String(depth))
            if (!hidden && el.childElementCount) {el.style.gridRow = String(++row); this.rows.set(el, row)}
            return 1
        }
        for (const id of children.get("") ?? []) {place(id, 0, false)}
        for (const [id, header] of this.#headers) {
            if (!byId.has(id)) {header.terminate(); this.#headers.delete(id)}
        }
        return row
    }
}
