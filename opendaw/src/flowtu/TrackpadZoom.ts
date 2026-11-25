import type {StudioService} from '../service/StudioService'

const editingControls = 'input,textarea,select,[contenteditable=true]'
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

// Preserve small touchpad deltas. Notch-normalising each event makes slow pinches
// jump just as far as fast pinches and prevents precise waveform positioning.
export function pinchZoomLogDelta(deltaY: number, deltaMode = 0): number {
    if (!Number.isFinite(deltaY)) return 0
    const pixels = deltaY * ([1, 33, 400][deltaMode] ?? 1)
    return clamp(pixels * .006, -.4, .4)
}

type GestureEvent = Event & {scale: number; clientX?: number; clientY?: number}
type WebkitFullscreenDocument = Document & {webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> | void}
type WebkitFullscreenElement = HTMLElement & {webkitRequestFullscreen?: () => Promise<void> | void}

/** Pinches edit the timeline throughout the workspace, including browser fullscreen. */
export function installTrackpadZoom(service: StudioService) {
    const {range} = service.timeline
    let frame = 0, queuedLogScale = 0, queuedAnchor = range.center
    let gestureScale: number | undefined
    let disposed = false

    const allowed = (event: Event) => !disposed && service.hasProfile && !document.querySelector('dialog[open]') &&
        !(document.documentElement.classList.contains('ft-lite-open') && !(event.target instanceof Element && event.target.closest('[data-lite-native-editor]'))) &&
        !(event.target instanceof Element && event.target.closest(editingControls))
    const consume = (event: Event) => {event.preventDefault(); event.stopImmediatePropagation()}
    const anchorAt = (event: {target: EventTarget | null; clientX?: number; clientY?: number}): number => {
        const regionArea = document.querySelector<HTMLElement>('[data-scope=regions]')
        if (regionArea && range.width > 12 && event.target instanceof Element && regionArea.contains(event.target)) {
            const rect = regionArea.getBoundingClientRect()
            if (rect.width > 12 && Number.isFinite(event.clientX)) return clamp(range.xToValue(event.clientX! - rect.left), range.min, range.max)
        }
        const playhead = range.normalize(service.engine.position.getValue())
        return Number.isFinite(playhead) && playhead >= range.min && playhead <= range.max ? playhead : range.center
    }
    const queue = (logScale: number, event: {target: EventTarget | null; clientX?: number; clientY?: number}) => {
        if (!Number.isFinite(logScale) || logScale === 0) return
        if (!frame) queuedAnchor = anchorAt(event)
        queuedLogScale = clamp(queuedLogScale + logScale, -.8, .8)
        if (frame) return
        frame = requestAnimationFrame(() => {
            frame = 0
            const delta = queuedLogScale; queuedLogScale = 0
            if (!disposed && service.hasProfile) range.scaleBy(Math.expm1(delta), clamp(queuedAnchor, range.min, range.max))
        })
    }
    const wheel = (event: WheelEvent) => {
        // Chromium exposes a touchpad pinch as a pixel-mode wheel with ctrlKey.
        // Ordinary two-finger horizontal / vertical scrolling retains native pan.
        if (!event.ctrlKey || event.metaKey || !allowed(event)) return
        consume(event)
        if (gestureScale !== undefined) return // Safari can emit both event families.
        queue(pinchZoomLogDelta(event.deltaY, event.deltaMode), event)
    }
    const gestureStart = (event: Event) => {
        if (!allowed(event)) return
        consume(event)
        const scale = (event as GestureEvent).scale
        gestureScale = Number.isFinite(scale) && scale > 0 ? scale : 1
    }
    const gestureChange = (event: Event) => {
        if (gestureScale === undefined) return
        consume(event)
        const gesture = event as GestureEvent
        if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return
        if (allowed(event)) queue(clamp(Math.log(gestureScale / gesture.scale), -.4, .4), gesture)
        gestureScale = gesture.scale
    }
    const gestureEnd = (event: Event) => {
        if (gestureScale === undefined) return
        consume(event); gestureScale = undefined
    }
    const endGesture = () => {gestureScale = undefined}
    const options = {capture: true, passive: false}
    document.addEventListener('wheel', wheel, options)
    document.addEventListener('gesturestart', gestureStart, options)
    document.addEventListener('gesturechange', gestureChange, options)
    document.addEventListener('gestureend', gestureEnd, options)
    window.addEventListener('blur', endGesture)

    const isFullscreen = () => !!(document.fullscreenElement || (document as WebkitFullscreenDocument).webkitFullscreenElement)
    const toggleFullscreen = async (): Promise<boolean> => {
        if (isFullscreen()) {
            if (document.exitFullscreen) await document.exitFullscreen()
            else if ((document as WebkitFullscreenDocument).webkitExitFullscreen) await (document as WebkitFullscreenDocument).webkitExitFullscreen!()
            else throw new Error('This browser cannot exit fullscreen. Use Esc or its View menu.')
        } else {
            // Fullscreen the document so the floating video remains in the workspace.
            const root = document.documentElement as WebkitFullscreenElement
            if (root.requestFullscreen) await root.requestFullscreen()
            else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen()
            else throw new Error('Fullscreen is unavailable here. Use the browser’s fullscreen command.')
        }
        return isFullscreen()
    }
    const dispose = () => {
        if (disposed) return
        disposed = true
        if (frame) cancelAnimationFrame(frame)
        frame = 0; queuedLogScale = 0; gestureScale = undefined
        document.removeEventListener('wheel', wheel, true)
        document.removeEventListener('gesturestart', gestureStart, true)
        document.removeEventListener('gesturechange', gestureChange, true)
        document.removeEventListener('gestureend', gestureEnd, true)
        window.removeEventListener('blur', endGesture)
        window.removeEventListener('pagehide', dispose)
    }
    window.addEventListener('pagehide', dispose, {once: true})
    return {dispose, isFullscreen, toggleFullscreen}
}
