import {MetaData} from '@opendaw/studio-adapters'
import {PPQN} from '@opendaw/lib-dsp'
import type {JSONValue} from '@opendaw/lib-std'
import type {Project} from '@opendaw/studio-core'
import type {Note} from './commands'
import {readLiteMusicContext} from './lite-music-context'
import {readScoring,type ScoringCue} from './scoring-model'
import type {analyzeLitePicture} from './lite-scene-detection'

type MeasuredScene = Awaited<ReturnType<typeof analyzeLitePicture>>['scenes'][number]
export type SceneDescription = {title: string; observation: string; musicPrompt: string; mood?:string; startsNewBeat?:boolean}
export type PictureScene = MeasuredScene & SceneDescription
export type PictureReport = {version: 1; sheetId?:string; file: string; size: number; offset: number; duration: number; model: string; scenes: PictureScene[];
    generatedCues?: Array<{id:string; original:string}>}
export const pictureReportOrigin = 'flowtu:picture-analysis:v1'
const reportRevisions=new WeakMap<Project,number>()
export const backgroundReportRevision=(project:Project)=>reportRevisions.get(project)??0
function pictureReport(data:unknown): PictureReport | undefined {
    const value = data as PictureReport | null
    if (value?.version !== 1 || typeof value.file!=='string' || typeof value.model!=='string' || !Number.isFinite(value.offset) ||
        !Array.isArray(value.scenes) || value.scenes.length>1000 || !value.scenes.every(scene => scene &&
            typeof scene.thumbnail==='string' && scene.thumbnail.startsWith('data:image/jpeg;base64,') &&
            Number.isFinite(scene.start) && Number.isFinite(scene.end) && scene.end>scene.start &&
            typeof scene.title==='string' && typeof scene.musicPrompt==='string' && typeof scene.observation==='string')) return
    return value
}
export function readPictureReport(project: Project): PictureReport | undefined {
    return pictureReport(MetaData.read(project.rootBox, pictureReportOrigin))
}
export function watchPictureReport(project:Project, receive:(report:PictureReport|undefined)=>void) {
    return MetaData.catchupAndSubscribe(project.rootBox,pictureReportOrigin,value=>receive(pictureReport(value.unwrapOrNull())))
}
export function storePictureReport(project: Project, report: PictureReport) {
    // Beginning/end images are transient vision inputs. The project gallery only uses the representative frame.
    const scenes = report.scenes.map(({contextFrames: _transient, ...scene}) => scene)
    MetaData.store(project.rootBox, {...report, scenes} as unknown as JSONValue, pictureReportOrigin)
}
/** Derived picture metadata travels with the project and does not consume an undo step. */
export function storeBackgroundPictureReport(project:Project,report:PictureReport) {
    const graph=project.boxGraph
    graph.beginTransaction()
    try {
        storePictureReport(project,report)
        graph.endTransaction()
    } catch (error) {
        if (graph.inTransaction()) graph.abortTransaction()
        throw error
    }
    reportRevisions.set(project,backgroundReportRevision(project)+1)
}
export function clearPictureReport(project: Project) {
    MetaData.clear(project.rootBox, pictureReportOrigin)
}
type Range = {id?:string; start: number; end: number; prompt: string}
// A measured cut and a hand-placed locator can differ by a fraction of a frame.
// Count short, intentional cues too by limiting tolerance to a quarter of either interval.
export function pictureOverlap(a: {start:number;end:number}, b: {start:number;end:number}) {
    const overlap = Math.min(a.end,b.end) - Math.max(a.start,b.start)
    const tolerance = Math.min(.02,(a.end-a.start)/4,(b.end-b.start)/4)
    return overlap > tolerance ? overlap : 0
}
function sourcePictures(cue:ScoringCue,scenes:PictureScene[],range:Pick<ScoringCue,'start'|'end'>=cue) {
    const sections=cue.analysisSections ?? []
    const spans=sections.flatMap(section=>{
        const start=Math.max(section.start,range.start-cue.start),end=Math.min(section.end,range.end-cue.start)
        return end>start ? [{start:section.videoStart+(start-section.start),end:section.videoStart+(end-section.start)}] : []
    })
    return [...new Set(spans.flatMap(span=>scenes.filter(scene=>pictureOverlap(scene,span)>0)))]
}

export type PictureGroup={title:string;start:number;shots:PictureScene[];cueId?:string}

/** A merged cue has one analysis card. The measured source frames remain addressable for other cues and undo. */
export function pictureGroups(report:PictureReport,cues:ScoringCue[]):PictureGroup[] {
    const covered=new Set<PictureScene>()
    const groups:PictureGroup[]=[]
    for(const cue of cues) {
        if (!cue.analysisSections?.length) continue
        const shots=sourcePictures(cue,report.scenes)
        if (!shots.length) continue
        shots.forEach(shot=>covered.add(shot))
        groups.push({title:cue.name ?? shots[0].title,start:cue.start-report.offset,shots,cueId:cue.id})
    }
    for(const shot of report.scenes) {
        if (covered.has(shot) && !cues.some(c=>!c.analysisSections && pictureOverlap(c,{start:report.offset+shot.start,end:report.offset+shot.end})>0)) continue
        groups.push({title:shot.title,start:shot.start,shots:[shot]})
    }
    return groups.sort((a,b)=>a.start-b.start)
}
const compact = (scene: PictureScene) => ({
    title: scene.title, imageObservation: scene.observation, musicSuggestion: scene.musicPrompt, mood:scene.mood, startsNewBeat:scene.startsNewBeat,
    videoStart: scene.start, videoEnd: scene.end, keyframeTime: scene.keyframeTime, boundary: scene.boundary,
    movement: scene.motion, brightness: scene.brightness, warmth: scene.warmth
})
export function buildLitePrompt(project: Project, range: Range, report = readPictureReport(project)) {
    // A manual cue can span cuts. Keep every overlapping scene and its immediate neighbors.
    const offset = report?.offset ?? 0
    const scenes = report?.scenes ?? []
    const start = range.start - offset, end = range.end - offset
    const timelineScenes = scenes.filter(scene => pictureOverlap(scene,{start,end}) > 0)
    const before = timelineScenes.length ? scenes[scenes.indexOf(timelineScenes[0])-1] : scenes.findLast(scene=>scene.end<=start)
    const after = timelineScenes.length ? scenes[scenes.indexOf(timelineScenes[timelineScenes.length-1])+1] : scenes.find(scene=>scene.start>=end)
    const state = readScoring(project)
    const target=range.id ? state.cues.find(cue=>cue.id===range.id) : undefined
    const cues = target ? [target] : state.cues.filter(cue => pictureOverlap(cue,range)>0)
    const relevant=target?.analysisSections?.length ? sourcePictures(target,scenes,range) : timelineScenes
    return {
        schema: 'flowtu.score-cue.v1', timeUnit: 'seconds', film: report?.file ?? null, analysisModel:report?.model ?? null, videoOffset: offset,
        cue: {in: range.start, out: range.end, duration: range.end-range.start, instruction: range.prompt,
            directions: cues.map(cue => ({name: cue.name, instrument: cue.tone, direction: cue.direction, markdown:cue.markdown,
                ...(cue.analysisSections ? {sections:cue.analysisSections.map(({start,end,videoStart,...section})=>({
                    ...section,in:cue.start+start,out:cue.start+end,videoStart,videoEnd:videoStart+end-start
                }))} : {})}))},
        picture: relevant.map(compact),
        previousPicture: before ? compact(before) : null,
        nextPicture: after ? compact(after) : null,
        nearbyMusic: readLiteMusicContext(project, range.start, range.end),
        instruction: 'Score only the specified cue. Preserve the project tempo. Use the preceding musical exit and the following musical entrance when choosing pitches, articulation and dynamics. Treat music suggestions as editable direction. Unknown scene events must stay unknown.'
    }
}
export interface LiteScoringModel {
    name?: string
    describeScenes?(input: {file: string; duration: number; scenes: MeasuredScene[]}, options: {signal: AbortSignal}): Promise<SceneDescription[]>
    composeMidi?(input: ReturnType<typeof buildLitePrompt>, options: {signal: AbortSignal}): Promise<Note[]>
}
declare global {interface Window {flowtuScoringModel?: LiteScoringModel}}

export async function requestLiteGuide(project: Project, range: Range, signal: AbortSignal): Promise<Note[] | undefined> {
    const model = window.flowtuScoringModel
    if (!model?.composeMidi) return
    const notes = await model.composeMidi(buildLitePrompt(project, range), {signal})
    signal.throwIfAborted()
    const beats = (project.tempoMap.secondsToPPQN(range.end) - project.tempoMap.secondsToPPQN(range.start))
    const length = beats / PPQN.Quarter
    if (!Array.isArray(notes) || !notes.length || notes.length > 32768 ||
        !notes.every(n => n && Number.isInteger(n.pitch) && n.pitch >= 0 && n.pitch <= 127 &&
            Number.isFinite(n.beat) && n.beat >= 0 && n.beat < length &&
            Number.isFinite(n.length) && n.length > 0 && Number.isFinite(n.velocity) && n.velocity > 0 && n.velocity <= 1))
        throw new Error('The MIDI provider returned notes outside the cue or invalid MIDI values.')
    return notes.map(n => ({pitch: n.pitch, velocity: n.velocity, beat: n.beat, length: Math.min(n.length, length-n.beat)}))
}
