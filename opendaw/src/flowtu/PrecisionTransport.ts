import {navigationButton,navigateTransport,transportSteps,labelNavigation} from './transport-navigation'
import {watchStudioLanguage} from './studio-language'
import {seekTimeline, timelinePosition} from './timeline-seek'
import type {Lifecycle, Subscription} from '@opendaw/lib-std'
import {Browser} from '@opendaw/lib-dom'
import type {StudioService} from '../service/StudioService'
import {FRAME_RATES,selectFrameRate,formatTimelineTime,parseTimelineTime,getFrameRate,type TimeDisplayMode} from './time-format'
import {timeSettings,setTimeSettings,subscribeTimeSettings} from './time-settings'
import {installPlaybackKeys} from './playback-keys'
import {createToolbarMenu} from './ToolbarMenu'
import './precision-transport.css'

export function createPrecisionTransport(service:StudioService,lifecycle:Lifecycle):HTMLElement {
    const root=document.createElement('div');root.className='flowtu-precision-transport'
    root.setAttribute('role','group');root.setAttribute('aria-label','Precise transport')
    const settings=createToolbarMenu('Time')
    settings.trigger.setAttribute('aria-label','Time display settings')
    settings.panel.innerHTML=`<label>Display<select aria-label="Transport time display"><option value="time">Time</option><option value="timecode">Timecode</option><option value="frames">Time + frames</option></select></label><label>Frame rate<select aria-label="Timecode frame rate"></select></label>`
    root.innerHTML=`<input class="transport-position" aria-label="Transport position" type="text" spellcheck="false" value="00:00:00.000"><output class="transport-error" role="status" hidden></output>`
    root.prepend(settings.element)
    const display=settings.panel.querySelector<HTMLSelectElement>('[aria-label="Transport time display"]')!,position=root.querySelector<HTMLInputElement>('input')!,fps=settings.panel.querySelector<HTMLSelectElement>('[aria-label="Timecode frame rate"]')!,error=root.querySelector<HTMLOutputElement>('output')!
    for(const rate of FRAME_RATES)fps.add(new Option(rate.label,rate.id))
    const seconds=()=>{
        if(!service.hasProfile)return 0
        return service.project.tempoMap.ppqnToSeconds(timelinePosition(service.project))
    }
    const format=(value:number)=>formatTimelineTime(value,timeSettings.display,getFrameRate(timeSettings.fps))
    const update=()=>{
        if(document.activeElement!==position)position.value=format(seconds())
    }
    const seek=(value:number)=>{
        if(!service.hasProfile)return
        const pulse=Math.max(0,Math.round(service.project.tempoMap.secondsToPPQN(value)))
        // A fresh suspended AudioContext cannot process a stopped-transport seek.
        if(service.audioContext.state==='suspended')void service.audioContext.resume().catch(()=>{error.textContent='Audio is suspended. Press Play once to enable it.';error.hidden=false})
        seekTimeline(service.project, pulse)
        error.hidden=true;position.removeAttribute('aria-invalid')
    }
    const commit=()=>{
        const value=parseTimelineTime(position.value,timeSettings.display,getFrameRate(timeSettings.fps))
        if(value===null||value<0){position.setAttribute('aria-invalid','true');error.textContent=timeSettings.display==='time'?'Enter seconds or HH:MM:SS.mmm':timeSettings.display==='timecode'?'Enter HH:MM:SS:FF (non-drop-frame)':'Enter HH:MM:SS.FF or a frame number';error.hidden=false;return false}
        seek(value);return true
    }
    position.addEventListener('change',commit)
    position.addEventListener('keydown',event=>{
        if(event.key==='Enter'){event.preventDefault();if(commit())position.blur()}
        if(event.key==='Escape'){event.preventDefault();position.value=format(seconds());position.removeAttribute('aria-invalid');error.hidden=true;position.blur()}
        if(event.key!=='Tab')event.stopPropagation()
    })
    display.onchange=()=>setTimeSettings({display:display.value as TimeDisplayMode})
    fps.onchange=()=>setTimeSettings({fps:fps.value})
    const toggle=()=>{if(!service.hasProfile)return;service.engine.isPlaying.getValue()?service.engine.stop():service.engine.play()}
    const navigation=transportSteps.map(action=>{
        const button=navigationButton(document,action,id=>navigateTransport(service,id))
        button.classList.add('frame-step')
        if (action==='next') button.classList.add('step-forward')
        if (action==='previous') button.classList.add('step-back')
        return button
    })
    error.before(...navigation)
    lifecycle.own({terminate:watchStudioLanguage(()=>navigation.forEach(labelNavigation))})
    let tempoSubscription:Subscription|undefined
    lifecycle.own(service.projectProfileService.catchupAndSubscribe(profile=>{
        tempoSubscription?.terminate();tempoSubscription=undefined
        profile.ifSome(({project})=>{tempoSubscription=service.timeline.snapping.registerTempoMap(project.tempoMap)})
        root.querySelectorAll<HTMLInputElement|HTMLButtonElement>('.transport-position,.frame-step').forEach(el=>el.disabled=profile.isEmpty())
        update()
    }))
    let previousDisplay:TimeDisplayMode|undefined
    const unsubscribe=subscribeTimeSettings(()=>{
        display.value=timeSettings.display;selectFrameRate(fps,timeSettings.fps)
        settings.setLabel(display.selectedOptions[0].text)
        settings.trigger.title=`${display.selectedOptions[0].text} · ${fps.selectedOptions[0].text}`
        service.timeline.snapping.setFrameRate(getFrameRate(timeSettings.fps))
        if(previousDisplay!==timeSettings.display){
            service.timeline.snapping.index=service.timeline.snapping.units.findIndex(unit=>unit.name===(timeSettings.display==='time'?'10 ms':'1 frame'))
            previousDisplay=timeSettings.display
        }
        position.title=timeSettings.display==='time'?'HH:MM:SS.mmm or seconds; Enter to locate':timeSettings.display==='timecode'?'HH:MM:SS:FF · Non-drop-frame; Enter to locate':'HH:MM:SS.FF · Frames within the second. Enter to locate'
        position.value=format(seconds());error.hidden=true;position.removeAttribute('aria-invalid')
    })
    lifecycle.own(service.engine.position.subscribe(update));lifecycle.own(service.engine.isPlaying.subscribe(update))
    const disposeKeys=installPlaybackKeys({ready:()=>service.hasProfile,toggle,stop:()=>service.engine.stop(true),start:()=>seek(0)}, Browser.isMacOS())
    const timer=setInterval(update,100)
    lifecycle.own({terminate:()=>{clearInterval(timer);tempoSubscription?.terminate();unsubscribe();disposeKeys();settings.dispose()}})
    update();return root
}
