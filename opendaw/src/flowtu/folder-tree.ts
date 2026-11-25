import {MetaData, type AudioUnitBoxAdapter} from "@opendaw/studio-adapters"
import type {Project} from "@opendaw/studio-core"
import {type MutableObservableValue, Terminable, UUID} from "@opendaw/lib-std"

export const folderOrigin = "flowtu:track-folders:v1"
export type TrackFolder = {id: string, name: string, color: string, collapsed: boolean, members: string[], parent?: string, mute?: boolean, solo?: boolean}
type Flag = "mute" | "solo"
type FolderState = {folders: TrackFolder[], colors: Record<string, string>, order: string[], held: Record<Flag, Record<string, boolean>>}
const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter(UUID.validateString) : []
export const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)
const booleans = (v: unknown): Record<string, boolean> => Object.fromEntries(Object.entries(v ?? {}).filter(([key, value]) => UUID.validateString(key) && typeof value === "boolean"))

export function readFolders(project: Project): FolderState {
    const data = MetaData.read(project.rootBox, folderOrigin)
    const state: FolderState = {folders: [], colors: {}, order: [], held: {mute: {}, solo: {}}}
    if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.folders)) {return state}
    for (const item of data.folders) {
        if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.id !== "string" ||
            !UUID.validateString(item.id) || typeof item.name !== "string" || !isColor(item.color)) {continue}
        if (state.folders.some(f => f.id === item.id)) {continue}
        state.folders.push({id: item.id, name: item.name, color: item.color, collapsed: item.collapsed === true,
            members: ids(item.members), ...(typeof item.parent === "string" ? {parent: item.parent} : {}),
            mute: item.mute === true, solo: item.solo === true})
    }
    for (const f of state.folders) {
        if (f.parent && (!state.folders.some(parent => parent.id === f.parent) || ancestors(state, f.parent).includes(f.id))) {delete f.parent}
    }
    state.colors = Object.fromEntries(Object.entries(data.colors ?? {}).filter(([key, value]) => UUID.validateString(key) && isColor(value))) as Record<string,string>
    state.order = ids(data.order)
    const held = data.held
    if (held && typeof held === "object" && !Array.isArray(held)) {state.held = {mute: booleans(held.mute), solo: booleans(held.solo)}}
    return state
}

export function ancestors(state: FolderState, id?: string): string[] {
    const path: string[] = []
    while (id && !path.includes(id)) {path.push(id); id = state.folders.find(f => f.id === id)?.parent}
    return path
}

const ownerOf = (state: FolderState, id: string) => state.folders.find(f => f.members.includes(id))?.id
const unitIds = (project: Project): string[] => project.rootBoxAdapter.audioUnits.adapters().filter(u => !u.isOutput).map(u => UUID.toString(u.uuid))

/** The order of old projects is determined by the first native member, including non-adjacent tracks. */
export function folderTree(state: FolderState, units: string[]) {
    const byId = new Map(state.folders.map(f => [f.id, f]))
    const parents = new Map<string,string>()
    for (const f of state.folders) {for (const member of f.members) {parents.set(member, f.id)}}
    const children = new Map<string, string[]>(), placed = new Set<string>()
    const place = (id: string) => {
        if (placed.has(id)) {return}
        placed.add(id)
        const parent = byId.get(id)?.parent ?? parents.get(id) ?? ""
        if (parent) {place(parent)}
        const siblings = children.get(parent)
        if (siblings) {siblings.push(id)} else {children.set(parent, [id])}
    }
    units.forEach(place)
    state.folders.forEach(f => place(f.id))
    const rank = new Map(state.order.map((id, i) => [id, i]))
    for (const siblings of children.values()) {siblings.sort((a,b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity))}
    return {children, byId, parents}
}

export function changeFolders(project: Project, update: (state: FolderState) => void) {
    project.editing.modify(() => {
        const state = readFolders(project)
        update(state)
        // The worklet and offline renderer read these native channel switches. Keep the individual
        // setting while one or more ancestor folders hold a switch on.
        for (const unit of project.rootBoxAdapter.audioUnits.adapters()) {
            if (unit.isOutput) {continue}
            const id = UUID.toString(unit.uuid), path = ancestors(state, ownerOf(state, id))
            for (const key of ["mute", "solo"] as const) {
                const held = state.held[key], field = unit.box[key]
                if (state.folders.some(f => path.includes(f.id) && f[key])) {
                    held[id] ??= field.getValue()
                    field.setValue(true)
                } else if (id in held) {
                    field.setValue(held[id])
                    delete held[id]
                }
            }
        }
        MetaData.store(project.rootBox, state, folderOrigin)
    }, true)
}

/** A member can change its personal switch while the folder keeps the effective switch engaged. */
export function memberSwitch(project: Project, unit: AudioUnitBoxAdapter, key: Flag): MutableObservableValue<boolean> {
    const parameter = unit.namedParameter[key], id = UUID.toString(unit.uuid)
    const model: MutableObservableValue<boolean> = {
        getValue: () => readFolders(project).held[key][id] ?? parameter.getControlledValue(),
        setValue: value => {
            if (id in readFolders(project).held[key]) {
                changeFolders(project, state => {state.held[key][id] = value})
            } else {project.editing.modify(() => parameter.setValue(value))}
        },
        subscribe: observer => {
            let ready = false
            const meta = MetaData.catchupAndSubscribe(project.rootBox, folderOrigin, () => {if (ready) {observer(model)}})
            ready = true
            return Terminable.many(meta, parameter.subscribe(() => observer(model)))
        },
        catchupAndSubscribe: observer => {observer(model); return model.subscribe(observer)}
    }
    return model
}

export function setParent(state: FolderState, id: string, parent?: string) {
    const folder = state.folders.find(f => f.id === id)
    if (folder) {
        if (parent) {folder.parent = parent} else {delete folder.parent}
    } else {
        for (const f of state.folders) {f.members = f.members.filter(member => member !== id); if (f.id === parent) {f.members.push(id)}}
    }
}
export function assignFolder(project: Project, member: string, folderId?: string) {
    if (!unitIds(project).includes(member)) {return}
    changeFolders(project, state => {
        if (!folderId || state.folders.some(f => f.id === folderId)) {setParent(state, member, folderId)}
    })
}
export function toggleFolder(project: Project, id: string, key: "collapsed" | Flag = "collapsed") {
    changeFolders(project, state => {const f = state.folders.find(f => f.id === id); if (f) {f[key] = !f[key]}})
}
export function resetSwitches(project: Project, key: Flag) {
    changeFolders(project, state => {
        for (const folder of state.folders) {folder[key] = false}
        state.held[key] = {}
        for (const unit of project.rootBoxAdapter.audioUnits.adapters()) {unit.box[key].setValue(false)}
    })
}

export type DropSide = "before" | "after" | "inside" | "root"
export function moveEntry(project: Project, source: string, target: string, side: DropSide) {
    const units = unitIds(project), state = readFolders(project), {children, byId, parents} = folderTree(state, units)
    if ((!units.includes(source) && !byId.has(source)) || source === target) {return}
    if (side === "inside" && !byId.has(target)) {return}
    if (side !== "root" && !units.includes(target) && !byId.has(target)) {return}
    const parent = side === "root" ? "" : side === "inside" ? target : (byId.get(target)?.parent ?? parents.get(target) ?? "")
    if (ancestors(state, parent).includes(source)) {return}
    const siblings = (children.get(parent) ?? []).filter(id => id !== source)
    const index = side === "inside" || side === "root" ? siblings.length : siblings.indexOf(target) + Number(side === "after")
    siblings.splice(index, 0, source)
    changeFolders(project, next => {
        setParent(next, source, parent)
        // Only sibling ordering matters. Other branches retain their existing order.
        next.order = [...siblings, ...next.order.filter(id => !siblings.includes(id))]
    })
}

export function ungroup(state: FolderState, folder: TrackFolder) {
    const parent = folder.parent
    for (const member of [...folder.members]) {setParent(state, member, parent)}
    for (const child of state.folders.filter(f => f.parent === folder.id)) {setParent(state, child.id, parent)}
    state.folders = state.folders.filter(f => f.id !== folder.id)
    state.order = state.folders.length ? state.order.filter(id => id !== folder.id) : []
}
