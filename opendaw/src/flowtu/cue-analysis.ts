import type {ScoringCue} from './scoring-model'
import type {Tone} from './commands'
import type {ScoreDirection} from './scoring-direction'

// Local bounds travel with the cue. The source time always points to the original film.
export type CueAnalysisSection = {
    start: number; end: number; videoStart: number
    name: string; prompt: string; tone: Tone; direction?: ScoreDirection
}

export function sourceSections(cue: ScoringCue, videoOffset: number): CueAnalysisSection[] {
    return cue.analysisSections ?? [{
        start: 0, end: cue.end-cue.start, videoStart: cue.analysisVideoStart ?? cue.start-videoOffset,
        name: cue.name ?? '', prompt: cue.prompt, tone: cue.tone, ...(cue.direction ? {direction:cue.direction} : {})
    }]
}

// Cropping retains only the relevant part of each source shot. Moving the cue keeps its content.
export function croppedSections(cue: ScoringCue, start: number, end: number): CueAnalysisSection[] | undefined {
    if (!cue.analysisSections) return
    const offset = start - cue.start
    return cue.analysisSections.flatMap(section => {
        const left = Math.max(section.start,offset), right = Math.min(section.end,end-cue.start)
        if (right <= left) return []
        return [{...section, start:left-offset, end:right-offset, videoStart:section.videoStart+left-section.start}]
    })
}

export function retimeFilmCue(cue:ScoringCue,start:number,end:number):ScoringCue {
    const move = Math.abs((end-start)-(cue.end-cue.start)) < .000001
    return {...cue,start,end,autoEnd:false,
        ...(!move && cue.analysisVideoStart!==undefined ? {analysisVideoStart:cue.analysisVideoStart+start-cue.start} : {}),
        ...(!move && cue.analysisSections ? {analysisSections:croppedSections(cue,start,end)} : {})}
}
