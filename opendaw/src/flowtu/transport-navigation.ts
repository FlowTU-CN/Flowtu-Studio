import type {StudioService} from '../service/StudioService'
import {frameToSeconds,getFrameRate,secondsToFrame} from './time-format'
import {timeSettings} from './time-settings'
import {seekTimeline,timelinePosition} from './timeline-seek'
import {projectExtent} from './work-area'
import {tr} from './studio-language'

const controls = {
    start: ['Return to start','M5 5h2v14H5zm13 0L8 12l10 7z'],
    rewind: ['Back 5 seconds','M12 5 3 12l9 7zm9 0-9 7 9 7z'],
    previous: ['Previous frame','M5 5h2v14H5zm12.5.2 1.6 1.7-5.6 5.1 5.6 5.1-1.6 1.7-7.5-6.8z'],
    next: ['Next frame','M17 5h2v14h-2zM6.5 5.2 14 12l-7.5 6.8-1.6-1.7 5.6-5.1-5.6-5.1z'],
    forward: ['Forward 5 seconds','M3 5l9 7-9 7zm9 0 9 7-9 7z']
} as const

export type TransportNavigation = keyof typeof controls
export const transportSteps = Object.keys(controls) as TransportNavigation[]
export function navigationButton(doc:Document, action:TransportNavigation, navigate:(action:TransportNavigation)=>void) {
    const button=doc.createElement('button')
    button.type='button'
    button.className='ft-transport-nav'
    button.dataset.navigate=action
    const [caption,path]=controls[action]
    button.title=button.ariaLabel=tr(caption)
    button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="'+path+'"/></svg>'
    button.onclick=()=>navigate(action)
    return button
}
export function labelNavigation(button:HTMLButtonElement) {
    const name=controls[button.dataset.navigate as TransportNavigation][0]
    button.title=button.ariaLabel=tr(name)
}

/** Locate in the project clock, including when the picture starts at an offset. */
export function navigateTransport(service:StudioService, action:TransportNavigation) {
    if (!service.hasProfile) return
    const project=service.project, tempo=project.tempoMap
    const current=tempo.ppqnToSeconds(timelinePosition(project))
    let target=0
    if (action==='previous' || action==='next') {
        const rate=getFrameRate(timeSettings.fps)
        target=frameToSeconds(secondsToFrame(current,rate)+(action==='previous'?-1:1),rate)
        if (service.engine.isPlaying.getValue()) service.engine.stop()
    } else if (action==='forward' || action==='rewind') {
        const end=tempo.ppqnToSeconds(projectExtent(project).end)
        target=action==='rewind' ? current-5 : Math.min(current+5, end > 0 ? Math.max(current,end) : Infinity)
    }
    if (service.audioContext.state==='suspended') void service.audioContext.resume().catch(()=>{})
    seekTimeline(project, Math.max(0,Math.round(tempo.secondsToPPQN(target))))
}
