import css from "./AddEffectButton.sass?inline"
import {Procedure} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"
import {Colors, IconSymbol} from "@opendaw/studio-enums"
import {EffectFactories, EffectFactory, MenuItem} from "@opendaw/studio-core"
import {MenuButton} from "@/ui/components/MenuButton"
import {Icon} from "@/ui/components/Icon"

import {effectMenuLabel, audioInsertList} from "./effect-label"

const className = Html.adoptStyleSheet(css, "AddEffectButton")

type Construct = {
    // What to do with the chosen effect: insert it into a chain, or spin up a new composite branch holding it.
    select: Procedure<EffectFactory>
    label?: string
    kind?: "audio" | "midi"
    title?: string
}

// A dropdown "Add Effect" button styled like the timeline header's "Add instrument" button. The list is the
// stock audio effects; the caller decides what a pick does.
export const AddEffectButton = ({select, label = "Add Effect", kind = "audio", title = label}: Construct) => (
    <div className={className} title={title}>
        <MenuButton onInit={button => button.setAttribute("aria-label", title)} root={MenuItem.root().setRuntimeChildrenProcedure(parent => parent
            .addMenuItem(...(kind === "audio" ? audioInsertList : EffectFactories.MidiList).map(factory => MenuItem.default({
                label: effectMenuLabel(factory),
                icon: factory.defaultIcon,
                separatorBefore: factory.separatorBefore
            }).setTriggerProcedure(() => select(factory)))))}
                    appearance={{color: Colors.shadow}}>
            <span>{label}</span> <Icon symbol={IconSymbol.Add}/>
        </MenuButton>
    </div>
)

