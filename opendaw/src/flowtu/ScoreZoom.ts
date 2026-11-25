import {PPQN} from '@opendaw/lib-dsp'
import {Terminator} from '@opendaw/lib-std'
import type {Project} from '@opendaw/studio-core'
import type {StudioService} from '../service/StudioService'
import {manualWorkArea, projectExtent, subscribeWorkAreaPicture} from './work-area'
import {readScoring} from './scoring-model'
import {timelinePosition} from './timeline-seek'
import {tr, watchStudioLanguage} from './studio-language'

/** View-only headroom for an overview of a film. It is never written to the project duration or export locators. */
export function installScoreZoom(service:StudioService, header:HTMLElement) {
    const {range, overviewMinimum}=service.timeline
    const bar=document.createElement('nav')
    bar.className='ft-native-zoom';bar.hidden=true
    const button=(action:string,caption:string,click:()=>void)=>{
        const el=document.createElement('button')
        el.type='button';el.dataset.zoom=action;el.textContent=caption
        el.onclick=event=>{
            click()
            if (event.detail>0) header.parentElement?.querySelector<HTMLElement>('[data-scope="regions"]')?.focus({preventScroll:true})
        }
        bar.append(el);return el
    }
    let active=false, fitted=PPQN.Bar*4, frame=0
    let project:Project|undefined
    const life=new Terminator()
    function step(factor:number) {
        if (!project) return
        const span=Math.max(range.minimum,Math.min(range.maxUnits,range.unitRange*factor))
        const playhead=timelinePosition(project)
        const anchor=playhead>=range.unitMin && playhead<=range.unitMax ? playhead : range.unitCenter
        const fraction=range.unitRange>0 ? (anchor-range.unitMin)/range.unitRange : .5
        const left=Math.max(0,Math.min(anchor-fraction*span, range.maxUnits-span))
        range.showUnitInterval(left,left+span)
    }
    const out=button('out','−',()=>step(2))
    const plus=button('in','+',()=>step(.5))
    const percent=document.createElement('span')
    percent.className='ft-zoom-percent';percent.setAttribute('aria-live','off')
    plus.before(percent)
    const fit=button('fit','',()=>{if (project) range.showUnitInterval(0,Math.min(range.maxUnits,fitted))})
    function labels() {
        bar.ariaLabel=tr('Timeline')
        fit.innerHTML='<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 4v10m14-10v10M5 9h8M7 6.5 4.5 9 7 11.5m4-5L13.5 9 11 11.5"/></svg>'
        for (const [b,label] of [[out,'Zoom out'],[fit,'Fit timeline'],[plus,'Zoom in']] as const) b.title=b.ariaLabel=tr(label)
    }
    function updateButtons() {
        const scale=fitted/range.unitRange*100
        percent.textContent=!project || !Number.isFinite(scale) ? '—' : scale<.1 ? '<0.1%' : (scale<1 ? scale.toFixed(1) : Math.round(scale))+'%'
        out.disabled=!project || range.unitRange>=range.maxUnits-1
        plus.disabled=!project || range.unitRange<=range.minimum+1
        fit.disabled=!project
    }
    function updateLimit() {
        frame=0
        if (!active || !project) return
        let content=Math.max(projectExtent(project).end,manualWorkArea(project)?.end??0)
        for (const cue of readScoring(project).cues) content=Math.max(content,project.tempoMap.secondsToPPQN(cue.end))
        const end=content || PPQN.Bar*4
        fitted=Math.ceil(end+Math.max(PPQN.Quarter,end*.04))
        const tenMinutes=project.tempoMap.secondsToPPQN(600)
        overviewMinimum.setValue(Math.min(0x7fffffff,Math.ceil(Math.max(tenMinutes,end*8))))
        updateButtons()
    }
    function schedule(){if (!frame) frame=requestAnimationFrame(updateLimit)}
    function bind(){
        cancelAnimationFrame(frame);frame=0;life.terminate()
        project=active && service.hasProfile ? service.project : undefined
        if (project) {
            life.ownAll(project.editing.subscribe(schedule),project.tempoMap.subscribe(schedule),subscribeWorkAreaPicture(project,schedule),range.subscribe(updateButtons))
            updateLimit()
        } else {overviewMinimum.setValue(0);updateButtons()}
    }
    header.append(bar);labels()
    const language=watchStudioLanguage(labels), profile=service.projectProfileService.subscribe(bind)
    return {setActive(on:boolean){if(active===on)return;active=on;bar.hidden=!on;bind()}, dispose(){
        active=false;bind();profile.terminate();language();bar.remove()
    }}
}
