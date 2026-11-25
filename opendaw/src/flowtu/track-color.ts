import {Color, DefaultObservableValue, type Option, Terminable, UUID} from "@opendaw/lib-std"
import {MetaData, type TrackBoxAdapter} from "@opendaw/studio-adapters"
import {Project} from "@opendaw/studio-core"
import {changeFolders, folderOrigin, readFolders} from "./folder-tree"

export const trackPalette = {Blue: "#609cc7", Teal: "#4caa9b", Violet: "#a488d4", Coral: "#d68572", Amber: "#c49b56"}

export function setTrackColor(project: Project, member: string, color?: string) {
    changeFolders(project, state => {
        if (color) {state.colors[member] = color}
        else {delete state.colors[member]}
    })
}

type Tint = ReturnType<typeof Color.hexToHsl>
type Content = {hue: number; trackBoxAdapter: Option<TrackBoxAdapter>}
const indices = new WeakMap<Project, DefaultObservableValue<Map<string, Tint>>>()

// Derive the display tint from the current owner. Moving or copying a region needs no color edit.
export function trackColors(project: Project) {
    const existing = indices.get(project)
    if (existing) {return existing}
    const model = new DefaultObservableValue(new Map<string, Tint>())
    indices.set(project, model)
    project.own(MetaData.catchupAndSubscribe(project.rootBox, folderOrigin, () => {
        const state = readFolders(project), colors = new Map<string, Tint>()
        for (const folder of state.folders) {
            const tint = Color.hexToHsl(folder.color)
            for (const id of folder.members) {colors.set(id, tint)}
        }
        for (const [id, hex] of Object.entries(state.colors)) {colors.set(id, Color.hexToHsl(hex))}
        model.setValue(colors)
    }))
    return model
}

export function trackTint(track?: TrackBoxAdapter | null) {
    if (!track || !(track.context instanceof Project)) {return}
    const unit = track.optAudioUnit.unwrapOrNull()
    return unit ? trackColors(track.context).getValue().get(UUID.toString(unit.address.uuid)) : undefined
}

export function contentHue(content: Content): number {
    return trackTint(content.trackBoxAdapter.unwrapOrNull())?.h ?? content.hue
}

export function watchContentColor(content: Content, update: () => void) {
    const project = content.trackBoxAdapter.unwrapOrNull()?.context
    return project instanceof Project ? trackColors(project).subscribe(update) : Terminable.Empty
}
