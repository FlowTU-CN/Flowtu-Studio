import {NoteRegionBoxAdapter, AudioRegionBoxAdapter, AudioUnitBoxAdapter, type Sample} from '@opendaw/studio-adapters'
import {AudioFileBox, NoteEventCollectionBox, ValueEventCollectionBox} from '@opendaw/studio-boxes'
import {type Project} from '@opendaw/studio-core'
import {UUID} from '@opendaw/lib-std'
import {PPQN, TimeBase, type AudioData} from '@opendaw/lib-dsp'
import {editLiteClip} from './lite-clip-edit'
import {takeRegion} from './scoring-model'
import {getExplicitTimelineSelection} from './timeline-selection'
import type {Note} from './commands'

export type Span = {start:number; end:number}
type Material = {notes:Note[]} | {sample:Sample}
export function replacementSpan(project:Project, id:string):Span {
    const region=takeRegion(project,id)
    if (!region) throw new Error('Select an audio or MIDI clip.')
    const track=region.trackBoxAdapter.unwrap()
    if (project.audioUnitFreeze.isFrozen(project.boxAdapters.adapterFor(track.audioUnit,AudioUnitBoxAdapter))) throw new Error('Unfreeze this track first.')
    const range=getExplicitTimelineSelection(project)
    if (range?.track && range.track!==track) throw new Error('Select a range on the same track as the clip.')
    const start=Math.max(region.position,range?.start ?? region.position)
    const end=Math.min(Math.round(region.complete),range?.end ?? Math.round(region.complete))
    if (end<=start) throw new Error('Select a time range inside the clip.')
    return {start,end}
}

// Keep the middle region ID so cue takes, references and clip selection continue to point into the arrangement.
export function replaceInside(project:Project,id:string,span:Span,material:Material,title:string) {
    const original=takeRegion(project,id)
    if (!original || span.start<original.position || span.end>Math.round(original.complete) || span.start>=span.end) throw new Error('The clip has changed. Select the range again.')
    if (('sample' in material)!==(original instanceof AudioRegionBoxAdapter)) throw new Error('The replacement does not match the selected track.')
    return project.editing.modify(()=>{
        let middle=id
        if (span.end<Math.round(original.complete)) editLiteClip(project,id,'split',span.end)
        if (span.start>original.position) middle=editLiteClip(project,id,'split',span.start)!
        const region=takeRegion(project,middle)!
        if (region instanceof NoteRegionBoxAdapter && 'notes' in material) {
            const old=region.optCollection.unwrap()
            if(old.box.owners.pointerHub.incoming().length===1) {
                for(const event of old.events.asArray().slice()) event.box.delete()
            } else region.box.events.refer(NoteEventCollectionBox.create(project.boxGraph,UUID.generate()).owners)
            region.box.loopOffset.setValue(0)
            region.box.loopDuration.setValue(span.end-span.start)
            for (const note of material.notes) {
                const position=Math.round(note.beat*PPQN.Quarter)
                const duration=Math.min(span.end-span.start-position,Math.max(1,Math.round(note.length*PPQN.Quarter)))
                if (duration>0) project.api.createNoteEvent({owner:region.box,position,duration,pitch:note.pitch,velocity:note.velocity})
            }
        } else if (region instanceof AudioRegionBoxAdapter && 'sample' in material) {
            const {sample}=material, uuid=UUID.parse(sample.uuid)
            const file=project.boxGraph.findBox<AudioFileBox>(uuid).unwrapOrElse(()=>AudioFileBox.create(project.boxGraph,uuid,b=>{
                b.fileName.setValue(sample.name); b.endInSeconds.setValue(sample.duration)
            }))
            // The reusable replacement sample must survive Undo so Redo can resolve the same resource.
            const box=region.box, seconds=project.tempoMap.intervalToSeconds(span.start,span.end)
            box.file.refer(file)
            box.playMode.defer()
            const old=region.optCollection.unwrapOrNull()
            if(old && old.box.owners.pointerHub.incoming().length===1) {
                for(const event of old.events.asArray().slice()) event.box.delete()
            } else if(old) box.events.refer(ValueEventCollectionBox.create(project.boxGraph,UUID.generate()).owners)
            box.timeBase.setValue(TimeBase.Seconds)
            box.duration.setValue(seconds); box.loopDuration.setValue(seconds)
            box.waveformOffset.setValue(0); box.loopOffset.setValue(0); box.gain.setValue(0)
            region.fading.inField.setValue(0); region.fading.outField.setValue(0)
        }
        region.box.label.setValue(title)
        project.regionSelection.deselectAll()
        project.regionSelection.select(region)
        project.timelineFocus.focusRegion(region)
        return middle
    },true).unwrap()
}

export function audioEdit(prompt:string) {
    const db=prompt.replaceAll('−','-').match(/([+-]?\d+(?:\.\d+)?)\s*d[bB]/i)
    const reverse=/倒放|反转|reverse/i.test(prompt), fadeIn=/淡入|fade[ -]?in/i.test(prompt), fadeOut=/淡出|fade[ -]?out/i.test(prompt)
    const mute=/静音|消音|silence|\bmute\b/i.test(prompt), echo=/回声|echo/i.test(prompt)
    const gain=db ? Number(db[1]) : /轻一点|轻些|小声|降低音量|quieter|softer/i.test(prompt) ? -6
        : /大声|响一点|增大音量|louder/i.test(prompt) ? 6 : 0
    if (gain>24 || gain< -90) throw new Error('Use a gain between −90 dB and +24 dB.')
    if (db || reverse || fadeIn || fadeOut || mute || echo || gain) return {reverse,fadeIn,fadeOut,mute,echo,gain}
    return undefined
}
export function processAudio(audio:AudioData,edit:NonNullable<ReturnType<typeof audioEdit>>) {
    const gain=edit.mute?0:10**(edit.gain/20), last=Math.max(1,audio.numberOfFrames-1)
    for (const channel of audio.frames) {
        if (edit.reverse) channel.reverse()
        const delay=Math.round(audio.sampleRate*.16)
        if (edit.echo) for (let n=channel.length-1;n>=delay;n--) channel[n]+=channel[n-delay]*.35
        for (let n=0;n<channel.length;n++) channel[n]*=gain*(edit.fadeIn?n/last:1)*(edit.fadeOut?1-n/last:1)
    }
    return audio
}
