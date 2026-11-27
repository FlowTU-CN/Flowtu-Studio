import {studioAuthHeaders} from './studio-auth.ts'

// Relative main-site audio endpoints require the host JWT. Never attach it to an OSS URL.
export function studioAudioHeaders(playUrl: string, baseUrl = globalThis.location?.href ?? 'http://localhost/'): Record<string,string> {
    const base = new URL(baseUrl), url = new URL(playUrl, base)
    return url.origin === base.origin && url.pathname.startsWith('/api/e/') ? studioAuthHeaders() : {}
}
export async function fetchStudioAudio(playUrl: string, signal?: AbortSignal): Promise<Blob> {
    const response = await fetch(playUrl, {headers:studioAudioHeaders(playUrl), credentials:'same-origin', signal:signal ?? AbortSignal.timeout(60000)})
    if (!response.ok) throw new Error('The audio could not be downloaded. Refresh the generation history and try again.')
    const audio = await response.blob()
    if (!audio.size || !audio.type.startsWith('audio/')) throw new Error('The audio could not be downloaded. Refresh the generation history and try again.')
    return audio
}
