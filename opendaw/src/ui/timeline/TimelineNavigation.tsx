import css from "./TimelineNavigation.sass?inline"
import {Lifecycle} from "@opendaw/lib-std"
import {StudioService} from "@/service/StudioService.ts"
import {TimeAxis} from "@/ui/timeline/TimeAxis.tsx"
import {createElement} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"
import {createScoringCueLane} from "@/flowtu/scoring-cue-lane"
import {createWorkAreaLane} from "./WorkAreaLane"
import {displayRulerSelection} from "./RulerSelection"
import {createProjectTimeRuler} from "./ProjectTimeRuler"

import {createNotesLane} from "./TimelineNotes"
import type {RulerId, RulerPreferences} from "./RulerPreferences"

const className = Html.adoptStyleSheet(css, "TimelineNavigation")

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
    rulers: RulerPreferences
}

export const TimelineNavigation = ({lifecycle, service, rulers}: Construct) => {
    const {range, snapping} = service.timeline
    const loop = createWorkAreaLane(service, lifecycle)
    loop.dataset.ruler = "loop"
    const notes = createNotesLane(service.project, range, lifecycle)
    notes.dataset.ruler = "notes"
    const clocks = (["seconds", "timecode", "samples", "user"] as const)
        .map(id => createProjectTimeRuler(service, lifecycle, id, rulers))
    lifecycle.own(rulers.watch(() => {
        for (const row of [loop, notes, ...clocks]) {row.hidden = !rulers.visible[row.dataset.ruler as RulerId]}
    }))
    const navigation: HTMLElement = (
        <div className={className}>
            {createScoringCueLane(service, lifecycle)}
            {loop}{notes}{clocks}
            <TimeAxis lifecycle={lifecycle} service={service} snapping={snapping} range={range}/>
        </div>
    )
    displayRulerSelection(navigation, service, lifecycle)
    return navigation
}
