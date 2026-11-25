import {setMidiTrackName} from "./track-name"
import {UUID, Progress} from '@opendaw/lib-std'
import {PPQN} from '@opendaw/lib-dsp'
import {MidiFile} from '@opendaw/lib-midi'
import {AudioFileBox} from '@opendaw/studio-boxes'
import {AudioRegionBoxAdapter, InstrumentFactories, MetaData, NoteRegionBoxAdapter, TrackBoxAdapter, TrackType, type Sample} from '@opendaw/studio-adapters'
import {AudioContentFactory, type Project} from '@opendaw/studio-core'
import type {StudioService} from '../service/StudioService'
import {assetLaneOrigin, displayTrack, isAssetLane, playbackLanes} from './playback-lanes'
import {reserveAssetLane} from './scoring-assets'
import {settleAudioOverlap} from './crossfades'

type Kind = 'audio' | 'midi'
export type MediaDestination = {kind: 'new' | 'assets'} | {kind: 'existing'; trackId: string; atPointer?: boolean}
type Note = {position: number; duration: number; pitch: number; velocity: number}
const sdkType = (kind: Kind) => kind === 'audio' ? TrackType.Audio : TrackType.Notes
export const assetOnlyUnitOrigin = 'flowtu:asset-only-unit'

export function mediaKind(file: Pick<File, 'name' | 'type'>): Kind | undefined {
    if (/\.(mid|midi|smf|kar)$/i.test(file.name) || /midi/i.test(file.type)) return 'midi'
    if (/^audio\//i.test(file.type) || /\.(wav|wave|mp3|aac|m4a|flac|ogg|oga|opus|aif|aiff|caf|weba)$/i.test(file.name)) return 'audio'
    return undefined
}

function tracksOfKind(project: Project, kind: Kind) {
    return project.rootBoxAdapter.audioUnits.adapters().filter(unit => !unit.isOutput && !project.audioUnitFreeze.isFrozen(unit))
        .sort((a, b) => a.indexField.getValue() - b.indexField.getValue())
        .flatMap(unit => unit.tracks.values().filter(t => t.type === sdkType(kind))
            .sort((a, b) => a.indexField.getValue() - b.indexField.getValue()).map(track => ({unit, track})))
}

export function importTargets(project: Project, kind: Kind) {
    return tracksOfKind(project, kind).filter(({track}) => !isAssetLane(track) && displayTrack(track) === track)
        .map(({unit, track}) => ({id: UUID.toString(track.uuid), name: unit.label + (track.listIndex > 0 ? ' · ' + (track.listIndex + 1) : '')}))
}

function readMidi(data: ArrayBuffer) {
    const format = MidiFile.decoder(data).decode()
    if (format.timeDivision <= 0 || format.timeDivision & 0x8000) throw new Error('MIDI import requires beat-based timing. SMPTE time division is unsupported.')
    if (format.formatType !== 0 && format.formatType !== 1) throw new Error('Choose a type 0 or type 1 Standard MIDI File.')
    const at = (ticks: number) => Math.round(ticks * PPQN.Quarter / format.timeDivision)
    const notes: Note[] = []
    let duration = 0
    for (const track of format.tracks) {
        for (const event of track.metaEvents) duration = Math.max(duration, at(event.ticks))
        for (const [, events] of track.controlEvents) {
            const open = new Map<number, {position: number; velocity: number}[]>()
            for (const event of events) {
                const position = at(event.ticks)
                duration = Math.max(duration, position)
                event.accept({
                    noteOn(pitch, velocity) {
                        const queue = open.get(pitch) ?? []
                        queue.push({position, velocity})
                        open.set(pitch, queue)
                    },
                    noteOff(pitch) {
                        const onset = open.get(pitch)?.shift()
                        if (!onset) return
                        const length = Math.max(1, position - onset.position)
                        notes.push({...onset, pitch, duration: length})
                        duration = Math.max(duration, onset.position + length)
                    }
                })
            }
        }
    }
    if (!notes.length) throw new Error('This MIDI file contains no playable notes.')
    return {kind: 'midi' as const, duration, notes}
}

async function readAudio(service: StudioService, title: string, data: ArrayBuffer) {
    const sample = await service.sampleService.importFile({name: title, bpm: 0, arrayBuffer: data, progressHandler: Progress.Empty})
    if (!Number.isFinite(sample.duration) || sample.duration <= 0) throw new Error('This audio file has no playable duration.')
    await service.sampleManager.getAudioData(UUID.parse(sample.uuid))
    return {kind: 'audio' as const, sample}
}

export async function importMedia(service: StudioService, file: File, destination: MediaDestination, requestedPosition?: number): Promise<string> {
    if (!service.hasProfile) throw new Error('Open a project before importing media.')
    const project = service.project, kind = mediaKind(file)
    if (!kind) throw new Error('Choose an audio file or a Standard MIDI File.')
    const title = file.name.replace(/\.[^.]+$/, '') || file.name
    const data = await file.arrayBuffer()
    const media = kind === 'midi' ? readMidi(data) : await readAudio(service, title, data)
    if (!service.hasProfile || service.project !== project) throw new Error('The project changed. Import the file again.')
    const tracks = tracksOfKind(project, kind)
    let track = destination.kind === 'existing' ? tracks.find(({track}) =>
        UUID.toString(track.uuid) === destination.trackId && !isAssetLane(track) && displayTrack(track) === track)?.track : undefined
    if (destination.kind === 'existing' && !track) throw new Error('The destination track is no longer available.')
    let position = destination.kind === 'assets' ? 0 : Math.max(0, Math.round(requestedPosition ?? service.engine.position.getValue()))
    const endAt = (start: number) => media.kind === 'midi' ? start + media.duration :
        Math.ceil(project.tempoMap.secondsToPPQN(project.tempoMap.ppqnToSeconds(start) + media.sample.duration))
    const exact=destination.kind==='existing' && destination.atPointer===true && requestedPosition!==undefined
    if (track && !exact) {
        const occupied = playbackLanes(track).flatMap(lane => lane.regions.collection.asArray()).sort((a, b) => a.position - b.position)
        for (const region of occupied) {
            if (requestedPosition !== undefined && endAt(position) <= region.position) break
            position = Math.max(position, Math.ceil(region.complete))
        }
    }
    const end = endAt(position)
    if (!Number.isSafeInteger(end) || end > 0x7fffffff) throw new Error('The import exceeds the timeline duration limit.')
    return project.editing.modify(() => {
        if (destination.kind === 'assets' && tracks.length) {
            track = reserveAssetLane(project, tracks[0].track, position, end)
        } else if (!track) {
            const settings = {name: destination.kind === 'assets' ? 'Asset library' : title}
            const product = kind === 'audio' ? project.api.createInstrument(InstrumentFactories.Tape, settings) :
                project.api.createInstrument(InstrumentFactories.Vaporisateur, settings)
            if (kind === 'midi' && destination.kind === 'new') setMidiTrackName(product.audioUnitBox, title)
            track = project.boxAdapters.adapterFor(product.trackBox, TrackBoxAdapter)
            if (destination.kind === 'assets') {
                track.enabled.setValue(false)
                MetaData.store(product.trackBox, true, assetLaneOrigin)
                MetaData.store(product.audioUnitBox, true, assetOnlyUnitOrigin)
            }
        }
        if (exact && media.kind==='midi' && track.regions.collection.asArray().some(r => r.position<end && r.complete>position)) {
            track=project.boxAdapters.adapterFor(project.api.createNoteTrack(track.audioUnit),TrackBoxAdapter)
        }
        const region = media.kind === 'audio' ? placeAudio(project, track, title, media.sample, position) :
            project.boxAdapters.adapterFor(project.api.createNoteRegion({trackBox: track.box, position, duration: media.duration, name: title}), NoteRegionBoxAdapter)
        if(exact && region instanceof AudioRegionBoxAdapter) settleAudioOverlap(project,region,track)
        if (media.kind === 'midi' && region instanceof NoteRegionBoxAdapter) {
            for (const note of media.notes) project.api.createNoteEvent({owner: region.box, ...note})
        }
        if (destination.kind !== 'assets') {
            project.regionSelection.deselectAll()
            project.regionSelection.select(region)
            project.timelineFocus.focusRegion(region)
            const length = project.timelineBox.durationInPulses
            if (end > length.getValue()) length.setValue(end)
        }
        return UUID.toString(region.uuid)
    }, true).unwrap()
}

function placeAudio(project: Project, track: TrackBoxAdapter, title: string, sample: Sample, position: number) {
    const id = UUID.parse(sample.uuid)
    const audioFileBox = project.boxGraph.findBox<AudioFileBox>(id).unwrapOrElse(() =>
        AudioFileBox.create(project.boxGraph, id, box => {box.fileName.setValue(title); box.endInSeconds.setValue(sample.duration)}))
    project.trackUserCreatedSample(id)
    const region = AudioContentFactory.createNotStretchedRegion({boxGraph: project.boxGraph, targetTrack: track.box, sample, audioFileBox, name: title, position})
    return project.boxAdapters.adapterFor(region, AudioRegionBoxAdapter)
}
