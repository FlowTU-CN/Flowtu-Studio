import {UUID} from '@opendaw/lib-std'
import {type Soundfont} from '@opendaw/studio-adapters'
import type {StudioService} from '@/service/StudioService'

export const uprightPiano: Soundfont = {
    uuid: 'd9f51577-2096-4671-9067-27ca2e12b329',
    name: 'Upright Piano KW',
    size: 57377848,
    url: 'https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html',
    license: 'CC0 1.0 Universal',
    origin: 'openDAW'
}

export function loadUprightPiano(service: StudioService): Promise<Soundfont> {
    const loader = service.soundfontManager.getOrCreate(UUID.parse(uprightPiano.uuid))
    if (loader.state.type === 'loaded') return Promise.resolve(uprightPiano)
    if (loader.state.type === 'error') loader.invalidate()
    return new Promise((resolve, reject) => {
        const subscription = loader.subscribe(state => {
            if (state.type === 'progress' || state.type === 'idle') return
            subscription.terminate()
            if (state.type === 'loaded') resolve(uprightPiano)
            else reject(new Error(state.reason))
        })
    })
}
