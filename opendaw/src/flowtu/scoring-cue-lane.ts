import {deferNextFrame, Html} from '@opendaw/lib-dom'
import type {Lifecycle} from '@opendaw/lib-std'
import {MetaData} from '@opendaw/studio-adapters'
import type {StudioService} from '../service/StudioService'
import {locatorSnap} from '../ui/timeline/AudioClipSnap'
import {bindFilmCueDrag,type CuePreview} from './film-cue-drag'
import {readScoring, scoringOrigin} from './scoring-model'
import {getSelectedScoringCue, requestScoringCue, subscribeScoringSelection} from './scoring-selection'
import {formatTimelineTime, getFrameRate} from './time-format'
import {subscribeTimeSettings, timeSettings} from './time-settings'
import {tr,watchStudioLanguage} from './studio-language'
import './scoring-cue-lane.css'

type Scene = CuePreview & {name?:string}
type Scale = {timeAt:(x:number)=>number; xAt:(seconds:number)=>number; snapPulse?:(pulse:number)=>number}

/** The compact and full timelines render the same editable intervals. */
export function mountCueBlocks(lane:HTMLElement, service:StudioService, lifecycle:Lifecycle, scale:Scale, rowHeight:number) {
    const project=service.project, controls=new Map<string,HTMLButtonElement>()
    let draft:CuePreview|undefined, scenes:Scene[]=[]
    lane.classList.add('ft-scene-intervals')
    lane.style.setProperty('--ft-cue-step',rowHeight+'px')
    lane.setAttribute('role','group')
    const hint=document.createElement('span')
    hint.className='ft-cue-lane-hint'
    lane.append(hint)
    const time=(seconds:number)=>formatTimelineTime(seconds,timeSettings.display,getFrameRate(timeSettings.fps))
    function render() {
        const selected=getSelectedScoringCue(project)
        const sorted=scenes.map(s=>s.id===draft?.id?{...s,...draft}:s).sort((a,b)=>a.start-b.start || a.end-b.end)
        const ends:number[]=[]
        const keep=new Set<string>()
        for(const scene of sorted) {
            let row=ends.findIndex(end=>end<=scene.start+1e-8)
            if(row<0) row=ends.length
            ends[row]=scene.end
            const x=scale.xAt(scene.start), end=scale.xAt(scene.end)
            if(end<=0 || x>=lane.clientWidth) continue
            let button=controls.get(scene.id)
            if(!button) {
                button=document.createElement('button')
                button.type='button';button.dataset.cueId=scene.id
                button.innerHTML='<i data-cue-edge="start" aria-hidden="true"></i><b></b><i data-cue-edge="end" aria-hidden="true"></i>'
                button.onclick=()=>requestScoringCue(project,scene.id)
                controls.set(scene.id,button);lane.append(button)
            }
            keep.add(scene.id)
            const name=scene.name ?? tr('Cue {0}',sorted.indexOf(scene)+1)
            const from=Math.max(0,x), to=Math.min(lane.clientWidth,end)
            button.style.left=from+'px';button.style.width=Math.max(1,to-from)+'px';button.style.top=(rowHeight*row+2)+'px'
            button.dataset.row=String(row)
            button.dataset.selected=String(selected===scene.id)
            button.toggleAttribute('data-dragging',scene.id===draft?.id)
            button.toggleAttribute('data-clip-start',x<-.1);button.toggleAttribute('data-clip-end',end>lane.clientWidth+.1)
            const label=button.querySelector('b')!
            if(label.textContent!==name)label.textContent=name
            button.title=tr('Cue {0}',name)+' · '+time(scene.start)+' – '+time(scene.end)
            button.setAttribute('aria-pressed',button.dataset.selected)
        }
        for(const [id,button] of controls) if(!keep.has(id)){button.remove();controls.delete(id)}
        hint.hidden=!!sorted.length
        lane.dataset.rows=String(Math.max(1,ends.length))
        const height=Math.max(1,Math.min(4,ends.length))*rowHeight+'px'
        lane.style.height=height
        lane.closest<HTMLElement>('.flowtu-timeline')?.style.setProperty('--ft-cue-lane-height',height)
    }
    const {request}=lifecycle.own(deferNextFrame(render))
    const read=()=>{scenes=readScoring(project).cues;request()}
    const preview=(next?:CuePreview)=>{draft=next;render()}
    const snapping=service.timeline.snapping
    lifecycle.ownAll(
        {terminate:bindFilmCueDrag(lane,project,{...scale,preview,resetSnap:()=>snapping.guide.setValue(null),snap(){
            const raw=scale.snapPulse ? (pulse:number,bypass:boolean)=>bypass ? Math.round(pulse) : scale.snapPulse!(pulse) : locatorSnap(project,snapping)
            return (time,bypass)=>project.tempoMap.ppqnToSeconds(Math.max(0,raw(project.tempoMap.secondsToPPQN(Math.max(0,time)),bypass)))
        }})},
        Html.watchResize(lane,request),
        project.tempoMap.subscribe(request),
        MetaData.catchupAndSubscribe(project.rootBox,scoringOrigin,read),
        {terminate:subscribeScoringSelection(project,request)},
        {terminate:subscribeTimeSettings(request)},
        {terminate:watchStudioLanguage(()=>{hint.textContent='M · '+tr('Mark cue');request()})}
    )
    hint.textContent='M · '+tr('Mark cue')
    for(const name of ['pointerdown','mousedown','click','dblclick']) lane.addEventListener(name,event=>event.stopPropagation())
    read()
    return request
}

export function createScoringCueLane(service:StudioService,lifecycle:Lifecycle) {
    const lane=document.createElement('div')
    lane.className='ft-cue-lane'
    lane.ariaLabel=tr('Scoring cues')
    const project=service.project, range=service.timeline.range
    const refresh=mountCueBlocks(lane,service,lifecycle,{
        xAt:seconds=>range.unitToX(project.tempoMap.secondsToPPQN(seconds)),
        timeAt:x=>project.tempoMap.ppqnToSeconds(range.xToUnit(x))
    },24)
    lifecycle.ownAll(range.subscribe(refresh),{terminate:subscribeScoringSelection(project,()=>{
        const cue=readScoring(project).cues.find(c=>c.id===getSelectedScoringCue(project))
        if(!cue || !lane.clientWidth) return
        const start=project.tempoMap.secondsToPPQN(cue.start),end=project.tempoMap.secondsToPPQN(cue.end)
        if(end<=range.unitMin || start>=range.unitMax) range.moveToUnit(start-range.unitRange*.15)
    })})
    return lane
}
