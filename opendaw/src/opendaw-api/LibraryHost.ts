import {OpenDAWHeaders} from './OpenDAWHeaders'

// A same-origin static directory can serve the four catalogues without an API or credentials.
const configured: string = import.meta.env?.VITE_FLOWTU_LIBRARY_ROOT?.trim() ?? ''
if (configured && (!/^\/(?!\/)/.test(configured) || /[\\?#]/.test(configured))) {
    throw new Error('VITE_FLOWTU_LIBRARY_ROOT must be a same-origin directory such as /library.')
}
export const selfHostedLibrary = configured.length > 0
export function libraryRoot(kind: 'samples' | 'soundfonts' | 'presets' | 'wclaps') {
    return (selfHostedLibrary ? configured.replace(/\/+$/, '') : 'https://assets.opendaw.studio') + '/' + kind
}
export const libraryRequest: RequestInit = selfHostedLibrary ? {credentials: 'same-origin'} : OpenDAWHeaders

export async function readLocalIndex(url: string) {
    const response = await fetch(url, {...libraryRequest, cache: 'no-cache', signal: AbortSignal.timeout(5000)})
    if (!response.ok) throw new Error('Cannot load local library index ' + url + ' (' + response.status + ')')
    return response.json()
}
