import css from "./CutCursor.sass?inline"
import {isDefined, Lifecycle, Nullable, ObservableValue} from "@opendaw/lib-std"
import {ppqn} from "@opendaw/lib-dsp"
import {TimelineRange} from "@opendaw/studio-core"
import {createElement} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"

const className = Html.adoptStyleSheet(css, "CutCursor")

type Construct = {
    lifecycle: Lifecycle
    guide?: boolean
    range: TimelineRange
    position: ObservableValue<Nullable<ppqn>>
}

export const CutCursor = ({lifecycle, range, position, guide}: Construct) => {
    const svg: SVGSVGElement = (
        <svg classList={className} data-snap-guide={guide ? "" : undefined} style={{pointerEvents: "none"}}>
            <line x1="0" y1="0" x2="0" y2="100%"
                  stroke={guide ? "#8acaf2" : "rgba(255,255,255,0.5)"}
                  stroke-width="1"
                  stroke-dasharray={guide ? "none" : "1,2"}/>
        </svg>
    )
    const updater = () => {
        const value = position.getValue()
        if (isDefined(value)) {
            svg.style.left = `${Math.floor(range.unitToX(Math.max(value, 0))) + 1}px`
            svg.style.display = "block"
        } else {
            svg.style.display = "none"
        }
    }
    lifecycle.ownAll(position.subscribe(updater), range.subscribe(updater), Html.watchResize(svg, updater))
    updater()
    return svg
}
