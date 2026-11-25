import {createElement} from "@opendaw/lib-jsx"
import {Lifecycle} from "@opendaw/lib-std"
import {Interpolation} from "@opendaw/lib-dsp"
import {TempoRange} from "@opendaw/studio-adapters"
import {StudioService} from "@/service/StudioService"
import {setMeterPoint, setTempoPoint} from "./conductor-points"

export const ConductorPoint = ({lifecycle, service, kind}: {
    lifecycle: Lifecycle, service: StudioService, kind: "tempo" | "meter"
}) => {
    const {project, engine} = service
    const meter = kind === "meter"
    const track = project.timelineBoxAdapter.signatureTrack
    const input: HTMLInputElement = meter
        ? <input type="text" aria-label="Time signature" pattern="(?:[1-9]|[12][0-9]|3[01])/(?:1|2|4|8|16|32)"
                 title="Enter a time signature, e.g. 3/4 or 11/8. Use 1–31 beats and a beat unit of 1, 2, 4, 8, 16 or 32."/>
        : <input type="number" aria-label="Tempo in BPM" min={String(TempoRange.min)} max={String(TempoRange.max)} step="any"/>
    const shapes: Record<string, Interpolation> = {
        step: Interpolation.None, linear: Interpolation.Linear,
        early: Interpolation.Curve(0.75), late: Interpolation.Curve(0.25)
    }
    const transition: HTMLSelectElement | null = meter ? null : (
        <select aria-label="Tempo transition to point" title="Transition from the previous tempo point. Drag the midpoint in the lane to bend a ramp.">
            <option value="">As drawn</option><option value="step">Step</option><option value="linear">Linear</option>
            <option value="early">Bend early</option><option value="late">Bend late</option>
        </select>
    )
    const refresh = () => {
        const at = engine.position.getValue()
        input.placeholder = meter ? track.signatureAt(at).join("/") : String(Number(project.tempoMap.getTempoAt(at).toFixed(3)))
    }
    lifecycle.ownAll(engine.position.catchupAndSubscribe(refresh),
        meter ? track.subscribe(refresh) : project.tempoMap.subscribe(refresh))
    const label = meter ? "Set time signature at current bar" : "Set tempo at playhead"
    return <form className="conductor-point" onsubmit={event => {
        event.preventDefault()
        const value = input.value || input.placeholder
        const position = engine.position.getValue()
        if (meter) {
            const [numerator, denominator] = value.split("/").map(Number)
            setMeterPoint(project, position, numerator, denominator)
        } else {
            setTempoPoint(project, position, Number(value), shapes[transition!.value])
        }
        input.value = ""
        refresh()
    }}>{input}{transition}<button type="submit" aria-label={label} title={label}>{meter ? "Set at bar" : "Set point"}</button></form>
}
