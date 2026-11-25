import {tr} from "@/flowtu/studio-language"
import {MenuItem, type Project} from "@opendaw/studio-core"
import type {TrackBox} from "@opendaw/studio-boxes"

export const trackHeights = {Small: 48, Medium: 96, Large: 144} as const

export function trackHeightMenu(project: Project, track: TrackBox) {
    return MenuItem.default({label: tr("Track height")}).setRuntimeChildrenProcedure(menu =>
        menu.addMenuItem(...Object.entries(trackHeights).map(([label, size]) =>
            MenuItem.default({label: tr(label), checked: (track.height.getValue() || trackHeights.Medium) === size})
                .setTriggerProcedure(() => {
                    if (track.isAttached()) {project.editing.modify(() => track.height.setValue(size))}
                }))))
}
