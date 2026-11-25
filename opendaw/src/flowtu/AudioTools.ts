import {setClipGain} from "./ClipGain"
import {installControlReset} from "@/ui/hooks/control-reset"
import {crossfades, crossfadeCurveMode, curveProgress, freeAudioLane, linkCrossfade, setCrossfadeCurveMode, type CrossfadeCurveMode} from "./crossfades"
import {AudioRegionBox,AudioUnitBox,TrackBox} from '@opendaw/studio-boxes'
import {AudioRegionBoxAdapter,AudioUnitBoxAdapter,TrackBoxAdapter,TrackType} from '@opendaw/studio-adapters'
import {type StudioService} from '../service/StudioService'
import {PPQN} from '@opendaw/lib-dsp'
import {UUID} from '@opendaw/lib-std'
import {fitFade,planCrossfade} from './fades'
import './audio-tools.css'

type Entry={id:string;region:AudioRegionBoxAdapter;track:TrackBox;unit:AudioUnitBox;label:string}
const slopes={linear:[.5,.5],soft:[.75,.25],slow:[.25,.75]} as const
export function installAudioTools(service:StudioService,bar:HTMLElement) {
    const toggle=document.createElement('button');toggle.textContent='Clip Inspector';toggle.dataset.action='audio-tools';toggle.setAttribute('aria-expanded','false')
    bar.querySelector('[data-action=audio]')!.after(toggle)
    const panel=document.createElement('aside');panel.className='flowtu-audio-tools';panel.hidden=true;panel.setAttribute('aria-label','Audio clip tools')
    panel.innerHTML=`<header><strong>Clip Inspector <small>FADES / GAIN</small></strong><button aria-label="Close clip inspector">Close</button></header>
    <div class="audio-tools-body"><p class="fade-hint">Drag a square to set the fade length. Drag the round point on either curve to shape that fade.</p>
    <label class="clip-picker">Clip A<select aria-label="Fade clip A"></select></label>
    <fieldset class="clip-controls"><legend>Clip Gain</legend><div class="clip-gain"><input aria-label="Clip gain fader" type="range" min="-60" max="12" step="0.1" value="0"><input aria-label="Clip gain dB" type="number" min="-60" max="12" step="0.1" value="0"><span>dB</span><button class="reset-gain">Reset</button></div>
    <div class="fade-inputs"><label>Fade In<input aria-label="Fade in milliseconds" type="number" min="0" step="10" value="0"><span>ms</span></label><label>Fade Out<input aria-label="Fade out milliseconds" type="number" min="0" step="10" value="0"><span>ms</span></label></div>
    <div class="fade-curve"><label>Curve<select aria-label="Fade curve"><option value="linear">Linear</option><option value="soft">Soft</option><option value="slow">Ease</option><option value="custom" disabled>Custom</option></select></label><button class="reset-fades">Reset Fades</button></div></fieldset>
    <section class="crossfade-tools"><h3>Crossfade <span>A / B</span></h3><label class="clip-picker">Clip B<select aria-label="Crossfade clip B"></select></label>
    <div class="crossfade-options"><select aria-label="Crossfade mode"><option value="overlap">Use Existing Overlap</option><option value="join">Move B to Join A</option></select><label><input aria-label="Crossfade milliseconds" type="number" min="1" max="60000" step="10" value="200"> ms</label></div>
    <label class="clip-picker">Curve<select aria-label="Crossfade curve"><option value="linear">Linear</option><option value="constant-power">Constant power</option><option value="custom">Custom</option></select></label>
    <svg class="crossfade-preview" viewBox="0 0 300 56" role="img" aria-label="Crossfade curve preview"><path d="M8 8V48H292" fill="none" stroke="#3c536a"/><polyline class="curve-a" fill="none" stroke="#ff9b47" stroke-width="2"/><polyline class="curve-b" fill="none" stroke="#5aaff8" stroke-width="2"/><text x="12" y="16" fill="#ffba83">A</text><text x="278" y="16" fill="#8ac9ff">B</text></svg>
    <p class="crossfade-plan"></p><button class="apply-crossfade">Apply Crossfade</button></section>
    <footer><output role="status" aria-live="polite">Import audio to adjust clip gain and fades.</output><div><button class="undo-audio">Undo</button><button class="redo-audio">Redo</button></div></footer></div>`
    document.body.append(panel)
    const footer=panel.querySelector('footer')!
    footer.prepend(panel.querySelector('.apply-crossfade')!)
    panel.append(footer)
    const a=panel.querySelector<HTMLSelectElement>('[aria-label="Fade clip A"]')!,b=panel.querySelector<HTMLSelectElement>('[aria-label="Crossfade clip B"]')!,curve=panel.querySelector<HTMLSelectElement>('[aria-label="Fade curve"]')!,mode=panel.querySelector<HTMLSelectElement>('[aria-label="Crossfade mode"]')!
    const gain=panel.querySelector<HTMLInputElement>('[aria-label="Clip gain fader"]')!,db=panel.querySelector<HTMLInputElement>('[aria-label="Clip gain dB"]')!,fadeIn=panel.querySelector<HTMLInputElement>('[aria-label="Fade in milliseconds"]')!,fadeOut=panel.querySelector<HTMLInputElement>('[aria-label="Fade out milliseconds"]')!,crossMs=panel.querySelector<HTMLInputElement>('[aria-label="Crossfade milliseconds"]')!
    const output=panel.querySelector('output')!,apply=panel.querySelector<HTMLButtonElement>('.apply-crossfade')!,undo=panel.querySelector<HTMLButtonElement>('.undo-audio')!,redo=panel.querySelector<HTMLButtonElement>('.redo-audio')!
    let entries:Entry[]=[],signature='',selectionSignature='',projectIdentity:unknown
    const tell=(message:string,error=false)=>{output.textContent=message;output.dataset.error=String(error)}
    const selected=()=>entries.find(e=>e.id===a.value)
    const requireEntry=()=>{const e=selected();if(!e)throw new Error('Import and select an audio clip first.');if(service.project.audioUnitFreeze.isFrozen(service.project.boxAdapters.adapterFor(e.unit,AudioUnitBoxAdapter)))throw new Error('Unfreeze this track before editing its clips.');return e}
    const seconds=(pulse:number)=>service.project.tempoMap.ppqnToSeconds(pulse)
    const pulse=(sec:number)=>Math.round(service.project.tempoMap.secondsToPPQN(sec))
    const durationMs=(e:Entry,part:'in'|'out')=>part==='in'?(seconds(e.region.position+e.region.fading.in)-seconds(e.region.position))*1000:(seconds(e.region.complete)-seconds(e.region.complete-e.region.fading.out))*1000
    const setUnlessFocused=(input:HTMLInputElement,value:number)=>{if(document.activeElement!==input)input.value=String(Math.round(value*10)/10)}
    const transaction=(action:()=>void|string,message:string)=>{try{const result=action();tell(typeof result==='string'?result:message);refresh()}catch(error){tell(error instanceof Error?error.message:String(error),true)}}
    const law = panel.querySelector<HTMLSelectElement>('[aria-label="Crossfade curve"]')!
    let previewedPair = ""
    law.onchange = () => preview()
    const preview=()=>{
        const left = selected(), right = entries.find(e => e.id === b.value)
        const text = panel.querySelector<HTMLElement>(".crossfade-plan")!
        const linked = left && right && crossfades(service.project).find(p => p.a === left.region && p.b === right.region)
        const storedLaw = linked ? crossfadeCurveMode(service.project, linked) : "linear"
        const state = [left?.id, right?.id, linked ? storedLaw : "unlinked"].join("/")
        if (state !== previewedPair) {law.value = storedLaw; previewedPair = state}
        const inSlope = law.value === "custom" ? right?.region.fading.inSlope ?? .5 : .5
        const outSlope = law.value === "custom" ? left?.region.fading.outSlope ?? .5 : .5
        const power = law.value === "constant-power"
        const points = (isIn: boolean) => Array.from({length: 41}, (_, i) => {
            const v = curveProgress(i / 40, isIn ? inSlope : outSlope, isIn, power)
            return `${8 + i / 40 * 284},${48 - (isIn ? v : 1 - v) * 40}`
        }).join(" ")
        panel.querySelector(".curve-a")!.setAttribute("points", points(false))
        panel.querySelector(".curve-b")!.setAttribute("points", points(true))
        crossMs.disabled = mode.value === "overlap"
        if(!left||!right||left.id===right.id){text.textContent='Choose two different clips: A fades out, B fades in.';apply.disabled=true;return}
        const overlap=(seconds(left.region.complete)-seconds(right.region.position))*1000
        text.textContent=mode.value==='overlap'?overlap>0?`Apply complementary fades across the ${Math.round(overlap)} ms overlap.`:'The clips do not overlap. Choose Move B to Join A.':`Move B to start ${crossMs.value} ms before A ends, then apply fades.`
        apply.disabled=false
    }
    function refresh(){
        if(!service.hasProfile)return
        const project=service.project
        if(projectIdentity!==project){projectIdentity=project;signature='';selectionSignature='';entries=[];a.replaceChildren();b.replaceChildren();tell('Select an audio clip to edit. All changes support Undo.')}
        entries=project.rootBox.audioUnits.pointerHub.incoming().map(p=>p.box as AudioUnitBox).sort((x,y)=>x.index.getValue()-y.index.getValue()).flatMap((unit,i)=>unit.tracks.pointerHub.incoming().map(p=>p.box as TrackBox).filter(t=>t.type.getValue()===TrackType.Audio).sort((x,y)=>x.index.getValue()-y.index.getValue()).flatMap(track=>track.regions.pointerHub.incoming().map(p=>p.box).filter((box):box is AudioRegionBox=>box instanceof AudioRegionBox).map(box=>{const region=project.boxAdapters.adapterFor(box,AudioRegionBoxAdapter);return {id:UUID.toString(box.address.uuid),region,track,unit,label:`${i+1} · ${region.label||region.file.fileName}`}}))).sort((x,y)=>x.unit.index.getValue()-y.unit.index.getValue()||x.region.position-y.region.position)
        const next=entries.map(e=>e.id+e.label).join('|')
        if(next!==signature){const av=a.value,bv=b.value;for(const s of [a,b])s.replaceChildren(...entries.map(e=>new Option(e.label,e.id)));a.value=entries.some(e=>e.id===av)?av:entries[0]?.id??'';b.value=entries.some(e=>e.id===bv)&&bv!==a.value?bv:entries.find(e=>e.id!==a.value)?.id??'';signature=next}
        const native=project.regionSelection.selected().filter((r):r is AudioRegionBoxAdapter=>r instanceof AudioRegionBoxAdapter).sort((x,y)=>x.position-y.position),ids=native.map(r=>UUID.toString(r.uuid)),nextSelection=ids.join(',')
        if (nextSelection !== selectionSignature) {
            selectionSignature = nextSelection
            const pair = native.length === 1 && crossfades(project).find(p => p.a === native[0] || p.b === native[0])
            if (pair) {
                a.value = UUID.toString(pair.a.uuid)
                b.value = UUID.toString(pair.b.uuid)
            } else {
                if (ids[0]) {a.value = ids[0]}
                if (ids[1]) {b.value = ids[1]}
                if (a.value === b.value) {b.value = entries.find(other => other.id !== a.value)?.id ?? ""}
            }
        }
        const e=selected();panel.querySelector('fieldset')!.disabled=!e
        if(e){setUnlessFocused(gain,e.region.gain.getValue());setUnlessFocused(db,e.region.gain.getValue());setUnlessFocused(fadeIn,durationMs(e,'in'));setUnlessFocused(fadeOut,durationMs(e,'out'));if(document.activeElement!==curve)curve.value=Object.entries(slopes).find(([,v])=>Math.abs(e.region.fading.inSlope-v[0])<.001&&Math.abs(e.region.fading.outSlope-v[1])<.001)?.[0]??'custom'}
        undo.disabled=!project.editing.canUndo();redo.disabled=!project.editing.canRedo();preview()
    }
    const editGain=(value:number,mark=true)=>{const e=requireEntry();if(!Number.isFinite(value)||value< -60||value>12)throw new Error('Clip gain must be between -60 and +12 dB.');setClipGain(service.project,e.region,value,mark)}
    gain.oninput=()=>transaction(()=>editGain(gain.valueAsNumber,false),`Clip gain: ${gain.value} dB`)
    const gainReset=installControlReset(gain,()=>transaction(()=>editGain(0),"Clip gain reset to 0 dB"))
    gain.onchange=()=>service.project.editing.mark()
    db.oninput=()=>{if(Number.isFinite(db.valueAsNumber))transaction(()=>editGain(db.valueAsNumber,false),`Clip gain: ${db.value} dB`)}
    db.onchange=()=>service.project.editing.mark()
    panel.querySelector<HTMLButtonElement>('.reset-gain')!.onclick=()=>transaction(()=>editGain(0),'Clip gain reset to 0 dB')
    for(const [input,part]of [[fadeIn,'in'],[fadeOut,'out']]as const){input.oninput=()=>{if(!Number.isFinite(input.valueAsNumber))return;transaction(()=>{
        const e=requireEntry(),r=e.region,ms=input.valueAsNumber
        if(!Number.isFinite(ms)||ms<0)throw new Error('Fade duration must be a number greater than or equal to 0.')
        const requested=part==='in'?pulse(seconds(r.position)+ms/1000)-r.position:r.complete-pulse(Math.max(seconds(r.position),seconds(r.complete)-ms/1000))
        const result=fitFade(r.duration,requested,part==='in'?r.fading.out:r.fading.in)
        service.project.editing.modify(()=>{if(part==='in'){r.fading.inField.setValue(result.value);r.fading.outField.setValue(result.opposite)}else{r.fading.outField.setValue(result.value);r.fading.inField.setValue(result.opposite)}},false)
    },'Clip fades updated')};input.onchange=()=>service.project.editing.mark()}
    for(const input of [gain,db,fadeIn,fadeOut])input.onblur=()=>service.project.editing.mark()
    const clearLinkedPowerLaw = (region: AudioRegionBoxAdapter) => {
        for (const pair of crossfades(service.project)) {
            if (pair.a === region || pair.b === region) {setCrossfadeCurveMode(service.project, pair, "custom")}
        }
    }
    curve.onchange=()=>transaction(()=>{const r=requireEntry().region,values=slopes[curve.value as keyof typeof slopes];if(!values)return;service.project.editing.modify(()=>{clearLinkedPowerLaw(r);r.fading.inSlopeField.setValue(values[0]);r.fading.outSlopeField.setValue(values[1])},true)},'Fade curve updated')
    panel.querySelector<HTMLButtonElement>('.reset-fades')!.onclick=()=>transaction(()=>{const r=requireEntry().region;service.project.editing.modify(()=>{clearLinkedPowerLaw(r);r.fading.reset()},true)},'Fades reset for the selected clip')
    a.onchange=()=>{const e=selected();if(e){service.project.regionSelection.deselectAll();service.project.regionSelection.select(e.region);selectionSignature=e.id;if(b.value===e.id)b.value=entries.find(other=>other.id!==e.id)?.id??''}refresh()}
    b.onchange=preview;mode.onchange=preview;crossMs.oninput=preview
    apply.onclick=()=>transaction(()=>{
        const left=requireEntry(),right=entries.find(e=>e.id===b.value),project=service.project
        if(!right||left.id===right.id)throw new Error('Select two different audio clips.')
        if(project.audioUnitFreeze.isFrozen(project.boxAdapters.adapterFor(right.unit,AudioUnitBoxAdapter)))throw new Error('Unfreeze the second track first.')
        if(left.region.mute||right.region.mute||!left.track.enabled.getValue()||!right.track.enabled.getValue())throw new Error('Unmute both clips and enable their tracks first.')
        const ms=crossMs.valueAsNumber
        if(mode.value==='join'&&(!Number.isFinite(ms)||ms<=0||ms>60000))throw new Error('Crossfade duration must be between 1 and 60,000 ms.')
        const ar=left.region,br=right.region,requested=ar.complete-pulse(Math.max(0,seconds(ar.complete)-ms/1000))
        const plan=planCrossfade({start:ar.position,end:ar.complete},{start:br.position,end:br.complete},requested,mode.value as 'overlap'|'join')
        const newEnd=br.resolveComplete(plan.secondStart)
        if(newEnd<plan.end)throw new Error('Clip B is too short to cover the crossfade.')
        for(const entry of entries){if(entry===left||entry===right)continue;if(entry.track===left.track&&entry.region.position<ar.complete&&entry.region.complete>ar.position)throw new Error('Clip A overlaps another clip. Resolve that overlap first.');if(entry.track===right.track&&entry.region.position<newEnd&&entry.region.complete>plan.secondStart)throw new Error('Joining here would overlap another clip. Change the duration or position.')}
        const desiredLaw = law.value as CrossfadeCurveMode
        project.editing.modify(()=>{
            if(left.track===right.track){const lane=freeAudioLane(project, project.boxAdapters.adapterFor(right.track,TrackBoxAdapter),plan.secondStart,newEnd,br);br.box.regions.refer(lane.regions)}
            br.position=plan.secondStart
            linkCrossfade(project, ar, br, br.fading.inSlope, ar.fading.outSlope)
            setCrossfadeCurveMode(project, {a: ar, b: br}, desiredLaw)
        },true)
        service.timeline.range.showUnitInterval(Math.max(0,ar.position-PPQN.Quarter),Math.max(ar.complete,br.complete)+PPQN.Quarter)
        const actualMs=Math.round((seconds(plan.end)-seconds(plan.start))*1000)
        return `Applied ${actualMs} ms crossfade · A out / B in${plan.moved?' · B moved to join A':''}`
    },'Crossfade applied')
    undo.onclick=()=>{service.project.editing.undo();tell('Audio edit undone');refresh()};redo.onclick=()=>{service.project.editing.redo();tell('Audio edit redone');refresh()}
    const show=(visible:boolean)=>{panel.hidden=!visible;toggle.setAttribute('aria-expanded',String(visible));if(visible){previewedPair="";refresh()}}
    toggle.onclick=()=>show(panel.hidden);panel.querySelector<HTMLButtonElement>('[aria-label="Close clip inspector"]')!.onclick=()=>show(false)
    panel.addEventListener('keydown',e=>e.stopPropagation())
    const timer=setInterval(()=>{if(!panel.hidden)refresh()},300)
    window.addEventListener('pagehide',()=>{clearInterval(timer);gainReset.terminate();panel.remove()},{once:true})
}
