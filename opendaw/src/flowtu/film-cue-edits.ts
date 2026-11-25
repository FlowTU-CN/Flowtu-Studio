import type {Project} from '@opendaw/studio-core'
import {nextCueName,readScoring,writeScoring,type ScoringCue,type ScoringState} from './scoring-model'

import {croppedSections,retimeFilmCue,sourceSections} from './cue-analysis'
import {currentFilm} from './film-sheets'
import {readPictureReport} from './lite-model'

export const orderedCues = (state:ScoringState) => [...state.cues].sort((a,b)=>a.start-b.start || a.end-b.end)
const centisecond = (time:number) => Math.round(time*100)/100

export function editFilmCue(project:Project,id:string,changes:Partial<Pick<ScoringCue,'name'|'markdown'|'start'|'end'>>) {
    const state=readScoring(project), cue=state.cues.find(c=>c.id===id)
    if (!cue) throw new Error('Choose a cue.')
    const timing=changes.start!==undefined || changes.end!==undefined
    if (changes.name!==undefined && !changes.name.trim()) throw new Error('Enter a cue name.')
    const next={...(timing ? retimeFilmCue(cue,changes.start ?? cue.start,changes.end ?? cue.end) : cue),...changes}
    writeScoring(project,{...state,cues:state.cues.map(c=>c.id===id ? next : c)})
}
export function moveFilmCue(project:Project,id:string,start:number) {
    const cue=readScoring(project).cues.find(c=>c.id===id)
    if (!cue) return
    const at=Math.max(0,centisecond(start))
    editFilmCue(project,id,{start:at,end:at+(cue.end-cue.start)})
}
export function splitFilmCue(project:Project,id:string,at:number) {
    const state=readScoring(project), cue=state.cues.find(c=>c.id===id)
    if (!cue || !Number.isFinite(at) || at<=cue.start || at>=cue.end) throw new Error('Choose a split point inside the cue.')
    // A cue boundary edits the score sheet. Linked timeline performances keep their
    // existing owner; splitting a cue must not duplicate or discard an audio region.
    const {takes:_takes,takeParts:_parts,...annotations}=cue
    const right={...annotations,id:crypto.randomUUID(),name:nextCueName(state),start:at,autoEnd:false,
        ...(cue.analysisVideoStart!==undefined ? {analysisVideoStart:cue.analysisVideoStart+at-cue.start} : {}),
        ...(cue.analysisSections ? {analysisSections:croppedSections(cue,at,cue.end)} : {})}
    writeScoring(project,{...state,cues:state.cues.flatMap(c=>c.id===id ? [retimeFilmCue(cue,cue.start,at),right] : [c])})
    return right.id
}
function commandSummary(instructions:string[]) {
    const unique=[...new Set(instructions.filter(Boolean))]
    const full=unique.join('\n')
    if (full.length<=500) return full
    // Keep each source represented in a normal-length edit and its full text in the structured prompt.
    const budget=Math.floor((500-(unique.length-1))/unique.length)
    if (budget<4) return full.slice(0,248)+'…\n…'+full.slice(-249)
    return unique.map(text=>text.length>budget ? text.slice(0,budget-1)+'…' : text).join('\n')
}

export function mergeFilmCue(project:Project,id:string) {
    const state=readScoring(project), ordered=orderedCues(state), index=ordered.findIndex(c=>c.id===id)
    const cue=ordered[index], next=ordered[index+1]
    if (!cue || !next) throw new Error('Select a cue with a following cue.')
    const offset=readPictureReport(project)?.offset ?? currentFilm(project)?.offset ?? 0
    const analysisSections=[cue,next].flatMap(part=>sourceSections(part,offset).map(section=>({
        ...section,start:section.start+(part.start-cue.start),end:section.end+(part.start-cue.start)
    }))).sort((a,b)=>a.start-b.start || a.end-b.end)
    const instructions:string[]=[], notes=new Set<string>()
    for (const part of [cue,next]) {
        const sources=part.analysisSections?.map(section=>section.prompt)
        const authoredSummary=sources && commandSummary(sources)!==part.prompt
        instructions.push(...(sources && !authoredSummary ? sources : [part.prompt]))
        if (part.markdown || part.prompt) notes.add(part.markdown || part.prompt)
        if (authoredSummary && part.prompt && !part.markdown?.includes(part.prompt)) notes.add(part.prompt)
    }
    const markdown=[...notes].join('\n\n---\n\n'), prompt=commandSummary(instructions)
    const merged={...cue, end:Math.max(cue.end,next.end), autoEnd:false,markdown,prompt,analysisSections,
        takes:[...new Set([...(cue.takes ?? []),...(next.takes ?? [])])],takeParts:{...cue.takeParts,...next.takeParts}}
    writeScoring(project,{...state,cues:state.cues.filter(c=>c.id!==next.id).map(c=>c.id===id ? merged : c)})
}

/** Reorder annotations within the affected span, carrying their lengths and preserving
 * the gaps (or overlaps) between slots. Footage, audio regions and takes stay in place. */
export function reorderFilmCue(project:Project,id:string,targetId:string) {
    const state=readScoring(project), ordered=orderedCues(state)
    const from=ordered.findIndex(c=>c.id===id), to=ordered.findIndex(c=>c.id===targetId)
    if (from<0 || to<0 || from===to) return
    const first=Math.min(from,to),last=Math.max(from,to),slots=ordered.slice(first,last+1)
    const moved=[...slots]
    moved.splice(to-first,0,...moved.splice(from-first,1))
    let start=slots[0].start
    const updates=new Map<string,ScoringCue>()
    moved.forEach((cue,i)=>{
        const end=start+cue.end-cue.start
        if (start<0 || i>0 && start<=updates.get(moved[i-1].id)!.start) throw new Error('Separate overlapping cues before reordering.')
        updates.set(cue.id,{...cue,start,end,autoEnd:false})
        if (i+1<slots.length) start=end+slots[i+1].start-slots[i].end
    })
    writeScoring(project,{...state,cues:state.cues.map(cue=>updates.get(cue.id) ?? cue)})
}
