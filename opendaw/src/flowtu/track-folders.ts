import {tr} from "@/flowtu/studio-language"
import {MenuItem, type Project} from "@opendaw/studio-core"
import {UUID} from "@opendaw/lib-std"
import "./track-folders.css"

import {ancestors, assignFolder, changeFolders as change, readFolders, setParent, ungroup} from "./folder-tree"
import {setTrackColor, trackPalette} from "./track-color"
export {readFolders, folderOrigin} from "./folder-tree"

export const trackFolderMenu = (project: Project, member: string) => {
    const state = readFolders(project)
    const current = state.folders.find(f => f.members.includes(member))
    return [
        MenuItem.default({label: tr("Track folder")}).setRuntimeChildrenProcedure(parent => parent.addMenuItem(
            MenuItem.default({label: tr("New track folder…")}).setTriggerProcedure(() => openTrackFolderEditor(project, undefined, member)),
            ...state.folders.map(f => MenuItem.default({label: f.name, checked: f.id === current?.id})
                .setTriggerProcedure(() => assignFolder(project, member, f.id))),
            MenuItem.default({label: tr("Remove from folder"), selectable: !!current})
                .setTriggerProcedure(() => assignFolder(project, member))
        )),
        MenuItem.default({label: tr("Track color")}).setRuntimeChildrenProcedure(parent => parent.addMenuItem(
            MenuItem.default({label: tr("Default / folder color"), checked: !state.colors[member]})
                .setTriggerProcedure(() => setTrackColor(project, member)),
            ...Object.entries(trackPalette).map(([label, color]) => MenuItem.default({label: tr(label), checked: state.colors[member] === color})
                .setTriggerProcedure(() => setTrackColor(project, member, color)))
        ))
    ]
}

export function openTrackFolderEditor(project: Project, folderId?: string, member?: string) {
    const state = readFolders(project), {folders} = state
    const existing = folders.find(f => f.id === folderId)
    if (folderId && !existing) {return}
    const dialog = document.createElement("dialog")
    dialog.className = "ft-track-folder-editor"
    dialog.setAttribute("aria-label", existing ? "Edit track folder" : "New track folder")
    dialog.innerHTML = `<form><h3></h3><label>Name<input name="name" type="text" maxlength="64" required></label>
        <label>Parent folder<select name="parent"></select></label><label>Folder color<input name="color" type="color"></label><fieldset><legend>Tracks</legend></fieldset>
        <footer><button type="button" data-remove>Ungroup</button><button type="button" data-cancel>Cancel</button><button type="submit">Save</button></footer></form>`
    const form = dialog.querySelector("form")!, name = form.querySelector<HTMLInputElement>('[name=name]')!
    const color = form.querySelector<HTMLInputElement>('[name=color]')!, list = form.querySelector("fieldset")!
    form.querySelector("h3")!.textContent = existing ? "Edit track folder" : "New track folder"
    name.value = existing?.name ?? `Folder ${folders.length + 1}`
    color.value = existing?.color ?? trackPalette.Blue
    const parent = form.querySelector("select")!
    parent.add(new Option("Project root", ""))
    for (const f of folders) {
        const path = ancestors(state, f.id)
        if (!folderId || !path.includes(folderId)) {
            parent.add(new Option(path.reverse().map(id => folders.find(folder => folder.id === id)!.name).join(" / "), f.id))
        }
    }
    parent.value = existing?.parent ?? ""
    const units = project.rootBoxAdapter.audioUnits.adapters().filter(unit => !unit.isOutput)
    const members = units.map(unit => {
        const label = document.createElement("label"), checkbox = document.createElement("input")
        const id = UUID.toString(unit.uuid)
        checkbox.type = "checkbox"; checkbox.checked = existing?.members.includes(id) ?? member === id
        label.append(checkbox, document.createTextNode(unit.label))
        list.append(label)
        return {id, checkbox, before: checkbox.checked}
    })
    form.onsubmit = e => {
        e.preventDefault()
        if (!name.value.trim()) {name.focus(); return}
        change(project, state => {
            let folder = state.folders.find(f => f.id === folderId)
            if (!folder) {
                if (folderId) {return}
                folder = {id: crypto.randomUUID(), name: "", color: "", collapsed: false, members: []}
                state.folders.push(folder)
            }
            if (!ancestors(state, parent.value).includes(folder.id)) {setParent(state, folder.id, parent.value)}
            folder.name = name.value.trim()
            folder.color = color.value
            for (const {id, checkbox, before} of members) {
                if (existing && before === checkbox.checked) {continue}
                if (!checkbox.checked) {folder.members = folder.members.filter(item => item !== id); continue}
                for (const other of state.folders) {other.members = other.members.filter(item => item !== id)}
                folder.members.push(id)
            }
        })
        dialog.close()
    }
    const remove = form.querySelector<HTMLButtonElement>("[data-remove]")!
    remove.hidden = !existing
    remove.title = "Remove this folder and keep its tracks"
    remove.onclick = () => {
        change(project, state => {const f = state.folders.find(f => f.id === folderId); if (f) {ungroup(state, f)}})
        dialog.close()
    }
    form.querySelector<HTMLButtonElement>("[data-cancel]")!.onclick = () => dialog.close()
    dialog.onclose = () => dialog.remove()
    document.body.append(dialog); dialog.showModal(); name.focus(); name.select()
}
