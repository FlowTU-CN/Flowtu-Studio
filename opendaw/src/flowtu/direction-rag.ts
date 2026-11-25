import {tr} from './studio-language'
import type {ScoreDirection} from './scoring-direction'
import type {Tone} from './commands'

export type DirectionPad = 'melodyArrangement' | 'emotionStyle'
export type DirectionContext = {
    projectId: string
    cue: {id: string | null; name: string; startSeconds: number; endSeconds: number; prompt: string; analysis: string}
    bpm: number
    instrument: Tone
    style: ScoreDirection['style']
}
export type Axes = {
    melodyArrangement: Pick<ScoreDirection, 'melody' | 'arrangement'>
    emotionStyle: Pick<ScoreDirection, 'emotion' | 'character'>
}
export type PadQuery<K extends DirectionPad> = DirectionContext & {pad: K; axes: Axes[K]}
export type DirectionRetrievers = {
    [K in DirectionPad]?: (query: PadQuery<K>, options: {signal: AbortSignal}) => Promise<{text: string} | null>
}
declare global {interface Window {flowtuDirectionRag?: DirectionRetrievers}}

// Each committed gesture has its own destination. A slow provider on one wheel can never clear the other.
export function attachDirectionRetrieval<K extends DirectionPad>(pad: K, host: HTMLElement,
    read: () => PadQuery<K> | undefined, apply: (text: string) => void) {
    const result = document.createElement('div')
    result.className = 'ft-direction-result'
    result.dataset.directionResult = pad
    result.hidden = true
    const text = document.createElement('p')
    text.setAttribute('aria-live','polite')
    const use = document.createElement('button')
    use.type = 'button'
    use.dataset.i18n = ''
    use.textContent = 'Use for generation'
    result.append(text, use)
    host.append(result)
    let pending: {controller: AbortController; signature: string; provider: NonNullable<DirectionRetrievers[K]>} | undefined
    function clear() {
        pending?.controller.abort()
        pending = undefined
        text.textContent = ''
        result.hidden = true
    }
    function refresh() {
        if (pending && (pending.provider !== window.flowtuDirectionRag?.[pad] || JSON.stringify(read()) !== pending.signature)) clear()
    }
    async function retrieve() {
        clear()
        const provider = window.flowtuDirectionRag?.[pad]
        if (!provider) return
        const query = read()
        if (!query) return
        const controller = new AbortController()
        const request = {provider, controller, signature: JSON.stringify(query)}
        pending = request
        try {
            const match = await provider(query, {signal: controller.signal})
            refresh()
            if (pending !== request) return
            if (!match) {clear(); return}
            if (typeof match.text !== 'string' || match.text.trim().length > 500) throw new Error('Invalid retriever response.')
            const suggestion = match.text.trim()
            if (!suggestion) {clear(); return}
            text.textContent = suggestion
            use.hidden = false
            result.hidden = false
        } catch {
            refresh()
            if (pending !== request) return
            text.textContent = tr('Direction suggestions unavailable.')
            use.hidden = true
            result.hidden = false
        }
    }
    use.onclick = () => {
        refresh()
        if (pending && !use.hidden && text.textContent) apply(text.textContent)
    }
    return {retrieve, refresh, clear}
}
