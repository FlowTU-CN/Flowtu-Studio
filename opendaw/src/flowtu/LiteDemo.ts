import {PPQN} from '@opendaw/lib-dsp'
import {UUID} from '@opendaw/lib-std'
import {MetaData, NoteRegionBoxAdapter} from '@opendaw/studio-adapters'
import {AudioUnitBox} from '@opendaw/studio-boxes'
import type {Project} from '@opendaw/studio-core'
import type {StudioService} from '../service/StudioService'
import {generateScoringMidi, readScoring, scoringOrigin, type ScoringCue, writeScoring} from './scoring-model'
import {setSelectedScoringCue} from './scoring-selection'
import {seekTimeline} from './timeline-seek'
import {setTimeSettings} from './time-settings'
import {setWorkArea} from './work-area'

const loading = new WeakSet<Project>()

// The Studio template has one editable but silent four-bar MIDI region.
function emptyTimeline(project: Project) {
    const regions = project.rootBoxAdapter.audioUnits.adapters().flatMap(unit =>
        unit.tracks.values().flatMap(track => track.regions.collection.asArray()))
    if (!regions.length) return true
    const region = regions[0]
    return regions.length === 1 && region instanceof NoteRegionBoxAdapter &&
        region.position === 0 && region.duration === 4 * PPQN.Bar &&
        !region.optCollection.unwrapOrNull()?.events.asArray().length
}

export function canLoadLiteDemo(service: StudioService, hasVideo: boolean) {
    if (!service.hasProfile || hasVideo) return false
    const project = service.project
    return !loading.has(project) && MetaData.read(project.rootBox, scoringOrigin) === null && emptyTimeline(project)
}

function demoCues(): ScoringCue[] {
    const cues: Omit<ScoringCue, 'id'>[] = [
        {name: '雨夜候车', start: 0, end: 9, tone: 'keys',
            prompt: '用几颗柔和的 D 小调钢琴和弦，给雨夜的空站台留出呼吸。', direction:
                {style: 'ambient', melody: -66, arrangement: -45, emotion: -35, character: -20}},
        {name: '列车进站', start: 9, end: 21, tone: 'pluck',
            prompt: '列车靠近时，用拨弦琶音带出脉动，给站台广播留一点空间。', direction:
                {style: 'cinematic', melody: 26, arrangement: -18, emotion: 18, character: 40}},
        {name: '驶入夜色', start: 21, end: 30, tone: 'pad',
            prompt: '车窗掠过城市灯火，柔和的弦乐和弦慢慢收住，留下雨声。', direction:
                {style: 'ambient', melody: -44, arrangement: 25, emotion: -15, character: -50}}
    ]
    return cues.map(cue => ({...cue, id: crypto.randomUUID()}))
}

/** Invoked by the sample button. Media uses the same loader as File → Import Video. */
export async function loadLiteDemo(service: StudioService, hasVideo: () => boolean, setVideo: (file: File) => Promise<void>) {
    if (!canLoadLiteDemo(service, hasVideo())) throw new Error('Open an empty Studio project to load the example.')
    const project = service.project
    const assertCurrent = () => {
        if (!service.hasProfile || service.project !== project) throw new Error('The active project changed.')
    }
    loading.add(project)
    try {
        const response = await fetch(`${import.meta.env.BASE_URL}flowtu-lite/last-train.mp4`)
        if (!response.ok) throw new Error('Could not load the example video.')
        const film = new File([await response.blob()], '末班车.mp4', {type: 'video/mp4'})
        assertCurrent()
        if (hasVideo() || MetaData.read(project.rootBox, scoringOrigin) !== null || !emptyTimeline(project))
            throw new Error('The project changed before the example could load.')
        await setVideo(film)
        assertCurrent()
        const initial = readScoring(project)
        if (initial.cues.length || !emptyTimeline(project)) throw new Error('The timeline was edited during import.')
        const cues = demoCues()
        project.editing.modify(() => {
            writeScoring(project, {...initial, cues})
            for (const cue of cues) {
                const take = generateScoringMidi(project, cue)
                // Balance the quiet FM opening against the two subsequent synth cues.
                if (cue === cues[0] && take.unitId) project.boxGraph.findBox<AudioUnitBox>(UUID.parse(take.unitId))
                    .ifSome(unit => unit.volume.setValue(0))
            }
            // On return to the professional timeline the locators span the entire film.
            setWorkArea(project, {start: 0, end: Math.round(project.tempoMap.secondsToPPQN(30))})
        })
        if (service.profile.meta.name === 'Flowtu Session') service.profile.updateMetaData('name', '末班车')
        setTimeSettings({fps: '24'})
        setSelectedScoringCue(project, cues[0].id)
        seekTimeline(project, 0)
        service.timeline.range.showUnitInterval(0, project.tempoMap.secondsToPPQN(31))
    } finally {
        loading.delete(project)
    }
}
