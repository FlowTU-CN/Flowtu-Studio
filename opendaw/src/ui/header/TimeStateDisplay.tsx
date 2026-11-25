import css from "./TimeStateDisplay.sass?inline"
import {float, Lifecycle, ObservableValue, Option, Terminator} from "@opendaw/lib-std"
import {createElement, Inject} from "@opendaw/lib-jsx"
import {StudioService} from "@/service/StudioService.ts"
import {Html} from "@opendaw/lib-dom"
import {ContextMenu, MenuItem, ProjectProfile, StudioPreferences} from "@opendaw/studio-core"
import {TapButton} from "@/ui/header/TapButton"
import {MusicalUnitDisplay} from "@/ui/header/MusicalUnitDisplay"
import {createPrecisionTransport} from "@/flowtu/PrecisionTransport"
import {TempoControl} from "@/ui/header/TempoControl"
import {MeterControl} from "@/ui/header/MeterControl"
import {Colors, IconSymbol} from "@opendaw/studio-enums"

const className = Html.adoptStyleSheet(css, "TimeStateDisplay")

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
}

export const TimeStateDisplay = ({lifecycle, service}: Construct) => {
    const {projectProfileService} = service
    const shuffleDigit = Inject.value("60")

    const projectActiveLifeTime = lifecycle.own(new Terminator())
    const projectProfileObserver = (optProfile: Option<ProjectProfile>) => {
        projectActiveLifeTime.terminate()
        if (optProfile.isEmpty()) {return}
        const {project} = optProfile.unwrap()
        const {rootBoxAdapter} = project
        projectActiveLifeTime.ownAll(
            rootBoxAdapter.groove.box.amount.catchupAndSubscribe((owner: ObservableValue<float>) =>
                shuffleDigit.value = String(Math.round(owner.getValue() * 100)))
        )
    }
    lifecycle.own(projectProfileService.catchupAndSubscribe(projectProfileObserver))
    const element: HTMLElement = (
        <div className={className} onInit={element => {
            const values = StudioPreferences.settings["time-display"]
            return ContextMenu.subscribe(element, collector => collector.addItems(
                MenuItem.header({label: "Time Units", icon: IconSymbol.Time, color: Colors.green}),
                MenuItem.default({
                    label: "Musical Time (Bars, Beats)",
                    checked: values.musical
                }).setTriggerProcedure(() => values.musical = !values.musical),
                MenuItem.default({
                    label: "Musical Details (Ticks)",
                    checked: values.details
                }).setTriggerProcedure(() => values.details = !values.details)
            ))
        }}>
            <MusicalUnitDisplay lifecycle={lifecycle} service={service}/>
            {createPrecisionTransport(service,lifecycle)}
            <TempoControl lifecycle={lifecycle} service={service}/>
            <TapButton service={service}/>
            <MeterControl lifecycle={lifecycle} service={service}/>
        </div>
    )
    return element
}
