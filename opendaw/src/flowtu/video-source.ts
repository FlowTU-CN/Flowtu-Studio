import {sourceFrameRateId} from './time-format'

export type VideoSourceInfo = {
    width:number; height:number; container:string; codec:string; audioCodec:string
    bytes:number; duration:number; frameRate?:string; variable?:boolean; averageFps?:number
}

/** Read packet timestamps without decoding frames or loading the whole film into memory. */
export async function inspectVideoSource(file:File, width:number, height:number, duration:number):Promise<VideoSourceInfo> {
    const source:VideoSourceInfo = {width,height,duration,bytes:file.size,container:file.type,codec:'',audioCodec:''}
    // The display element can support a codec or container that the demuxer does not.
    // Keep the detected HTML media dimensions and duration available in that case.
    try {
        const {Input, BlobSource, ALL_FORMATS} = await import('mediabunny')
        const input = new Input({source:new BlobSource(file),formats:ALL_FORMATS})
        try {
            const [format,video,audio] = await Promise.all([input.getFormat(),input.getPrimaryVideoTrack(),input.getPrimaryAudioTrack()])
            source.container = format.name
            source.audioCodec = await audio?.getCodec() ?? ''
            if (video) {
                source.codec = await video.getCodec() ?? ''
                const metrics = await video.computeFrameRateMetrics()
                if (metrics.probedPacketCount >= 2) {
                    source.variable = !metrics.frameRateIsConstant
                    source.averageFps = metrics.averageFrameRate
                    // A variable-rate clip can have a much finer underlying lattice than its typical frame cadence.
                    const fps = source.variable ? metrics.medianFrameRate : metrics.bestGuessFrameRate
                    const id = sourceFrameRateId(fps)
                    if (id) source.frameRate = id
                }
            }
        } finally {input.dispose()}
    } catch { /* The browser may still play this source. Keep the current project clock if timing is unknown. */ }
    return source
}

export function videoSourceDescription(source:VideoSourceInfo) {
    const size = source.width && source.height ? source.width+' × '+source.height : ''
    const fps = source.frameRate ? (source.variable ? 'VFR ≈ ' : '') + source.frameRate+' fps' : 'FPS —'
    return [size,fps,source.container,[source.codec,source.audioCodec].filter(Boolean).join(' / ').toUpperCase()].filter(Boolean).join(' · ')
}
