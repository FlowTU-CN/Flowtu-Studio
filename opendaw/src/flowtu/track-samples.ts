import {Option as Maybe, UUID} from '@opendaw/lib-std'
import {AudioFileBox} from '@opendaw/studio-boxes'
import {AudioRegionBoxAdapter, AudioUnitBoxAdapter, TrackBoxAdapter, TrackType, type Sample} from '@opendaw/studio-adapters'
import {AudioContentFactory, SampleStorage, type Project} from '@opendaw/studio-core'
import type {StudioService} from '@/service/StudioService'
import {OpenSampleAPI} from '@/opendaw-api/OpenSampleAPI'
import {SampleSelectStrategy} from '@/ui/devices/SampleSelector'
import {playbackLanes} from './playback-lanes'
import {tr} from './studio-language'
import './video-import.css'

const regionsOn = (track: TrackBoxAdapter) => playbackLanes(track)
    .flatMap(lane => lane.regions.collection.asArray())
    .filter((region): region is AudioRegionBoxAdapter => region instanceof AudioRegionBoxAdapter)
    .sort((a, b) => a.position - b.position)

export function applyTrackSample(project: Project, track: TrackBoxAdapter, sample: Sample,
                                 target: AudioRegionBoxAdapter | undefined, playhead: number) {
    if (!track.box.isAttached() || track.type !== TrackType.Audio || track.optAudioUnit.isEmpty()
        || project.audioUnitFreeze.isFrozen(project.boxAdapters.adapterFor(track.audioUnit, AudioUnitBoxAdapter))) {
        throw new Error(tr('This track cannot be edited.'))
    }
    const regions = regionsOn(track)
    if (target && !regions.includes(target)) throw new Error(tr('The target clip has changed.'))
    if (!(sample.duration > 0 && Number.isFinite(sample.duration))) throw new Error(tr('Invalid sample duration.'))
    const id = UUID.parse(sample.uuid)
    let position = Math.max(0, Math.round(playhead))
    const endAt = (start: number) => Math.ceil(project.tempoMap.secondsToPPQN(project.tempoMap.ppqnToSeconds(start) + sample.duration))
    if (!target) {
        for (const region of regions) {
            if (endAt(position) <= region.position) break
            position = Math.max(position, Math.ceil(region.complete))
        }
        if (!Number.isSafeInteger(endAt(position)) || endAt(position) > 0x7fffffff) throw new Error('Sample exceeds timeline duration.')
    }
    return project.editing.modify(() => {
        const file = project.boxGraph.findBox<AudioFileBox>(id).unwrapOrElse(() =>
            AudioFileBox.create(project.boxGraph, id, box => {
                box.fileName.setValue(sample.name)
                box.endInSeconds.setValue(sample.duration)
            }))
        if (target) {
            // A split or mirrored clip may still reference the old file. Changing only
            // this pointer preserves the neighbours, envelope, fades and source offsets.
            SampleSelectStrategy.changePointer(target.box.file, Maybe.wrap(file))
        } else {
            const box = AudioContentFactory.createNotStretchedRegion({
                boxGraph: project.boxGraph, targetTrack: track.box, audioFileBox: file, sample, position
            })
            const region = project.boxAdapters.adapterFor(box, AudioRegionBoxAdapter)
            project.regionSelection.deselectAll()
            project.regionSelection.select(region)
            project.timelineFocus.focusRegion(region)
            const length = project.timelineBox.durationInPulses
            length.setValue(Math.max(length.getValue(), endAt(position)))
        }
        if (sample.origin !== 'openDAW') project.trackUserCreatedSample(id)
    })
}

export function chooseTrackSample(service: StudioService, track: TrackBoxAdapter) {
    if (!service.hasProfile || track.type !== TrackType.Audio) return
    const project = service.project
    const playhead = service.engine.position.getValue()
    const regions = regionsOn(track), selected = project.regionSelection.selected()
    const dialog = document.createElement('dialog')
    dialog.className = 'flowtu-video-import ft-track-samples'
    dialog.innerHTML = `<form><h2></h2><label><span></span><select name="target"></select></label>
        <label><span></span><select name="source"></select></label><input type="file" hidden
        accept="audio/*,.wav,.wave,.mp3,.ogg,.flac,.aif,.aiff,.m4a,.aac,.opus">
        <button type="button" data-import></button><output aria-live="polite"></output>
        <footer><button type="button" data-close></button><button type="submit" class="video-import-confirm"></button></footer></form>`
    const title = tr('Choose a sample')
    dialog.setAttribute('aria-label', title)
    dialog.querySelector('h2')!.textContent = title
    const [targetLabel, sourceLabel] = dialog.querySelectorAll('label span')
    targetLabel.textContent = tr('Target clip')
    sourceLabel.textContent = tr('Sample')
    const target = dialog.querySelector<HTMLSelectElement>('[name=target]')!
    const source = dialog.querySelector<HTMLSelectElement>('[name=source]')!
    const file = dialog.querySelector('input')!
    const browse = dialog.querySelector<HTMLButtonElement>('[data-import]')!
    const confirm = dialog.querySelector<HTMLButtonElement>('[type=submit]')!
    const close = dialog.querySelector<HTMLButtonElement>('[data-close]')!
    const output = dialog.querySelector('output')!
    const samples = new Map<string, Sample>()
    const add = (sample: Sample) => {
        if (!(sample.duration > 0) || samples.has(sample.uuid)) return
        samples.set(sample.uuid, sample)
        source.add(new Option(sample.name, sample.uuid))
    }
    const sync = () => {confirm.disabled = busy || !samples.has(source.value)}
    let busy = false
    close.textContent = tr('Cancel')
    browse.textContent = tr('Import audio file…')
    confirm.textContent = tr('Apply')
    close.onclick = () => dialog.close()
    browse.onclick = () => file.click()
    source.onchange = sync
    const fallback = new Option(tr('Add clip at next free position'), '')
    target.add(fallback)
    for (const region of regions) {
        const time = project.tempoMap.ppqnToSeconds(region.position).toFixed(2)
        target.add(new Option(region.label + ' · ' + time + ' s', UUID.toString(region.uuid)))
    }
    const preferred = regions.find(region => selected.includes(region)) ?? (regions.length === 1 ? regions[0] : undefined)
    if (preferred) target.value = UUID.toString(preferred.uuid)
    const operation = async (apply: () => Promise<void>) => {
        busy = true
        browse.disabled = true
        sync()
        try {await apply()} catch (error) {output.textContent = error instanceof Error ? error.message : String(error)}
        finally {busy = false; browse.disabled = false; sync()}
    }
    file.onchange = () => {
        const picked = file.files?.[0]
        if (!picked || busy) return
        void operation(async () => {
            const sample = await service.sampleService.importFile({
                name: picked.name.replace(/\.[^.]+$/, ''), bpm: 0, arrayBuffer: await picked.arrayBuffer()
            })
            if (!dialog.open) return
            add(sample)
            source.value = sample.uuid
            output.textContent = ''
            file.value = ''
        })
    }
    dialog.querySelector('form')!.onsubmit = event => {
        event.preventDefault()
        const sample = samples.get(source.value)
        if (busy || !sample) return
        const clip = regions.find(region => UUID.toString(region.uuid) === target.value)
        void operation(async () => {
            await service.sampleManager.getAudioData(UUID.parse(sample.uuid))
            if (!dialog.open) return
            if (!service.hasProfile || service.project !== project) throw new Error(tr('The target clip has changed.'))
            applyTrackSample(project, track, sample, clip, playhead)
            dialog.close()
        })
    }
    dialog.addEventListener('close', () => dialog.remove(), {once: true})
    document.body.append(dialog)
    dialog.showModal()
    sync()
    const fill = (list: ReadonlyArray<Sample>) => {
        if (!dialog.open) return
        list.forEach(add)
        sync()
    }
    void SampleStorage.get().list().then(fill, error => {if (dialog.open) output.textContent = String(error)})
    void OpenSampleAPI.get().all().then(fill, () => {
        if (dialog.open) output.textContent = tr('Online samples unavailable. Local audio is available.')
    })
}
