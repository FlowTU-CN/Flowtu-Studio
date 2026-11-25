import css from "./SignatureTrackHeader.sass?inline"
import {Html} from "@opendaw/lib-dom"
import {createElement} from "@opendaw/lib-jsx"
import {Checkbox} from "@/ui/components/Checkbox"
import {EditWrapper} from "@/ui/wrapper/EditWrapper"
import {IconSymbol} from "@opendaw/studio-enums"
import {Icon} from "@/ui/components/Icon"
import {Lifecycle} from "@opendaw/lib-std"
import {StudioService} from "@/service/StudioService"
import {ConductorPoint} from "../ConductorPoint"

const className = Html.adoptStyleSheet(css, "SignatureTrackHeader")

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
}

export const SignatureTrackHeader = ({lifecycle, service}: Construct) => {
    const {editing, timelineBox} = service.project
    return (
        <div className={className}>
            <header>
                <span data-i18n="">Time signature</span>
                <ConductorPoint lifecycle={lifecycle} service={service} kind="meter"/>
                <Checkbox lifecycle={lifecycle}
                          appearance={{tooltip: "Enable time signature changes", cursor: "pointer"}}
                          model={EditWrapper.forValue(editing, timelineBox.signatureTrack.enabled)}>
                    <Icon symbol={IconSymbol.Checkbox} style={{fontSize: "11px"}}/>
                </Checkbox>
            </header>
        </div>
    )
}
