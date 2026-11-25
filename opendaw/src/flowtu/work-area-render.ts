import {AudioData, WavFile} from '@opendaw/lib-dsp'
import {Option, UUID} from '@opendaw/lib-std'
import {OfflineEngineRenderer, type Project} from '@opendaw/studio-core'
import {TrackType, type TrackBoxAdapter} from '@opendaw/studio-adapters'
import JSZip from 'jszip'
import {displayTrack, isAssetLane, playbackLanes} from './playback-lanes'

export type ExportArea = {start: number; end: number}
export type ExportMode = 'mix' | 'stems'
export type ExportTrack = {name: string; unit: string; lanes: string[]}
const musical = (track: TrackBoxAdapter) => track.type === TrackType.Audio || track.type === TrackType.Notes
const safeName = (name: string) => name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 120) || 'Track'

export function exportTracks(project: Project): ExportTrack[] {
    return project.rootBoxAdapter.audioUnits.adapters().flatMap(unit => unit.tracks.values()
        .filter(track => musical(track) && !isAssetLane(track) && displayTrack(track) === track)
        .map(track => ({
            name: unit.label || 'Track', unit: UUID.toString(unit.uuid),
            lanes: playbackLanes(track).map(lane => UUID.toString(lane.uuid))
        })))
}

// Only called on an offline copy. Leave clip gain, fades, MIDI devices and the channel faders intact.
export function prepareExportCopy(copy: Project, wet: boolean, stem?: ExportTrack) {
    copy.editing.modify(() => {
        copy.timelineBox.loopArea.enabled.setValue(false)
        copy.timelineBox.markerTrack.enabled.setValue(false)
        for (const unit of copy.rootBoxAdapter.audioUnits.adapters()) {
            const otherSource = !!stem && unit.isInstrument && UUID.toString(unit.uuid) !== stem.unit
            for (const track of unit.tracks.values()) {
                if (musical(track) && (isAssetLane(track) || (stem && !stem.lanes.includes(UUID.toString(track.uuid))))) {
                    track.enabled.setValue(false)
                }
            }
            if (otherSource) {
                // Isolate even instruments or inserts that emit sound without MIDI input.
                unit.box.output.defer()
            }
            if (!wet) unit.audioEffects.ifSome(chain => chain.adapters().forEach(effect => effect.enabledField.setValue(false)))
            if (!wet || otherSource) for (const send of [...unit.auxSends.adapters()]) send.delete()
        }
    })
}

export function areaFrames(project: Project, area: ExportArea, rate: number) {
    const from = Math.round(project.tempoMap.ppqnToSeconds(area.start) * rate)
    const to = Math.round(project.tempoMap.ppqnToSeconds(area.end) * rate)
    if (!Number.isSafeInteger(to) || !Number.isSafeInteger(from) || from < 0 || to <= from)
        throw new Error('Select a work area with an end after its start.')
    if ((to - from) * 8 + 44 >= 0xffffffff) throw new Error('This work area exceeds the WAV file size limit.')
    return {from, to}
}

export async function renderArea(copy: Project, area: ExportArea, rate: number, signal: AbortSignal,
                                 progress: (fraction: number) => void): Promise<AudioData> {
    const {from, to} = areaFrames(copy, area, rate)
    const audio = AudioData.create(rate, to - from, 2)
    const renderer = await OfflineEngineRenderer.create(copy, Option.None, rate, signal)
    try {
        await renderer.waitForLoading()
        await renderer.play()
        // Pre-roll from zero so an existing MIDI note, fade or reverb tail is already sounding at In.
        // Discard pre-roll in whole-quantum blocks rather than allocating a full-film buffer.
        const block = 128 * 375
        for (let cursor = 0; cursor < to; cursor += block) {
            signal.throwIfAborted()
            const size = Math.min(block, to - cursor)
            const channels = await renderer.step(size)
            const first = Math.max(cursor, from)
            if (first < cursor + size) for (let c = 0; c < 2; c++)
                audio.frames[c].set(channels[c].subarray(first - cursor), first - from)
            progress((cursor + size) / to)
        }
        return audio
    } finally {renderer.terminate()}
}

export async function exportArea(project: Project, area: ExportArea, mode: ExportMode, wet: boolean,
                                 signal: AbortSignal, report: (fraction: number) => void) {
    const rate = 48000
    const snapshot = project.copy()
    try {
        const {from, to} = areaFrames(snapshot, area, rate)
        if (mode === 'mix') {
            prepareExportCopy(snapshot, wet)
            const mix = await renderArea(snapshot, area, rate, signal, report)
            return new Blob([WavFile.encodeFloats(mix)], {type: 'audio/wav'})
        }
        const tracks = exportTracks(snapshot)
        if (!tracks.length) throw new Error('Add an audio or MIDI track to export stems.')
        // JSZip writes classic ZIP directory offsets. Reject before allocating or downloading a truncated archive.
        if (tracks.length >= 65535 || tracks.length * ((to - from) * 8 + 1200) >= 0xffffffff)
            throw new Error('The stems exceed the 4 GB ZIP limit. Shorten the work area and export again.')
        const zip = new JSZip()
        for (const [i, track] of tracks.entries()) {
            signal.throwIfAborted()
            const copy = snapshot.copy()
            try {
                prepareExportCopy(copy, wet, track)
                const hasSource = copy.rootBoxAdapter.audioUnits.adapters().some(unit => unit.tracks.values().some(lane =>
                    track.lanes.includes(UUID.toString(lane.uuid)) && lane.enabled.getValue() &&
                    lane.regions.collection.asArray().some(r => r.position < area.end)))
                const audio = hasSource
                    ? await renderArea(copy, area, rate, signal, fraction => report((i + fraction) / tracks.length))
                    : AudioData.create(rate, to - from, 2)
                const name = String(i + 1).padStart(2, '0') + ' - ' + safeName(track.name) + '.wav'
                zip.file(name, WavFile.encodeFloats(audio))
                report((i + 1) / tracks.length)
            } finally {copy.terminate()}
        }
        signal.throwIfAborted()
        return await zip.generateAsync({type: 'blob', compression: 'STORE'})
    } finally {snapshot.terminate()}
}
