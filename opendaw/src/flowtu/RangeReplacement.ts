import {AudioRegionBoxAdapter, type Sample} from '@opendaw/studio-adapters'
import {type AudioData, PPQN, WavFile} from '@opendaw/lib-dsp'
import {Progress, UUID} from '@opendaw/lib-std'
import type {Project} from '@opendaw/studio-core'
import type {StudioService} from '../service/StudioService'
import {parseCommand, generateNotes, type Note} from './commands'
import {readContext} from './context'
import {executeCommand} from './execute'
import {requestLiteGuide} from './lite-model'
import {readLiteMusicContext, shapeLiteTransition} from './lite-music-context'
import {renderAsset} from './take-audition'
import {takeRegion} from './scoring-model'
import {audioEdit, processAudio, replaceInside, replacementSpan, type Span} from './range-replacement-edit'
import {timeSettings} from './time-settings'
import {formatTimelineTime,getFrameRate} from './time-format'
import {studioLanguage} from './studio-language'
import './range-replacement.css'

type Material = {notes:Note[]} | {sample:Sample}
async function prepare(service:StudioService,project:Project,id:string,span:Span,prompt:string,signal:AbortSignal) {
    const source=takeRegion(project,id)!, rate=service.audioContext.sampleRate
    const title=prompt.trim().slice(0,80)
    const scratch=project.copy()
    try {
        let material:Material, print:AudioData|undefined
        const edit=source instanceof AudioRegionBoxAdapter && audioEdit(prompt)
        if (edit) {
            print=processAudio(await renderAsset(project,id,rate,signal,[id],span,true), edit)
        } else {
            const duration=span.end-span.start
            if (duration>PPQN.Bar*32) throw new Error('Select up to 32 bars for a new musical phrase.')
            const range={start:project.tempoMap.ppqnToSeconds(span.start),end:project.tempoMap.ppqnToSeconds(span.end),prompt}
            const custom=await requestLiteGuide(project,range,signal)
            const context=readLiteMusicContext(project,range.start,range.end)
            const bars=Math.max(1,Math.ceil(duration/PPQN.Bar))
            const command=parseCommand(custom ? 'generate keys' : prompt,'keys',bars,readContext(project),true)
            // This request owns only the selection. A tempo/track mentioned in text cannot change the live project.
            Object.assign(command,{action:'generate',target:undefined,bpm:undefined,bars})
            const generated=executeCommand(scratch,command,'new',0,{position:span.start,duration,notes:custom ?? generateNotes(command)})
            if (!generated.regionId) throw new Error('No playable notes were generated.')
            const guide=generated.regionId
            scratch.editing.modify(()=>shapeLiteTransition(scratch,guide,context))
            if (source instanceof AudioRegionBoxAdapter) print=await renderAsset(scratch,guide,rate,signal)
            const region=takeRegion(scratch,guide)!
            if (!region.isNoteRegion()) throw new Error('Missing MIDI phrase.')
            material={notes:region.optCollection.unwrap().events.asArray().map(n=>({beat:n.position/PPQN.Quarter,length:n.duration/PPQN.Quarter,pitch:n.pitch,velocity:n.velocity}))}
        }
        signal.throwIfAborted()
        if (print) {
            const sample=await service.sampleService.importFile({name:title,bpm:0,arrayBuffer:WavFile.encodeFloats(print),progressHandler:Progress.Empty})
            await service.sampleManager.getAudioData(UUID.parse(sample.uuid))
            material={sample}
        }
        signal.throwIfAborted()
        const candidate=replaceInside(scratch,id,span,material!,title)
        const audio=await renderAsset(scratch,candidate,rate,signal)
        return {material:material!,audio,title}
    } finally {scratch.terminate()}
}

// Edits elsewhere, engine bookkeeping and focus changes can produce editing notifications
// during a bounce. Only invalidate when the material being replaced or its timing changes.
function sourceSignature(project:Project,id:string,span:Span) {
    const r=takeRegion(project,id)
    if (!r) return ''
    const bytes=(box:{toArrayBuffer():ArrayBufferLike})=>Array.from(new Uint8Array(box.toArrayBuffer()))
    const events=r.optCollection.unwrapOrNull()?.events.asArray().map(e=>bytes(e.box))
    return JSON.stringify([bytes(r.box),events,project.tempoMap.ppqnToSeconds(span.start),project.tempoMap.ppqnToSeconds(span.end)])
}

export function openReplacement(service:StudioService,id:string) {
    if (document.querySelector('.ft-range-replacement')) return
    const project=service.project, original=takeRegion(project,id), span=replacementSpan(project,id)
    if (!original) throw new Error('Select one audio or MIDI clip.')
    const zh=studioLanguage()==='zh-CN'
    const label=(en:string,cn:string)=>zh?cn:en
    const dialog=document.createElement('dialog')
    dialog.className='ft-range-replacement'
    const heading=document.createElement('h2'), info=document.createElement('p'), input=document.createElement('textarea')
    const status=document.createElement('output'), buttons=document.createElement('footer')
    heading.textContent=label('Replace selection','局部替换')
    const time=(tick:number)=>formatTimelineTime(project.tempoMap.ppqnToSeconds(tick),timeSettings.display,getFrameRate(timeSettings.fps))
    info.textContent=original.label+' · '+time(span.start)+' — '+time(span.end)
    input.maxLength=500; input.rows=3
    input.placeholder=original instanceof AudioRegionBoxAdapter ? label('Try “−6 dB”, “fade out” or “a sparse piano phrase”','试试「轻一点」「淡出」或「换成稀疏的钢琴和弦」') : label('Describe the new musical phrase','描述要替换成的乐句')
    input.setAttribute('aria-label',label('Replacement instruction','替换要求'))
    const make=(en:string,cn:string)=>{const b=document.createElement('button'); b.type='button'; b.textContent=label(en,cn);buttons.append(b);return b}
    const cancel=make('Cancel','取消'), preview=make('Preview','试听'), apply=make('Use replacement','采用替换')
    apply.disabled=true;status.setAttribute('role','status')
    dialog.setAttribute('aria-label',heading.textContent);dialog.append(heading,info,input,status,buttons); document.body.append(dialog)
    let job:AbortController|undefined, prepared:Awaited<ReturnType<typeof prepare>>|undefined, playing:AudioBufferSourceNode|undefined
    const stop=()=>{if (playing) {playing.onended=null;playing.stop();playing.disconnect();playing=undefined}}
    let stale=false
    const reset=()=>{job?.abort();prepared=undefined;stop();apply.disabled=true;preview.disabled=false}
    const signature=sourceSignature(project,id,span)
    const changed=()=>{
        if (stale || service.hasProfile && service.project===project && sourceSignature(project,id,span)===signature) return
        stale=true;reset();preview.disabled=true;status.textContent=label('The project changed. Reopen the selection.','工程已更改，请重新选择片段。')}
    const watch=project.editing.subscribe(changed), profile=service.projectProfileService.subscribe(changed)
    dialog.addEventListener('close',()=>{watch.terminate();profile.terminate();reset();dialog.remove()},{once:true})
    input.oninput=()=>{if(!stale){reset();status.textContent=''}}
    cancel.onclick=()=>dialog.close()
    preview.onclick=async()=>{
        if (!input.value.trim() || stale) {input.focus();return}
        stop()
        const controller=new AbortController();job=controller
        preview.disabled=true
        try {
            await service.audioContext.resume()
            if(service.engine.isPlaying.getValue())service.engine.stop()
            status.textContent=label('Preparing preview…','正在准备试听…')
            const result=prepared ?? await prepare(service,project,id,span,input.value,controller.signal)
            controller.signal.throwIfAborted()
            prepared=result
            const {audio}=prepared, context=service.audioContext
            const buffer=context.createBuffer(audio.numberOfChannels,audio.numberOfFrames,audio.sampleRate)
            audio.frames.forEach((data,i)=>buffer.getChannelData(i).set(data))
            playing=context.createBufferSource();playing.buffer=buffer;playing.connect(context.destination)
            const source=playing;source.onended=()=>{source.disconnect();if(playing===source)playing=undefined};source.start()
            apply.disabled=false;status.textContent=label('Preview ready. Apply to keep this take.','试听已就绪，点击「采用替换」写入工程。')
        } catch(error) {if (!controller.signal.aborted) status.textContent=error instanceof Error?error.message:String(error)}
        finally {if (!controller.signal.aborted) preview.disabled=false}
    }
    apply.onclick=()=>{
        changed()
        if (!prepared || stale || !service.hasProfile || service.project!==project) return
        const take=prepared
        try {replaceInside(project,id,span,take.material,take.title);dialog.close()}
        catch(error){status.textContent=String(error)}
    }
    dialog.showModal();input.focus()
}
