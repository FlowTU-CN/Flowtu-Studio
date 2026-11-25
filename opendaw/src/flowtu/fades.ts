export type ClipSpan={start:number;end:number}
export type CrossfadePlan={start:number;end:number;secondStart:number;duration:number;moved:boolean}

// All values use timeline pulses. The caller converts milliseconds with the tempo map.
export function planCrossfade(a:ClipSpan,b:ClipSpan,duration:number,mode:'overlap'|'join'):CrossfadePlan {
    if(![a.start,a.end,b.start,b.end,duration].every(Number.isFinite)||a.end<=a.start||b.end<=b.start)throw new Error('Invalid clip range.')
    if(mode==='overlap'){
        if(b.start<a.start||b.end<a.end)throw new Error('A must start first and B must end last. One clip cannot fully contain the other.')
        const length=a.end-b.start
        if(length<=0)throw new Error('The clips do not overlap. Choose Move B to Join A and set a crossfade duration.')
        return {start:b.start,end:a.end,secondStart:b.start,duration:length,moved:false}
    }
    if(duration<=0||duration>=Math.min(a.end-a.start,b.end-b.start))throw new Error('Crossfade duration must be greater than 0 and shorter than both clips.')
    const start=a.end-duration
    return {start,end:a.end,secondStart:start,duration,moved:Math.abs(start-b.start)>.001}
}
export function fitFade(duration:number,requested:number,opposite:number):{value:number;opposite:number} {
    if(!Number.isFinite(requested)||requested<0)throw new Error('Fade duration must be a number greater than or equal to 0.')
    const value=Math.min(duration,requested)
    return {value,opposite:Math.max(0,Math.min(opposite,duration-value))}
}
export function handleX(start:number,end:number,position:number):number {
    const inset=Math.min(7,Math.max(0,(end-start)/3))
    return Math.max(start+inset,Math.min(end-inset,position))
}
