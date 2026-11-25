import {BoxGraph} from '@opendaw/lib-box'
import {ByteArrayInput, Option, type Progress} from '@opendaw/lib-std'
import {MetaData, PresetHeader} from '@opendaw/studio-adapters'
import {AudioFileBox, BoxIO, SoundfontFileBox, WclapDeviceBox, WclapInstrumentBox} from '@opendaw/studio-boxes'
import {ProjectBundle, type ProjectProfile} from '@opendaw/studio-core'

export const retainedInstrumentOrigin = 'flowtu:media-instrument'

export function presetResourceBoxes(bytes:ArrayBufferLike) {
    const header = new ByteArrayInput(bytes)
    if (header.readInt() !== PresetHeader.MAGIC_HEADER_OPEN || header.readInt() !== PresetHeader.FORMAT_VERSION) {
        throw new Error('Cannot read the instrument preset stored with this MIDI clip.')
    }
    const graph = new BoxGraph(Option.wrap(BoxIO.create))
    graph.fromArrayBuffer(bytes.slice(8), false)
    return graph.boxes().filter(box => box instanceof AudioFileBox || box instanceof SoundfontFileBox ||
        box instanceof WclapDeviceBox || box instanceof WclapInstrumentBox)
}

function retainedResources({project}:ProjectProfile) {
    const presets = new Set<string>()
    for (const lane of project.primaryAudioUnitBoxAdapter.tracks.values()) {
        const preset = MetaData.read(lane.box, retainedInstrumentOrigin)
        if (typeof preset === 'string') presets.add(preset)
    }
    return [...presets].flatMap(preset =>
        presetResourceBoxes(Uint8Array.from(atob(preset), char => char.charCodeAt(0)).buffer))
}

export function encodeStudioBundle(profile:ProjectProfile, progress:Progress.Handler) {
    return ProjectBundle.encode(profile, progress, () => retainedResources(profile))
}
