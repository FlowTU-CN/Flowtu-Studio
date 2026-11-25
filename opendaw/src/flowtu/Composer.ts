import {chooseFileDestination, saveCancelled} from './file-destination'
import {type Lifecycle, UUID} from '@opendaw/lib-std'
import {PPQN} from '@opendaw/lib-dsp'
import {type StudioService} from '../service/StudioService'
import {MetaData} from '@opendaw/studio-adapters'
import {tones,parseCommand,encodeMidi,harmonyLabel,type Tone,type Note} from './commands'
import {executeCommand,musicUnits,unitLabel} from './execute'
import {readContext,contextPosition,contextOrigin} from './context'
import './composer.css'

export function createComposer(service:StudioService,lifecycle:Lifecycle):HTMLElement {
    const root=document.createElement('section');root.className='flowtu-composer collapsed';root.setAttribute('aria-label','MIDI Composer')
    root.innerHTML=`<header><div><span class="compose-mark">✦</span><strong>Describe your next instrument</strong><span class="local-badge">Local Commands</span></div><button class="fold-compose" aria-expanded="true" aria-label="Collapse composer">Collapse</button></header>
      <div class="compose-body"><div class="compose-fields"><label>Target<select aria-label="Command target"><option value="new">New Instrument Track</option></select></label><label>Default instrument<select aria-label="Default instrument"></select></label><label>Bars<select aria-label="Number of bars"><option>2</option><option selected>4</option><option>8</option><option>16</option></select></label><span class="compose-engine">Tubular · FM Synth</span></div>
      <div class="compose-context"><label><input type="checkbox" checked aria-label="Follow Project Context">Follow Project Context</label><span class="context-summary" aria-live="polite"></span><button class="clear-context" title="Clear remembered settings without deleting notes. Supports Undo.">Reset Context</button></div>
      <div class="compose-input"><textarea aria-label="Music command" rows="2" maxlength="500" placeholder="e.g. Generate 4 bars of warm piano chords, D minor, 90 BPM"></textarea><button class="run-compose">Generate / Apply</button></div>
      <div class="compose-examples"><span>Try</span><button>Piano Chords</button><button>Add Bass</button><button>Ambient Pad</button><button>Add Reverb</button><button class="help-compose">Command Guide</button></div>
      <footer><output role="status" aria-live="polite">Double-click generated MIDI to edit notes. Supports instruments, bars, key, BPM, reverb and delay.</output><div><button class="download-midi" disabled>Download MIDI</button><button class="undo-compose" disabled>Undo</button><button class="redo-compose" disabled>Redo</button></div></footer></div>`
    const select=root.querySelector<HTMLSelectElement>('[aria-label="Command target"]')!,tone=root.querySelector<HTMLSelectElement>('[aria-label="Default instrument"]')!,bars=root.querySelector<HTMLSelectElement>('[aria-label="Number of bars"]')!
    const text=root.querySelector('textarea')!,output=root.querySelector('output')!,run=root.querySelector<HTMLButtonElement>('.run-compose')!,download=root.querySelector<HTMLButtonElement>('.download-midi')!
    const undo=root.querySelector<HTMLButtonElement>('.undo-compose')!,redo=root.querySelector<HTMLButtonElement>('.redo-compose')!
    const follow=root.querySelector<HTMLInputElement>('[aria-label="Follow Project Context"]')!,contextSummary=root.querySelector<HTMLElement>('.context-summary')!,clearContext=root.querySelector<HTMLButtonElement>('.clear-context')!
    for(const [key,value]of Object.entries(tones)){const option=document.createElement('option');option.value=key;option.textContent=value.label;tone.append(option)}
    const fields=root.querySelector('.compose-fields')!
    root.querySelector('header')!.insertBefore(fields,root.querySelector('.fold-compose'))
    tone.onchange=()=>{root.querySelector('.compose-engine')!.textContent=tones[tone.value as Tone].engine}
    let signature='',contextSignature='',variation=0,lastNotes:Note[]=[],lastBpm=120
    const refresh=()=>{
        if(!service.hasProfile)return
        const units=musicUnits(service.project),next=units.map(u=>`${UUID.toString(u.address.uuid)}:${unitLabel(service.project,u)}`).join('|')
        if(next!==signature){const previous=select.value;select.replaceChildren(new Option('New Instrument Track','new'),...units.map((u,i)=>new Option(`Track ${i+1} · ${unitLabel(service.project,u)}`,UUID.toString(u.address.uuid))));select.value=[...select.options].some(o=>o.value===previous)?previous:'new';signature=next}
        undo.disabled=!service.project.editing.canUndo();redo.disabled=!service.project.editing.canRedo()
        const context=readContext(service.project),nextContext=JSON.stringify(context)
        if(nextContext!==contextSignature){
            contextSignature=nextContext
            if(context&&follow.checked){if(![...bars.options].some(o=>Number(o.value)===context.bars))bars.add(new Option(String(context.bars)));bars.value=String(context.bars)}
        }
        const bpm=Math.round(service.project.timelineBox.bpm.getValue()),keyNames=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B']
        const summary=context?`${keyNames[context.tonic]} ${context.minor?'minor':'major'} · ${bpm} BPM · ${harmonyLabel(context.harmony)} · Aligned to ${context.sourceLabel}, bar ${Math.floor(contextPosition(service.project,context)/PPQN.Bar)+1}`:`${bpm} BPM · Key, chords and start position will follow your first generation`
        contextSummary.textContent=follow.checked?summary:`Independent generation · ${bpm} BPM · Key and chords are not inherited`
        clearContext.disabled=!context
    }
    const timer=setInterval(refresh,500);lifecycle.own({terminate:()=>clearInterval(timer)});refresh()
    const execute=()=>{
        if(!service.hasProfile)return
        try{
            const command=parseCommand(text.value,tone.value as Tone,Number(bars.value),follow.checked?readContext(service.project):undefined)
            const result=executeCommand(service.project,command,select.value,variation++)
            output.textContent=result.message+(command.usesContext&&result.notes.length?' · Project harmony applied':'');output.dataset.error='false';root.dataset.lastAction=command.action
            if(result.notes.length){lastNotes=result.notes;lastBpm=result.bpm;download.disabled=false;root.dataset.noteCount=String(lastNotes.length)
                service.timeline.range.showUnitInterval(0,Math.max(PPQN.Bar*8,service.project.lastRegionAction()+PPQN.Bar))}
            refresh()
            if(result.unitId)requestAnimationFrame(()=>root.parentElement?.querySelector(`[data-flowtu-unit="${result.unitId}"]`)?.scrollIntoView({block:'nearest'}))
        }catch(error){output.textContent=error instanceof Error?error.message:String(error);output.dataset.error='true'}
    }
    run.onclick=execute
    follow.onchange=()=>{contextSignature='';refresh()}
    clearContext.onclick=()=>{service.project.editing.modify(()=>MetaData.clear(service.project.rootBox,contextOrigin),true);output.textContent='Context reset. Existing notes retained.';refresh()}
    text.onkeydown=e=>{e.stopPropagation();if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();execute()}}
    // Keep transport shortcuts out of text entry and native selectors.
    root.addEventListener('keydown',e=>e.stopPropagation())
    undo.onclick=()=>{service.project.editing.undo();output.textContent='Last project edit undone';refresh()}
    redo.onclick=()=>{service.project.editing.redo();output.textContent='Last project edit redone';refresh()}
    download.onclick=async()=>{
        const bytes=encodeMidi(lastNotes,lastBpm)
        try {
            const dest=await chooseFileDestination('Flowtu-generated.mid')
            if (dest) await dest.write(new Blob([bytes],{type:'audio/midi'}))
        } catch (error) {if (!saveCancelled(error)) {output.textContent=String(error);output.dataset.error='true'}}
    }
    const examples=['Generate 4 bars of warm piano chords, D minor, 90 BPM, add 15% reverb','Add a bass','Add a soft ambient pad with 35% reverb','Add 25% reverb to the selected track']
    root.querySelectorAll<HTMLButtonElement>('.compose-examples button:not(.help-compose)').forEach((button,i)=>button.onclick=()=>{text.value=examples[i];text.focus()})
    const fold=root.querySelector<HTMLButtonElement>('.fold-compose')!
    fold.textContent='Expand';fold.setAttribute('aria-expanded','false');fold.setAttribute('aria-label','Expand composer')
    fold.onclick=()=>{const collapsed=root.classList.toggle('collapsed');fold.textContent=collapsed?'Expand':'Collapse';fold.setAttribute('aria-expanded',String(!collapsed));fold.setAttribute('aria-label',collapsed?'Expand composer':'Collapse composer')}
    const help=document.createElement('dialog');help.className='flowtu-help'
    help.innerHTML=`<h2>Local MIDI Commands</h2><p data-guide="guide.command.intro">This rule-based composer runs locally, without an AI model. Generated notes are editable MIDI, with playback, Undo and project saving.</p><ul><li>Generate 4 bars of piano chords, D minor, 90 BPM</li><li>Add a bass — follows the project key, chords and start position</li><li>Generate 4 bars of piano, D minor, chord progression: Dm Bb F C</li><li>Switch track 4 to bell</li><li>Add 25% reverb to track 2 / Disable reverb on track 2</li></ul><p data-guide="guide.command.context">Follow Project Context remembers the generated key, chords and reference clip; tempo follows the current project BPM. New instruments align with that clip. Existing tracks append new notes. Explicit key or chord changes update the context, which supports Undo and project saving. Manually edited notes and imported audio are not analyzed for harmony.</p><p data-guide="guide.command.support">Supports English or Chinese commands, 1–32 bars, major/minor keys, chords, arpeggios, melody and bass. Electric piano and bell use FM synthesis; other instruments use Vaporisateur. Sampled instruments and cloud presets are not connected.</p><button>Got It</button>`
    document.body.append(help);lifecycle.own({terminate:()=>help.remove()});help.querySelector('button')!.onclick=()=>help.close()
    root.querySelector<HTMLButtonElement>('.help-compose')!.onclick=()=>help.showModal()
    return root
}
