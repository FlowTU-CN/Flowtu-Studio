import {Lifecycle, Maps, Notifier} from "@opendaw/lib-std"
import {JsxValue} from "@opendaw/lib-jsx"
import {PanelType} from "@/ui/workspace/PanelType.ts"
import {PanelContent} from "@/ui/workspace/PanelContent.tsx"
import {Workspace} from "./Workspace"

export interface PanelContentFactory {
    create(lifecycle: Lifecycle, type: PanelType): JsxValue
}

export class PanelContents {
    readonly visibilityChanged = new Notifier<PanelType>()
    multipleDockPanels = false

    readonly #factory: PanelContentFactory
    readonly #contents: Map<PanelType, PanelContent>

    constructor(factory: PanelContentFactory) {
        this.#factory = factory
        this.#contents = new Map()
    }

    isClosed(content: Workspace.Content): boolean {
        return content.type === "panel" && (content.isMinimized || this.getByType(content.panelType).isPopout)
    }

    getByType(panelType: PanelType): PanelContent {
        return Maps.createIfAbsent(this.#contents, panelType, panelType => new PanelContent(this.#factory, panelType))
    }

    showIfAvailable(panelType: PanelType): void {
        const content: PanelContent = this.getByType(panelType)
        content.panelState.ifSome(state => {
            if (content.isPopout) {
                content.focusPopout()
            } else if (state.isMinimized) {
                content.toggleMinimize()
            }
        })
    }

    toggleVisibility(panelType: PanelType): void {
        const content = this.getByType(panelType)
        if (content.isVisible) {content.hide()}
        else {this.showIfAvailable(panelType)}
    }

    releasePopouts(): void {this.#contents.forEach(content => content.releasePopout())}

    get factory(): PanelContentFactory {return this.#factory}
}
