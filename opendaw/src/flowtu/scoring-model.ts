import {retainTimelineClip} from './media-retention'
import {type AnyRegionBoxAdapter, AudioRegionBoxAdapter, MetaData, NoteRegionBoxAdapter} from '@opendaw/studio-adapters'
import {AudioRegionBox, NoteRegionBox} from '@opendaw/studio-boxes'
import {UUID} from '@opendaw/lib-std'
import type {Project} from '@opendaw/studio-core'
import {PPQN} from '@opendaw/lib-dsp'
import {tones,parseCommand,type Tone, type Note} from './commands'
import {readDirection, type ScoreDirection} from './scoring-direction'
import {readContext} from './context'
import {executeCommand, unitLabel} from './execute'
import {referencePerformance} from './reference-performance'
import {isAssetLane} from './playback-lanes'

import type {CueAnalysisSection} from './cue-analysis'

type MusicDirection={start:number;end:number;prompt:string;tone:Tone;direction?:ScoreDirection;referenceId?:string}
export type ScoringCue=MusicDirection & {id:string;name?:string;analysisVideoStart?:number;analysisSections?:CueAnalysisSection[];markdown?:string;autoEnd?:boolean;takes?:string[];takeParts?:Record<string,string[]>}
export type ScoringState=MusicDirection & {cues:ScoringCue[]}
export const generationReferenceOrigin='flowtu:generation-reference:v1'
export const scoringOrigin='flowtu:video-scoring:v1'
const defaults=():ScoringState=>({start:0,end:8,prompt:'Generate warm piano chords, D minor, add 20% reverb',tone:'keys',cues:[]})

function sectionName(index:number):string {
    let name=''
    for(let n=index+1;n>0;n=Math.floor((n-1)/26)) name=String.fromCharCode(65+(n-1)%26)+name
    return name
}
function namedCues(cues:ScoringCue[]):Array<ScoringCue & {name:string}> {
    const taken=new Set<string>()
    for(const cue of cues) {
        if(cue.name===undefined) continue
        if(typeof cue.name!=='string'||!cue.name.trim()||cue.name.trim().length>64) throw new Error('Use a cue name between 1 and 64 characters.')
        const key=cue.name.trim().toUpperCase()
        if(taken.has(key)) throw new Error('Choose a different name for each cue.')
        taken.add(key)
    }
    let index=0
    return cues.map(cue=>{
        if(cue.name!==undefined) return {...cue,name:cue.name.trim()}
        let name=sectionName(index++)
        while(taken.has(name)) name=sectionName(index++)
        taken.add(name)
        return {...cue,name}
    })
}
export function cueLabel(state:ScoringState,cue:ScoringCue):string {
    return cue.name ?? namedCues(state.cues).find(item=>item.id===cue.id)?.name ?? ''
}
export function nextCueName(state:ScoringState):string {
    const taken=new Set(namedCues(state.cues).map(cue=>cue.name.toUpperCase()))
    let index=state.cues.length, name=sectionName(index)
    while(taken.has(name)) name=sectionName(++index)
    return name
}

function validatedRange(value:unknown):MusicDirection {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Choose a valid scoring range.')
    const {start,end,prompt,tone,referenceId}=value as ScoringState
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)throw new Error('Cue end must be after its start, in seconds.')
    if(typeof prompt!=='string'||prompt.length>500)throw new Error('Keep the cue description within 500 characters.')
    if(typeof tone!=='string'||!Object.hasOwn(tones,tone))throw new Error('Choose one of the available local instruments.')
    const direction = readDirection((value as ScoringState).direction)
    return {start,end,prompt:prompt.trim(),tone,...(direction ? {direction} : {}),
        ...(typeof referenceId==='string' && UUID.validateString(referenceId) ? {referenceId} : {})}
}
function validatedState(value:unknown):ScoringState {
    const range=validatedRange(value),{cues}=value as ScoringState
    if(!Array.isArray(cues)||cues.length>1000)throw new Error('Choose a valid cue list with no more than 1000 cues.')
    const ids=new Set<string>()
    return {...range,cues:namedCues(cues.map(cue=>{
        const item=validatedRange(cue),id=cue.id
        if(typeof id!=='string'||!id.trim()||id.length>128||ids.has(id))throw new Error('Every cue must have a unique identifier.')
        ids.add(id)
        const takes=Array.isArray(cue.takes) ? [...new Set(cue.takes.filter(UUID.validateString))] : []
        const occupied = new Set(takes)
        const parts: Record<string,string[]> = {}
        for (const root of takes) {
            const extra = cue.takeParts?.[root]
            if (!Array.isArray(extra)) continue
            const members = extra.filter(id => {
                if (!UUID.validateString(id) || occupied.has(id)) return false
                occupied.add(id); return true
            })
            if (members.length) parts[root] = members
        }
        const analysisSections = Array.isArray(cue.analysisSections) ? cue.analysisSections.filter(section => section &&
            Number.isFinite(section.start) && Number.isFinite(section.end) && section.end>section.start && Number.isFinite(section.videoStart) &&
            typeof section.name==='string' && typeof section.prompt==='string' && Object.hasOwn(tones,section.tone)) : undefined
        return {id,name:cue.name,...item,...(Number.isFinite(cue.analysisVideoStart) ? {analysisVideoStart:cue.analysisVideoStart!} : {}),...(analysisSections ? {analysisSections} : {}),...(typeof cue.markdown==="string" ? {markdown:cue.markdown} : {}),...(Object.keys(parts).length ? {takeParts:parts} : {}),...(cue.autoEnd===true ? {autoEnd:true} : {}),...(takes.length ? {takes} : {})}
    }))}
}
/** Only sections explicitly marked to follow the next cue are resized. */
function alignSectionEnds(cues:ScoringCue[]):ScoringCue[] {
    const starts=[...new Set(cues.map(cue=>cue.start))].sort((a,b)=>a-b)
    const nextStart=new Map(starts.slice(0,-1).map((start,index)=>[start,starts[index+1]]))
    return cues.map(cue=>{
        const next=nextStart.get(cue.start)
        return cue.autoEnd && next!==undefined ? {...cue,end:next} : cue
    })
}
/** Stored in the native project graph, so cues travel with project files and undo/redo. */
export function readScoring(project:Project):ScoringState {
    const data=MetaData.read(project.rootBox,scoringOrigin)
    try{return data&&typeof data==='object'&&!Array.isArray(data)&&data.version===1?validatedState(data):defaults()}catch{return defaults()}
}
export function writeScoring(project:Project,state:ScoringState):void {
    const value=validatedState(state)
    value.cues=alignSectionEnds(value.cues)
    const lastCueEnd=value.cues.reduce((last,cue)=>Math.max(last,cue.end),0)
    const requiredPulses=Math.ceil(project.tempoMap.secondsToPPQN(lastCueEnd))
    if(!Number.isSafeInteger(requiredPulses)||requiredPulses>0x7fffffff) throw new Error('Cue end exceeds the project timeline limit.')
    const duration=project.timelineBox.durationInPulses
    project.editing.modify(()=>{
        MetaData.store(project.rootBox,{version:1,...value},scoringOrigin)
        if(requiredPulses>duration.getValue()) duration.setValue(requiredPulses)
    },true)
}
export type ScoringTake = {id:string; number:number; name:string; track:string; start:number; end:number}

export function takeRegion(project:Project,id:string) {
    if (!UUID.validateString(id)) return undefined
    const box = project.boxGraph.findBox(UUID.parse(id)).unwrapOrNull()
    if (box instanceof AudioRegionBox) return project.boxAdapters.adapterFor(box,AudioRegionBoxAdapter)
    return box instanceof NoteRegionBox ? project.boxAdapters.adapterFor(box,NoteRegionBoxAdapter) : undefined
}

export function takeMembers(cue:ScoringCue, root:string):string[] {
    return [root,...(cue.takeParts?.[root] ?? [])]
}
export function takeOwner(cue:ScoringCue, regionId:string):string | undefined {
    return cue.takes?.find(id => id === regionId || cue.takeParts?.[id]?.includes(regionId))
}

export function updateTakeMembership(project: Project, regionId: string, rightId?: string) {
    const state = readScoring(project), cue = state.cues.find(item => takeOwner(item,regionId))
    if (!cue && (rightId || (state.referenceId !== regionId && !state.cues.some(c => c.referenceId === regionId)))) return
    let replacement: string | undefined, cues = state.cues
    if (cue) {
        const parent = takeOwner(cue,regionId)!, parts = takeMembers(cue,parent)
        parts.splice(parts.indexOf(regionId),1,...(rightId ? [regionId,rightId] : []))
        const takeParts = {...cue.takeParts}
        delete takeParts[parent]
        if (parts.length > 1) takeParts[parts[0]] = parts.slice(1)
        const takes = cue.takes!.flatMap(id => id !== parent ? [id] : parts.slice(0,1))
        replacement = parts[0]
        cues = state.cues.map(item => item.id === cue.id ? {...cue,takes,takeParts} : item)
    }
    if (!rightId) cues = cues.map(c => c.referenceId === regionId ? {...c,referenceId:replacement} : c)
    writeScoring(project,{...state,referenceId:!rightId && state.referenceId === regionId ? replacement : state.referenceId,cues})
}

export function deleteScoringRegion(project: Project, region: AnyRegionBoxAdapter, retainAsMedia = true) {
    if (region instanceof AudioRegionBoxAdapter || region instanceof NoteRegionBoxAdapter) {
        if (retainAsMedia) retainTimelineClip(project,region)
        updateTakeMembership(project,UUID.toString(region.uuid))
    }
    region.box.delete()
}

export function readScoringTakes(project:Project,session:ScoringCue|string):ScoringTake[] {
    const cue = typeof session === 'string' ? readScoring(project).cues.find(item=>item.id===session) : session
    return (cue?.takes ?? []).flatMap((id,index) => {
        const members = takeMembers(cue!,id).flatMap(part => takeRegion(project,part) ?? [])
        const region = members[0], track = region?.trackBoxAdapter.unwrapOrNull()
        if (!region || !track) return []
        return [{id, number:index+1, name:region.label, track:unitLabel(project,track.audioUnit),
            start:project.tempoMap.ppqnToSeconds(Math.min(...members.map(r => r.position))),
            end:project.tempoMap.ppqnToSeconds(Math.max(...members.map(r => r.complete)))}]
    })
}

/** Switch versions at region level so all other cues and track automation retain their mix. */
export function useScoringTake(project: Project, cueId: string, selectedId: string) {
    const cue = readScoring(project).cues.find(c => c.id === cueId)
    if (!cue?.takes?.includes(selectedId)) throw new Error('The take is no longer linked to this cue.')
    const playback = cue.takes.flatMap(id => {
        return takeMembers(cue,id).flatMap(part => {
            const region = takeRegion(project,part), lane = region?.trackBoxAdapter.unwrapOrNull()
            return region && lane && lane.enabled.getValue() && !isAssetLane(lane) ? [{id,region}] : []
        })
    })
    if (!playback.some(t => t.id === selectedId)) throw new Error('Enable the take on the timeline before using it.')
    project.editing.modify(() => {
        for (const {id, region} of playback) region.box.mute.setValue(id !== selectedId)
    },true)
}

export function focusScoringTake(project:Project,id:string,{openEditor=true}={}) {
    const region = takeRegion(project,id), track = region?.trackBoxAdapter.unwrapOrNull()
    if (!region || !track) throw new Error('This region is no longer on the timeline.')
    project.editing.modify(() => {
        project.userEditingManager.audioUnit.edit(track.audioUnit.editing)
        if (openEditor) project.userEditingManager.timeline.edit(region.box)
    }, false)
    project.regionSelection.deselectAll()
    project.regionSelection.select(region)
    project.timelineFocus.focusRegion(region)
    return {start:region.position, end:region.complete}
}

function selectedAssetId(project:Project) {
    const selected=project.regionSelection.selected()
    const region=selected[0]
    if (selected.length===1 && (region instanceof NoteRegionBoxAdapter || region instanceof AudioRegionBoxAdapter) && region.trackBoxAdapter.nonEmpty())
        return UUID.toString(region.uuid)
    return undefined
}

function appendTake(cues:ScoringCue[],cueId:string,regionId:string):ScoringCue[] {
    return cues.map(cue=>cue.id===cueId ? {...cue,takes:[...(cue.takes ?? []),regionId]} : cue)
}

export function canLinkSelectedScoringTake(project:Project,cueId:string,state?:ScoringState):boolean {
    const id=selectedAssetId(project)
    if (!id) return false
    const {cues}=state ?? readScoring(project)
    return cues.some(cue=>cue.id===cueId) && !cues.some(cue=>takeOwner(cue,id))
}

export function linkSelectedScoringTake(project:Project,cueId:string):string {
    const id=selectedAssetId(project)
    if (!id) throw new Error('Select one audio or MIDI region on the timeline.')
    const state=readScoring(project), cue=state.cues.find(item=>item.id===cueId)
    if (!cue) throw new Error('Choose a session that is still in this project.')
    const owner=state.cues.find(item=>takeOwner(item,id))
    if (owner?.id===cueId) return id
    if (owner) throw new Error(`This region already belongs to Session ${cueLabel(state,owner)}.`)
    writeScoring(project,{...state,cues:appendTake(state.cues,cueId,id)})
    return id
}

/** Create the MIDI region and record its native UUID in the session in one undo step. */
export function generateScoringMidi(project:Project,input:MusicDirection & {id?:string},selectedCueId=input.id, composedNotes?:Note[]) {
    const range=validatedRange(input)
    if (!range.prompt) throw new Error('Describe the music before generating MIDI.')
    const state=readScoring(project)
    const selected=state.cues.find(item=>item.id===selectedCueId)
    if (selectedCueId && !selected) throw new Error('Choose a session that is still in this project.')
    const direction = Object.hasOwn(input, 'direction') ? range.direction : (selected ?? state).direction
    const referenceId = Object.hasOwn(input,'referenceId') ? range.referenceId : (selected ?? state).referenceId
    const cue=selected ?? {id:crypto.randomUUID(),name:nextCueName(state),autoEnd:!referenceId,...range,direction,referenceId}
    const cues=selected ? state.cues.map(item => item.id === selected.id ? {...item,referenceId} : item) : alignSectionEnds([...state.cues,cue].sort((a,b)=>a.start-b.start))
    const {start,end,prompt,tone}=selected ? range : cues.find(item=>item.id===cue.id)!
    const position=Math.round(project.tempoMap.secondsToPPQN(start)),complete=Math.round(project.tempoMap.secondsToPPQN(end)),duration=complete-position
    const bars=Math.ceil(duration/PPQN.Bar)
    if(duration<1||position<0||complete>0x7fffffff||bars>32)throw new Error('Select a cue between one timeline tick and 32 bars. Split longer sections into multiple cues.')
    // An external score supplies authored notes. Keep the native tone and project harmony
    // without running the provider's free-form description through the local command grammar.
    const parsed=parseCommand(composedNotes ? 'Generate' : prompt,tone,bars,readContext(project),Boolean(direction || referenceId))
    if(parsed.action!=='generate')throw new Error('Use a note generation command, such as “Generate warm piano chords”.')
    if(parsed.target!==undefined)throw new Error('Cue generation adds a new instrument track. Remove the track number from this command.')
    if(parsed.bpm!==undefined&&Math.abs(parsed.bpm-project.timelineBox.bpm.getValue())>.00001)throw new Error('Set the project BPM in the transport before generating a cue. Cue commands keep the existing tempo and video alignment.')
    // The selected video range determines the length, even when the prompt contains a bar count.
    const command={...parsed,bars,bpm:undefined}
    const reference = referenceId && takeRegion(project,referenceId)
    if (referenceId && !reference) throw new Error('The reference was removed. Choose another asset or clear the reference.')
    const variation = cue.takes?.length ?? 0
    const notes = composedNotes ?? (reference ? referencePerformance(reference,command,duration,variation) : undefined)
    return project.editing.modify(() => {
        const result=executeCommand(project,command,'new',variation,{position,duration,direction:composedNotes ? undefined : direction,notes})
        const {regionId}=result
        if (!regionId) throw new Error('The generation did not produce a MIDI region.')
        if (reference) MetaData.store(takeRegion(project,regionId)!.box,
            {id:UUID.toString(reference.uuid),name:reference.label}, generationReferenceOrigin)
        writeScoring(project,{...state,start,end,prompt,tone,direction,referenceId,cues:appendTake(cues,cue.id,regionId)})
        return {...result,regionId,cueId:cue.id}
    }).unwrap()
}
