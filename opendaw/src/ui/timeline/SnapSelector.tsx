import css from "./SnapSelector.sass?inline"
import {Lifecycle} from "@opendaw/lib-std"
import {MenuButton} from "@/ui/components/MenuButton.tsx"
import {Snapping} from "@/ui/timeline/Snapping.ts"
import {Icon} from "@/ui/components/Icon.tsx"
import {createElement, Inject} from "@opendaw/lib-jsx"
import {Colors, IconSymbol} from "@opendaw/studio-enums"
import {Html} from "@opendaw/lib-dom"

const className = Html.adoptStyleSheet(css, "SnapSelector")

type Construct = {
    lifecycle: Lifecycle
    snapping: Snapping
}

export const SnapSelector = ({lifecycle, snapping}: Construct) => {
    const label = () => !snapping.enabled ? "Off" : snapping.target === "edges" ? "Clip edges" : snapping.unit.name
    const snappingName = Inject.value(label())
    lifecycle.own(snapping.subscribe(() => {snappingName.value = label()}))
    return (
        <div className={className}>
            <label>Snap</label>
            <MenuButton root={Snapping.createMenuRoot(snapping)}
                        appearance={{framed: true, color: Colors.gray, activeColor: Colors.bright}}>
                <label style={{minWidth: "5em"}}>{snappingName}<Icon symbol={IconSymbol.Dropdown}/></label>
            </MenuButton>
        </div>
    )
}
