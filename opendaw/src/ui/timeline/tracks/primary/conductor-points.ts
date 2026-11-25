import {Interpolation} from "@opendaw/lib-dsp"
import {TempoRange, TimelineBoxAdapter, Validator} from "@opendaw/studio-adapters"
import type {Project} from "@opendaw/studio-core"

/** Called inside the edit transaction used by the graph, brush or numeric entry. */
export function prepareTempoPoint(adapter: TimelineBoxAdapter, position: number, transition: Interpolation = Interpolation.None): void {
    adapter.box.tempoTrack.enabled.setValue(true)
    const collection = adapter.tempoTrackEvents.unwrap()
    // The engine extends its first value backwards. A mid-song change should keep the intro's tempo.
    if (position > 0 && collection.events.isEmpty()) {
        collection.createEvent({position: 0, index: 0, value: adapter.box.bpm.getValue(), interpolation: transition})
    }
}

export function setTempoPoint(project: Project, pulse: number, bpm: number, transition?: Interpolation): void {
    if (!Number.isFinite(bpm) || bpm < TempoRange.min || bpm > TempoRange.max) {return}
    const {editing, timelineBox, timelineBoxAdapter} = project
    const collection = timelineBoxAdapter.tempoTrackEvents.unwrap()
    const position = Math.max(0, Math.round(pulse))
    editing.modify(() => {
        prepareTempoPoint(timelineBoxAdapter, position, transition)
        const previous = collection.events.lowerEqual(position - 1)
        if (transition && previous) {previous.interpolation = transition}
        const point = collection.events.lowerEqual(position)
        if (point?.position === position) {
            point.box.value.setValue(bpm)
        } else {
            collection.createEvent({position, index: 0, value: bpm, interpolation: Interpolation.None})
        }
        const {minBpm, maxBpm} = timelineBox.tempoTrack
        if (bpm < minBpm.getValue()) {minBpm.setValue(Math.floor(bpm))}
        if (bpm > maxBpm.getValue()) {maxBpm.setValue(Math.ceil(bpm))}
    })
}

export function setMeterPoint(project: Project, pulse: number, numerator: number, denominator: number): void {
    if (!Validator.isTimeSignatureValid(numerator, denominator).isSuccess()) {return}
    const track = project.timelineBoxAdapter.signatureTrack
    project.editing.modify(() => {
        track.object.enabled.setValue(true)
        const position = track.floorToBar(Math.max(0, Math.round(pulse)))
        if (position === 0) {
            track.changeSignature(numerator, denominator)
            return
        }
        const event = Array.from(track.iterateAll()).find(point => point.accumulatedPpqn === position)
        if (event) {
            const {box} = track.adapterAt(event.index).unwrap()
            box.nominator.setValue(numerator)
            box.denominator.setValue(denominator)
        } else {
            track.createEvent(position, numerator, denominator)
        }
    })
}
