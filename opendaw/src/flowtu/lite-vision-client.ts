interface SampledFrame {time: number; thumbnail: string}
interface VisionScene {
    thumbnail: string
    keyframeTime: number
    start: number
    end: number
    motion: number
    brightness: number
    warmth: number
    boundary: string
    contextFrames?: SampledFrame[]
}
export interface LiteVisionDescription {title:string; observation:string; musicPrompt:string; startsNewBeat?:boolean; mood?:string}
const route = '/api/flowtu/score-vision'

function waitForSlot(ms: number, signal: AbortSignal) {
    signal.throwIfAborted()
    return new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason) }
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
        signal.addEventListener('abort', abort, {once:true})
    })
}

async function sendBatch(body: string, signal: AbortSignal) {
    for (let attempt = 0; ; attempt++) {
        const response = await fetch(route, {method:'POST', credentials:'same-origin', signal, headers:{
            'Content-Type':'application/json', Accept:'application/json'
        }, body})
        // Only a busy local queue is safe to retry. That response is sent before the
        // server starts a model request, so a successful generation is never repeated.
        if (response.status !== 429 || attempt >= 7) return response
        await response.arrayBuffer()
        await waitForSlot(Math.min(4000, 750 * 2 ** attempt), signal)
    }
}

export async function describeStudioFrames(scenes: VisionScene[], language: string, signal: AbortSignal):
    Promise<{model:string; scenes:LiteVisionDescription[]} | undefined> {
    if (!scenes.length) return
    const capabilities = await fetch(route, {signal, headers:{Accept:'application/json'}, credentials:'same-origin'})
    if (capabilities.status === 404 || !capabilities.headers.get('Content-Type')?.includes('application/json')) return
    if (!capabilities.ok) throw new Error('Studio vision service is unavailable (' + capabilities.status + ').')
    const config = await capabilities.json()
    if (!config.configured) return
    const descriptions: LiteVisionDescription[] = []
    let model: string | undefined
    for (let i = 0; i < scenes.length; i += 6) {
        const batch = scenes.slice(i, i + 6).map((scene, j) => ({...scene, id:'s' + (i + j + 1)}))
        const response = await sendBatch(JSON.stringify({language, scenes:batch, previous:descriptions.at(-1)}), signal)
        const result = await response.json()
        if (!response.ok) {
            if (response.status === 503 && result.code === 'not_configured' && !descriptions.length) return
            throw new Error(typeof result.error === 'string' ? result.error : 'Vision analysis failed (' + response.status + ').')
        }
        if (!Array.isArray(result.scenes) || result.scenes.length !== batch.length || typeof result.model !== 'string' || (model && result.model !== model))
            throw new Error('Vision model or scene count changed during analysis.')
        model = result.model
        for (const [j, row] of result.scenes.entries()) {
            if (!row || batch[j].id !== row.id || !['title','observation','musicPrompt'].every(key => typeof row[key] === 'string' && row[key].trim()))
                throw new Error('The vision descriptions do not match the selected scenes.')
            descriptions.push({title:row.title, observation:row.observation, musicPrompt:row.musicPrompt,
                ...(typeof row.startsNewBeat === 'boolean' ? {startsNewBeat:row.startsNewBeat} : {}),
                ...(typeof row.mood === 'string' ? {mood:row.mood} : {})})
        }
    }
    return {model:model!, scenes:descriptions}
}
