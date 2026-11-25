import {AudioFileBox} from '@opendaw/studio-boxes'
import {AudioRegionBoxAdapter, InstrumentFactories, type Sample} from '@opendaw/studio-adapters'
import {AudioContentFactory, type Project} from '@opendaw/studio-core'
import {Progress, UUID} from '@opendaw/lib-std'
import type {StudioService} from '../service/StudioService'

/** An original soundtrack uses seconds, never tempo stretching. */
export function addVideoAudioTrack(project: Project, sample: Sample, fileName: string, offset: number) {
    if (!Number.isFinite(offset) || !Number.isFinite(sample.duration) || sample.duration <= 0) {
        throw new Error('The video does not contain a usable audio track.')
    }
    const sourceStart = Math.max(0, -offset)
    if (sourceStart >= sample.duration) throw new Error('The soundtrack ends before the project starts. Set a later video offset and import again.')
    const uuid = UUID.parse(sample.uuid)
    return project.editing.modify(() => {
        const product = project.api.createInstrument(InstrumentFactories.Tape, {name: `${fileName.replace(/\.[^.]+$/, '')} · Original Audio`})
        product.audioUnitBox.volume.setValue(0)
        const audioFileBox = project.boxGraph.findBox<AudioFileBox>(uuid).unwrapOrElse(() => AudioFileBox.create(project.boxGraph, uuid, box => {
            box.fileName.setValue(fileName)
            box.startInSeconds.setValue(0)
            box.endInSeconds.setValue(sample.duration)
        }))
        const region = AudioContentFactory.createNotStretchedRegion({
            boxGraph: project.boxGraph, targetTrack: product.trackBox, audioFileBox,
            sample, position: project.tempoMap.secondsToPPQN(Math.max(0, offset)),
            waveformOffset: sourceStart, name: `${fileName} · Original Audio`
        })
        // A negative reference offset places the first visible frame inside the source.
        // Keep that exact source position while placing the audio at timeline zero.
        region.duration.setValue(sample.duration - sourceStart)
        region.loopDuration.setValue(sample.duration - sourceStart)
        region.hue.setValue(28)
        const adapter = project.boxAdapters.adapterFor(region, AudioRegionBoxAdapter)
        project.regionSelection.deselectAll()
        project.regionSelection.select(adapter)
        return {track: product.trackBox, region: adapter}
    }, true).unwrap()
}

export async function importVideoOriginalAudio(service: StudioService, project: Project, file: File, offset: number) {
    if (!service.hasProfile || service.project !== project) throw new Error('The project changed. Import the video again.')
    // importFile decodes the container with Web Audio, stores PCM and waveform peaks,
    // and makes the sample available to ProjectBundle just like any audio import.
    const sample = await service.sampleService.importFile({
        name: `${file.name.replace(/\.[^.]+$/, '')} · Original Audio`, bpm: 0,
        arrayBuffer: await file.arrayBuffer(), progressHandler: Progress.Empty
    })
    await service.sampleManager.getAudioData(UUID.parse(sample.uuid))
    if (!service.hasProfile || service.project !== project) throw new Error('The project changed. Import the video again.')
    return addVideoAudioTrack(project, sample, file.name, offset)
}
