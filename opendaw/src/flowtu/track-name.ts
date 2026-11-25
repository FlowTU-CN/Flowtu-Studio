import {MetaData} from "@opendaw/studio-adapters"
import type {AudioUnitBox} from "@opendaw/studio-boxes"

const nameOrigin = "flowtu:midi-track-name"

export function midiTrackName(unit: AudioUnitBox): string | undefined {
    const name = MetaData.read(unit, nameOrigin)
    return typeof name === "string" && name.length ? name : undefined
}

export function setMidiTrackName(unit: AudioUnitBox, value: string) {
    if (value.trim()) MetaData.store(unit, value.trim(), nameOrigin)
    else MetaData.clear(unit, nameOrigin)
}

export const watchMidiTrackName = (unit: AudioUnitBox, refresh: () => void) =>
    MetaData.catchupAndSubscribe(unit, nameOrigin, refresh)
