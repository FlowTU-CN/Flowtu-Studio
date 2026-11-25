export type TimeDisplayMode = 'time' | 'timecode' | 'frames'
export type TimeRounding = 'round' | 'floor' | 'ceil'
export type FrameRate = Readonly<{id:string;label:string;numerator:number;denominator:number;nominal:number}>

/** Fractional rates use non-drop-frame timecode; their frame clock is rational, not rounded decimal FPS. */
export const FRAME_RATES:readonly FrameRate[] = [
    {id:'23.976',label:'23.976 NDF',numerator:24000,denominator:1001,nominal:24},
    {id:'24',label:'24 fps',numerator:24,denominator:1,nominal:24},
    {id:'25',label:'25 fps',numerator:25,denominator:1,nominal:25},
    {id:'29.97',label:'29.97 NDF',numerator:30000,denominator:1001,nominal:30},
    {id:'30',label:'30 fps',numerator:30,denominator:1,nominal:30},
    {id:'50',label:'50 fps',numerator:50,denominator:1,nominal:50},
    {id:'59.94',label:'59.94 NDF',numerator:60000,denominator:1001,nominal:60},
    {id:'60',label:'60 fps',numerator:60,denominator:1,nominal:60}
]
const ntsc = (nominal:number) => ({
    id:String(Number((nominal*1000/1001).toFixed(3))),label:(nominal*1000/1001).toFixed(3)+' NDF',
    numerator:nominal*1000,denominator:1001,nominal
})
const sourceStandards:readonly FrameRate[] = [...FRAME_RATES,ntsc(48),ntsc(120),ntsc(240)]

export function sourceFrameRateId(fps:number):string|undefined {
    if (!Number.isFinite(fps) || fps<1 || fps>240.02) return
    const match = sourceStandards.find(rate=>Math.abs(rate.numerator/rate.denominator - fps) < fps*.00012)
    if (match) return match.id
    const integer = Math.round(fps)
    return String(Math.abs(integer-fps)<fps*.00012 ? integer : Number(fps.toFixed(6)))
}
export function findFrameRate(id:string):FrameRate|undefined {
    const known = sourceStandards.find(rate=>rate.id===id)
    if (known) return known
    if (typeof id !== 'string' || !/^\d{1,3}(?:\.\d{1,6})?$/.test(id)) return
    const fps = Number(id)
    if (fps < 1 || fps > 240) return
    const denominator = 10**(id.split('.')[1]?.length ?? 0)
    return {id,label:id+' fps',numerator:Math.round(fps*denominator),denominator,nominal:Math.round(fps)}
}
export const getFrameRate = (id:string):FrameRate => findFrameRate(id) ?? FRAME_RATES[2]
export function selectFrameRate(select:HTMLSelectElement,id:string) {
    if (![...select.options].some(option=>option.value===id)) {
        const rate = getFrameRate(id), option = select.ownerDocument.createElement('option')
        option.value=rate.id;option.text=rate.label;select.add(option)
    }
    select.value=id
}
const pad = (value:number,length=2):string => String(value).padStart(length,'0')
const roundUnit = (units:number,rounding:TimeRounding):number => {
    // Arithmetic on exact frame boundaries may land a few ulps below the integer.
    const nearest=Math.round(units)
    return Math[rounding](Math.abs(units-nearest)<1e-7?nearest:units)
}
export function frameToSeconds(frame:number,rate:FrameRate):number {return frame*rate.denominator/rate.numerator}
export function secondsToFrame(seconds:number,rate:FrameRate,rounding:TimeRounding='round'):number {
    return roundUnit(seconds*rate.numerator/rate.denominator,rounding)
}
export function quantizeSeconds(seconds:number,interval:number,rounding:TimeRounding='round'):number {
    if(!Number.isFinite(seconds)||!Number.isFinite(interval)||interval<=0)throw new Error('A finite time and positive grid interval are required.')
    return roundUnit(seconds/interval,rounding)*interval
}
export function formatTimelineTime(seconds:number,mode:TimeDisplayMode,rate:FrameRate):string {
    const safe=Number.isFinite(seconds)?Math.max(0,seconds):0
    const units=mode==='time'?Math.round(safe*1000):secondsToFrame(safe,rate)
    const base=mode==='time'?1000:rate.nominal
    const wholeSeconds=Math.floor(units/base)
    const clock=`${pad(Math.floor(wholeSeconds/3600))}:${pad(Math.floor(wholeSeconds/60)%60)}:${pad(wholeSeconds%60)}`
    const separator=mode==='timecode'?':':'.'
    return clock+separator+pad(units%base,mode==='time'?3:Math.max(2,String(base-1).length))
}
/** Returns null for malformed input, invalid frame numbers and negative times. */
export function parseTimelineTime(text:string,mode:TimeDisplayMode,rate:FrameRate):number|null {
    const value=text.trim()
    if(mode!=='time'){
        // Older frame readouts could be copied and pasted as a single frame count.
        if(mode==='frames' && /^\d+$/.test(value))
            return Number.isSafeInteger(Number(value))?frameToSeconds(Number(value),rate):null
        const match=/^(\d+):([0-5]\d):([0-5]\d)[:.](\d{2,3})$/.exec(value)
        if(!match||match[4].length!==Math.max(2,String(rate.nominal-1).length)||Number(match[4])>=rate.nominal)return null
        const frames=((Number(match[1])*60+Number(match[2]))*60+Number(match[3]))*rate.nominal+Number(match[4])
        return Number.isSafeInteger(frames)?frameToSeconds(frames,rate):null
    }
    if(/^\d+(?:\.\d+)?$/.test(value))return Number.isFinite(Number(value))?Number(value):null
    const parts=value.split(':')
    if(parts.length<2||parts.length>3||!/^\d+$/.test(parts[0]))return null
    if(parts.length===3&&!/^[0-5]\d$/.test(parts[1]))return null
    if(!/^[0-5]\d(?:\.\d+)?$/.test(parts.at(-1)!))return null
    const seconds=parts.reduce((sum,part)=>sum*60+Number(part),0)
    return Number.isFinite(seconds)?seconds:null
}
