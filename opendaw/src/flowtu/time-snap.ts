import type {TimeRounding} from './time-format'

export interface TimeMap {
    ppqnToSeconds(position:number):number
    secondsToPPQN(seconds:number):number
}

/** openDAW clip positions are Int32 pulses. Keep the absolute time grid, with nearest-tick storage. */
export function timeGridIndex(map:TimeMap,position:number,interval:number,rounding:TimeRounding):number {
    const value=map.ppqnToSeconds(position)/interval,nearest=Math.round(value)
    // A stored grid position must remain on the same grid point on subsequent drags/seeks.
    const stored=Math.round(map.secondsToPPQN(nearest*interval))
    return Math[rounding](Math.abs(position-stored)<1e-6?nearest:value)
}
export function timeGridPosition(map:TimeMap,index:number,interval:number):number {
    return Math.round(map.secondsToPPQN(index*interval))
}
export function snapTimePosition(map:TimeMap,position:number,interval:number,rounding:TimeRounding):number {
    return timeGridPosition(map,timeGridIndex(map,position,interval,rounding),interval)
}
