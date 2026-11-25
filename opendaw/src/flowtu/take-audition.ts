import type {AudioData} from '@opendaw/lib-dsp'
import {AudioRegionBoxAdapter} from '@opendaw/studio-adapters'
import {prepareStoredAudition} from './media-retention'
import {isAssetLane} from './playback-lanes'
import {AudioBounce, OfflineEngineRenderer, type Project} from '@opendaw/studio-core'
import {DefaultObservableValue, Option} from '@opendaw/lib-std'
import type {StudioService} from '../service/StudioService'
import {readScoring, takeMembers, takeRegion} from './scoring-model'

export async function renderAsset(project: Project, id: string, sampleRate: number, signal: AbortSignal, parts: readonly string[] = [id],
                                  range?: {start:number; end:number}, dry = false): Promise<AudioData> {
    const region = takeRegion(project, id)
    if (!region) throw new Error('This asset is no longer in the project.')
    const copy = project.copy()
    try {
        const fragments = parts.flatMap(part => takeRegion(copy,part) ?? [])
        copy.editing.modify(()=>prepareStoredAudition(copy,fragments))
        const job = AudioBounce.collectJobs(fragments, true, false)[0]
        if (!job) throw new Error('This asset is no longer in the project.')
        AudioBounce.prepareCopy(copy, job)
        // A stored audio take already contains its mix. Audition its clip edits without the storage channel strip.
        const storedAudio = region instanceof AudioRegionBoxAdapter && isAssetLane(region.trackBoxAdapter.unwrap())
        const stem = AudioBounce.exportConfiguration(job, storedAudio || dry ? 'pre-fx' : 'post-fader')
        return await OfflineEngineRenderer.renderSection(copy, Option.wrap(stem), {
            type: 'marker', key: id, label: job.label, start: range?.start ?? job.start, end: range?.end ?? job.end, passes: 1, tail: false
        }, new DefaultObservableValue(0), signal, sampleRate)
    } finally {copy.terminate()}
}

/** Listen to the region through its own instrument and inserts without changing the session mix. */
export function createTakeAudition(service: StudioService) {
    let active: {id: string; abort: AbortController; source?: AudioBufferSourceNode} | undefined
    const stop = () => {
        const preview = active
        active = undefined
        preview?.abort.abort()
        if (preview?.source) {
            preview.source.onended = null
            preview.source.stop()
            preview.source.disconnect()
        }
    }
    const play = async (id: string) => {
        const wasCurrent = active?.id === id
        stop()
        if (wasCurrent || !service.hasProfile) return
        if (service.engine.isRecording.getValue() || service.engine.isCountingIn.getValue()) {
            throw new Error('Finish recording before previewing a take.')
        }
        const project = service.project, context = service.audioContext
        const abort = new AbortController()
        active = {id, abort}
        try {
            if (service.engine.isPlaying.getValue()) service.engine.stop()
            await context.resume()
            if (abort.signal.aborted) return
            const cue = readScoring(project).cues.find(item => item.takes?.includes(id))
            const audio = await renderAsset(project, id, context.sampleRate, abort.signal, cue ? takeMembers(cue,id) : [id])
            if (abort.signal.aborted) return
            const buffer = context.createBuffer(audio.numberOfChannels, audio.numberOfFrames, audio.sampleRate)
            audio.frames.forEach((channel, i) => buffer.getChannelData(i).set(channel))
            const source = context.createBufferSource()
            active.source = source
            source.buffer = buffer
            source.connect(context.destination)
            source.onended = () => {
                source.disconnect()
                if (active?.source === source) active = undefined
            }
            source.start()
        } catch (error) {
            if (abort.signal.aborted) return
            stop()
            throw error
        }
    }
    const profile = service.projectProfileService.subscribe(stop)
    const playback = service.engine.isPlaying.subscribe(state => {if (state.getValue()) stop()})
    return {
        play, stop, current: () => active?.id, loading: () => !!active && !active.source,
        dispose() {stop(); profile.terminate(); playback.terminate()}
    }
}
