import {tr} from "@/flowtu/studio-language"
import css from "./TimelineHeader.sass?inline"
import {Lifecycle} from "@opendaw/lib-std"
import {StudioService} from "@/service/StudioService.ts"
import {createElement} from "@opendaw/lib-jsx"
import {Icon} from "@/ui/components/Icon.tsx"
import {Checkbox} from "@/ui/components/Checkbox.tsx"
import {Colors, IconSymbol} from "@opendaw/studio-enums"
import {Html} from "@opendaw/lib-dom"
import {MenuButton} from "@/ui/components/MenuButton"
import {MenuItem} from "@opendaw/studio-core"
import {GlobalShortcuts} from "@/ui/shortcuts/GlobalShortcuts"
import {ShortcutTooltip} from "@/ui/shortcuts/ShortcutTooltip"

import {createRulerControls, rulerLabels} from "./RulerControls"
import type {RulerPreferences} from "./RulerPreferences"

const className = Html.adoptStyleSheet(css, "TimelineHeader")

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
    rulers: RulerPreferences
}

export const TimelineHeader = ({lifecycle, service, rulers}: Construct) => {
    const {followCursor, primaryVisibility: {markers, tempo, signature}, clips} = service.timeline
    const [rulerButton, rulerMenu] = createRulerControls(service, lifecycle, rulers)
    return (
        <div className={className}>
            <div className="ft-timeline-controls">
                <Checkbox lifecycle={lifecycle}
                          model={followCursor}
                          appearance={{
                              color: Colors.shadow,
                              activeColor: Colors.orange,
                              tooltip: ShortcutTooltip.create("Follow Cursor", GlobalShortcuts["toggle-follow-cursor"].shortcut)
                          }}>
                    <Icon symbol={IconSymbol.Run}/>
                </Checkbox>
                <Checkbox lifecycle={lifecycle}
                          model={clips.visible}
                          appearance={{
                              activeColor: Colors.yellow,
                              tooltip: ShortcutTooltip.create("Clips", GlobalShortcuts["toggle-clips"].shortcut)
                          }}>
                    <Icon symbol={IconSymbol.Clips}/>
                </Checkbox>
                {rulerButton}
                <MenuButton
                    onInit={button => {button.dataset.i18n = ""; button.setAttribute("aria-label", "Conductor")}}
                    style={{gap: "4px", paddingInline: "5px"}}
                    appearance={{color: Colors.orange, tinyTriangle: true, framed: true, tooltip: "Show tempo, time signature and marker tracks"}}
                    root={MenuItem.root().setRuntimeChildrenProcedure(parent => parent.addMenuItem(
                        MenuItem.header({
                            label: tr("Conductor tracks"),
                            icon: IconSymbol.Primary,
                            color: Colors.orange
                        }),
                        MenuItem.default({
                            label: tr("Markers"),
                            checked: markers.getValue(),
                            shortcut: GlobalShortcuts["toggle-markers-track"].shortcut.format()
                        }).setTriggerProcedure(() => markers.setValue(!markers.getValue())),
                        MenuItem.default({
                            label: tr("Tempo track"),
                            checked: tempo.getValue(),
                            shortcut: GlobalShortcuts["toggle-tempo-track"].shortcut.format()
                        }).setTriggerProcedure(() => tempo.setValue(!tempo.getValue())),
                        MenuItem.default({
                            label: tr("Time signature track"),
                            checked: signature.getValue(),
                            shortcut: GlobalShortcuts["toggle-signature-track"].shortcut.format()
                        }).setTriggerProcedure(() => signature.setValue(!signature.getValue()))
                    ))}>
                    <span>Conductor</span>
                </MenuButton>
            </div>
            {rulerLabels(service, lifecycle, rulers)}
            {rulerMenu}
        </div>
    )
}
