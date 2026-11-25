import {setUnitTone, toneFactory} from "./track-sound"
import {shapeScoringNotes, type ScoreDirection} from './scoring-direction'
import {AudioUnitBox, TrackBox, ReverbDeviceBox, DelayDeviceBox} from '@opendaw/studio-boxes'
import {AudioUnitBoxAdapter, MetaData, TrackType} from '@opendaw/studio-adapters'
import {EffectFactories, type Project} from '@opendaw/studio-core'
import {PPQN} from '@opendaw/lib-dsp'
import {UUID} from '@opendaw/lib-std'
import {tones, generateNotes, harmonyFor, type Command, type Note} from './commands'
import {readContext,contextPosition,contextOrigin} from './context'

export const musicUnits = (project: Project) => project.rootBox.audioUnits.pointerHub.incoming()
    .map(p=>p.box as AudioUnitBox).filter(unit=>unit.tracks.pointerHub.incoming().some(p=>[TrackType.Audio,TrackType.Notes].includes((p.box as TrackBox).type.getValue())))
    .sort((a,b)=>a.index.getValue()-b.index.getValue())
export const unitLabel = (project:Project,unit:AudioUnitBox) => project.boxAdapters.adapterFor(unit,AudioUnitBoxAdapter).label
function configureEffects(project:Project,unit:AudioUnitBox,c:Command) {
    for(const kind of ['reverb','delay'] as const){
        const amount=c[kind];if(amount===undefined)continue
        const existing=unit.audioEffects.pointerHub.incoming().map(p=>p.box).find(b=>kind==='reverb'?b instanceof ReverbDeviceBox:b instanceof DelayDeviceBox)
        if(c.removeEffect){if(existing)existing.delete();continue}
        const effect=existing??project.api.insertEffect(unit.audioEffects,kind==='reverb'?EffectFactories.Reverb:EffectFactories.Delay)
        if(effect instanceof ReverbDeviceBox||effect instanceof DelayDeviceBox){
            effect.enabled.setValue(true);effect.wet.setValue(amount===0?-60:20*Math.log10(amount));effect.dry.setValue(0)
            if(effect instanceof ReverbDeviceBox)effect.decay.setValue(c.warm?.6:.75)
        }
    }
}
/** Optional exact pulse bounds for a video cue; ordinary composer calls still append whole bars. */
export type CommandPlacement={position:number;duration:number;direction?:ScoreDirection;notes?:Note[]}
export function executeCommand(project:Project,c:Command,targetId:string,variation:number,placement?:CommandPlacement):{message:string;notes:Note[];bpm:number;unitId?:string;regionId?:string} {
    if(placement&&(!Number.isInteger(placement.position)||placement.position<0||!Number.isInteger(placement.duration)||placement.duration<1||placement.duration>32*PPQN.Bar||placement.position+placement.duration>0x7fffffff))throw new Error('Choose a valid cue range of at most 32 bars.')
    const units=musicUnits(project)
    let target=c.target!==undefined?units[c.target-1]:units.find(u=>UUID.toString(u.address.uuid)===targetId)
    if(c.target!==undefined&&!target)throw new Error(`Track ${c.target} does not exist. This project has ${units.length} instrument/audio tracks.`)
    if(c.action==='effect'||c.action==='tone'){
        target??=units.find(u=>project.userEditingManager.audioUnit.isEditing(u.editing))??units.at(-1)
        if(!target)throw new Error('Add or select a track first.')
    }
    let noteTrack=target?.tracks.pointerHub.incoming().map(p=>p.box as TrackBox).find(t=>t.type.getValue()===TrackType.Notes)
    if(target&&(c.action==='generate'||c.action==='tone')&&!noteTrack)throw new Error('This is an audio track. Select New Instrument Track or an existing MIDI track.')
    const factory=toneFactory(c.tone)
    const generated=c.action==='generate'?shapeScoringNotes(placement?.notes ?? generateNotes(c,variation),placement?.direction):[]
    const notes=placement?generated.flatMap(note=>{
        const start=Math.round(note.beat*PPQN.Quarter),duration=Math.min(Math.round(note.length*PPQN.Quarter),placement.duration-start)
        return start<placement.duration&&duration>0?[{...note,beat:start/PPQN.Quarter,length:duration/PPQN.Quarter}]:[]
    }):generated
    const inherited=c.usesContext?readContext(project):undefined
    const creatingNew=!target
    let regionId:string|undefined
    project.editing.modify(()=>{
        if(c.bpm!==undefined)project.api.setBpm(c.bpm)
        if(c.action==='tempo')return
        if(!target){
            const product=project.api.createAnyInstrument(factory)
            target=product.audioUnitBox;noteTrack=product.trackBox
            product.instrumentBox.label.setValue(tones[c.tone].label)
            target.volume.setValue(-15)
        }
        const unit=target!
        if(c.action==='generate'||c.action==='tone'){
            setUnitTone(project,unit,c.tone,c.warm,c.action==='tone')
        }
        configureEffects(project,unit,c)
        if(notes.length&&noteTrack){
            let position=placement?.position??(creatingNew&&inherited?contextPosition(project,inherited):project.engine.position.getValue())
            if(!placement){
                for(const p of noteTrack.regions.pointerHub.incoming()){
                    const region=p.box as unknown as {position:{getValue():number};duration:{getValue():number}}
                    position=Math.max(position,region.position.getValue()+region.duration.getValue())
                }
                position=Math.ceil(position/PPQN.Bar)*PPQN.Bar
            }
            const duration=placement?.duration??c.bars*PPQN.Bar
            const region=project.api.createNoteRegion({trackBox:noteTrack,position,duration,name:`${tones[c.tone].label} · ${placement?'Cue':`${c.bars} bars`}`})
            regionId=UUID.toString(region.address.uuid)
            for(const note of notes)project.api.createNoteEvent({owner:region,position:Math.round(note.beat*PPQN.Quarter),duration:Math.round(note.length*PPQN.Quarter),pitch:note.pitch,velocity:note.velocity})
            region.hue.setValue(c.pattern==='chords'?29:207)
            MetaData.store(project.rootBox,inherited?{...inherited,bars:c.bars}:{version:1,tonic:c.tonic,minor:c.minor,bars:c.bars,harmony:harmonyFor(c),regionId:UUID.toString(region.address.uuid),sourceLabel:tones[c.tone].label},contextOrigin)
        }
        project.userEditingManager.audioUnit.edit(unit.editing)
    },true)
    const bpm=project.timelineBox.bpm.getValue()
    const name=target?unitLabel(project,target):''
    const effects=[c.reverb!==undefined?`${c.removeEffect?'Removed ':'Set '}reverb${c.removeEffect?'':` ${Math.round(c.reverb*100)}%`}`:'',c.delay!==undefined?`${c.removeEffect?'Removed ':'Set '}delay${c.removeEffect?'':` ${Math.round(c.delay*100)}%`}`:''].filter(Boolean)
    const message=c.action==='generate'?`${name} · Created ${placement?'MIDI cue':`${c.bars} bars`} / ${notes.length} notes${effects.length?' · '+effects.join(', '):''}`
        :c.action==='tone'?`${name} · Instrument changed${effects.length?' · '+effects.join(', '):''}`:c.action==='tempo'?`Project tempo set to ${bpm} BPM`:`${name} · ${effects.join(', ')}`
    return {message,notes,bpm,unitId:target?UUID.toString(target.address.uuid):undefined,regionId}
}
