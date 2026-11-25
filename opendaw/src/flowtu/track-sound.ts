import {type Field, Float32Field, Int32Field} from "@opendaw/lib-box"
import {Pointers} from "@opendaw/studio-enums"
import {ClassicWaveform} from "@opendaw/lib-dsp"
import {UUID} from "@opendaw/lib-std"
import {AudioUnitBox, CaptureMidiBox, SoundfontDeviceBox, SoundfontFileBox, TubularDeviceBox, VaporisateurDeviceBox} from "@opendaw/studio-boxes"
import {InstrumentFactories, TubularPreset, type Dx7Voice, type InstrumentBox, type InstrumentFactory, type Soundfont} from "@opendaw/studio-adapters"
import type {Project} from "@opendaw/studio-core"
import {tones, type Tone} from "./commands"

export const toneFactory = (tone: Tone) =>
    tone === "keys" || tone === "bell" ? InstrumentFactories.Tubular : InstrumentFactories.Vaporisateur

function inputFor(unit: AudioUnitBox): InstrumentBox {
    const input = unit.input.pointerHub.incoming().find(p => p.box.tags.deviceType === "instrument")
    if (!unit.isAttached() || !input || !(unit.capture.targetVertex.unwrapOrNull()?.box instanceof CaptureMidiBox)) {
        throw new Error("Select a MIDI instrument track.")
    }
    return input.box as InstrumentBox
}

// The audio unit owns its tracks, regions, mixer settings, sends and insert chains.
// Only swap its input device if the requested sound needs a different synthesis engine.
function ensureInstrument<A>(project: Project, unit: AudioUnitBox, factory: InstrumentFactory<A>, attachment?: A) {
    const current = inputFor(unit)
    const key = InstrumentFactories.keyOfBox(current)
    if (key && InstrumentFactories.Named[key] === factory) return current
    const replaced = project.api.replaceMIDIInstrument(current, factory, attachment)
    if (replaced.isFailure()) throw new Error(String(replaced.failureReason()))
    return replaced.result()
}

// Loading a DX7 bank can change the entire voice (transpose, LFO, operator tuning…).
// Reset synthesis parameters in place to keep automation links on a same-engine change.
function resetParameters(fields: ReadonlyArray<Field>) {
    for (const field of fields) {
        if ((field instanceof Float32Field || field instanceof Int32Field) && field.pointerRules.accepts.includes(Pointers.Automation)) {
            field.reset()
        } else {
            resetParameters(field.fields())
        }
    }
}

function applyTone(box: InstrumentBox, tone: Tone, warm: boolean) {
    if (box instanceof TubularDeviceBox) {
        const ratios = [1, tone === "bell" ? 7 : 2, 3]
        const levels = [92, 66, 45]
        box.algorithm.setValue(31)
        box.operators.fields().forEach((op, index) => {
            op.outputLevel.setValue(levels[index] ?? 0)
            op.coarse.setValue(ratios[index] ?? 3)
            op.rate1.setValue(99)
            op.rate2.setValue(tone === "bell" ? 35 : 48)
            op.rate3.setValue(30)
            op.rate4.setValue(65)
            op.level1.setValue(99)
            op.level2.setValue(65)
            op.level3.setValue(0)
            op.level4.setValue(0)
        })
        box.cutoff.setValue(warm ? 0.72 : 0.95)
        box.voiceLoad.setValue(box.voiceLoad.getValue() + 1)
    } else if (box instanceof VaporisateurDeviceBox) {
        const shapes = {bass: ClassicWaveform.triangle, pad: ClassicWaveform.saw, pluck: ClassicWaveform.triangle,
            lead: ClassicWaveform.saw, keys: ClassicWaveform.sine, bell: ClassicWaveform.sine}
        box.oscillators.fields().forEach((osc, index) => {
            osc.waveform.setValue(shapes[tone])
            osc.volume.setValue(index === 0 ? -9 : -60)
            osc.octave.setValue(0)
        })
        box.cutoff.setValue(tone === "bass" ? 1000 : tone === "pad" ? 2200 : warm ? 2800 : 6500)
        box.attack.setValue(tone === "pad" ? 0.3 : 0.005)
        box.decay.setValue(tone === "pluck" ? 0.4 : 0.2)
        box.sustain.setValue(tone === "pluck" ? 0.05 : tone === "pad" ? 0.75 : 0.5)
        box.release.setValue(tone === "pad" ? 1.3 : tone === "bass" ? 0.12 : 0.35)
        box.unisonCount.setValue(tone === "pad" ? 3 : 1)
    }
}

/** Set the patch inside the caller's undoable project edit. */
export function setUnitTone(project: Project, unit: AudioUnitBox, tone: Tone, warm = false, rename = true) {
    const box = ensureInstrument(project, unit, toneFactory(tone))
    if (rename) resetParameters(box.fields())
    applyTone(box, tone, warm)
    if (rename) box.label.setValue(tones[tone].label)
}

export function setUnitDx7Voice(project: Project, unit: AudioUnitBox, voice: Dx7Voice) {
    const box = ensureInstrument(project, unit, InstrumentFactories.Tubular) as TubularDeviceBox
    TubularPreset.apply(box, voice.data)
}

export function setUnitSoundfont(project: Project, unit: AudioUnitBox, soundfont: Soundfont) {
    inputFor(unit)
    const uuid = UUID.parse(soundfont.uuid)
    const file = project.boxGraph.findBox<SoundfontFileBox>(uuid).unwrapOrElse(() =>
        SoundfontFileBox.create(project.boxGraph, uuid, box => box.fileName.setValue(soundfont.name)))
    const box = ensureInstrument(project, unit, InstrumentFactories.Soundfont, file) as SoundfontDeviceBox
    const previous = box.file.targetVertex.unwrapOrNull()?.box
    box.file.refer(file)
    box.presetIndex.setValue(0)
    box.label.setValue(soundfont.name)
    if (previous && !previous.isValid()) previous.delete()
}
