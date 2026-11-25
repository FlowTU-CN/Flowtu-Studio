import type {AudioTimeRange} from './audio-range'

type DragContext = {
    bounds: AudioTimeRange
    current: AudioTimeRange
    snap(seconds: number, bypass: boolean): number
    finish(bounds: AudioTimeRange): void
}

/** A project-time overview. Preview locally while dragging; commit one edit on release. */
export function createCreationRange(begin: () => DragContext | undefined,
    preview: (range: AudioTimeRange) => void, restore: () => void, format: (seconds: number) => string) {
    const element = document.createElement('div')
    element.className = 'ft-creation-ruler'
    element.setAttribute('role', 'group')
    element.setAttribute('data-i18n', '')
    element.ariaLabel = element.title = 'Drag to select the creation range'
    element.innerHTML = '<span class="ft-creation-band"><i data-edge="start"></i><i data-edge="end"></i></span><span class="ft-creation-scale" aria-hidden="true"><small></small><small></small></span>'
    const [leftLabel,rightLabel] = element.querySelectorAll('small')
    let cancel: (() => void) | undefined
    function paint(current: AudioTimeRange, bounds: AudioTimeRange) {
        leftLabel.textContent=format(bounds.start); rightLabel.textContent=format(bounds.end)
        const ratio = (s: number) => 100 * Math.max(0, Math.min(1, (s - bounds.start) / (bounds.end - bounds.start)))
        element.style.setProperty('--creation-left', ratio(current.start) + '%')
        element.style.setProperty('--creation-right', (100 - ratio(current.end)) + '%')
    }
    element.onpointerdown = event => {
        if (event.button !== 0 || !event.isPrimary) return
        cancel?.()
        const context = begin()
        if (!context) return
        const {bounds,current} = context
        const pointer = event.pointerId, origin = event.clientX
        const clamp = (value: number) => Math.max(bounds.start, Math.min(bounds.end, value))
        const valueAt = (e: PointerEvent) => {
            const rect = element.getBoundingClientRect()
            const raw = clamp(bounds.start + (e.clientX - rect.left) / Math.max(1, rect.width) * (bounds.end - bounds.start))
            return clamp(context.snap(raw, e.shiftKey))
        }
        const edge = (event.target as HTMLElement).dataset.edge
        const anchor = edge === 'start' ? current.end : edge === 'end' ? current.start : valueAt(event)
        const events = new AbortController(), options = {signal: events.signal}
        let selection: AudioTimeRange | undefined
        const move = (e: PointerEvent) => {
            if (e.pointerId !== pointer || (!selection && Math.abs(e.clientX - origin) < 2)) return
            const value = valueAt(e)
            selection = {start: Math.min(anchor,value), end: Math.max(anchor,value)}
            paint(selection,bounds); preview(selection)
        }
        const finish = () => {
            events.abort(); cancel = undefined
            if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer)
        }
        cancel = () => {finish(); restore()}
        element.setPointerCapture(pointer);event.preventDefault()
        element.addEventListener('pointermove', move, options)
        element.addEventListener('pointerup', e => {
            if (e.pointerId !== pointer) return
            move(e); finish()
            if (selection && selection.end > selection.start) context.finish(selection)
            else restore()
        },options)
        for (const type of ['pointercancel','lostpointercapture'] as const) {
            element.addEventListener(type, e => {if(e.pointerId === pointer) cancel?.()},options)
        }
        window.addEventListener('blur', () => cancel?.(),options)
        window.addEventListener('keydown', e => {
            if (e.key === 'Escape') {e.preventDefault();e.stopImmediatePropagation();cancel?.()}
        },{...options,capture:true})
    }
    return {element, paint, cancel: () => cancel?.()}
}
