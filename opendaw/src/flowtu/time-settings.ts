import {findFrameRate,type TimeDisplayMode} from './time-format'

export type TimeSettings = {display:TimeDisplayMode;fps:string}
const storageKey='flowtu.timelineTime.v1'
const listeners=new Set<(settings:Readonly<TimeSettings>)=>void>()
export const timeSettings:TimeSettings={display:'time',fps:'25'}
try {
    const saved=JSON.parse(localStorage.getItem(storageKey)??'null')
    if(saved&&['time','timecode','frames'].includes(saved.display))timeSettings.display=saved.display
    if(saved&&findFrameRate(saved.fps))timeSettings.fps=saved.fps
} catch {/* Storage is optional in embedded/private browser contexts. */}
export function setTimeSettings(next:Partial<TimeSettings>):void {
    if(next.display&&['time','timecode','frames'].includes(next.display))timeSettings.display=next.display
    if(next.fps&&findFrameRate(next.fps))timeSettings.fps=next.fps
    try {localStorage.setItem(storageKey,JSON.stringify(timeSettings))} catch {/* In-memory settings still work. */}
    listeners.forEach(listener=>listener(timeSettings))
}
export function subscribeTimeSettings(listener:(settings:Readonly<TimeSettings>)=>void):()=>void {
    listeners.add(listener);listener(timeSettings)
    return ()=>listeners.delete(listener)
}
