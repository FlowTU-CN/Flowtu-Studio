import {defaultFloatingVideo, fitFloatingVideo, readFloatingVideoGeometry, type FloatingVideoGeometry} from './floating-video-geometry'
import './floating-video.css'
import {halfPicture} from './picture-size'

const layoutKey = 'flowtu.referenceVideo.layout.v1'
const controls = 'button,input,select,textarea,a,[contenteditable=true]'

/** Moves the existing video element's panel without rebuilding media or changing transport sync. */
export function installFloatingVideo(panel: HTMLElement) {
    const header = panel.querySelector<HTMLElement>('header')!
    const viewport = () => ({width: window.innerWidth, height: window.innerHeight})
    let geometry: FloatingVideoGeometry
    try {geometry = readFloatingVideoGeometry(localStorage.getItem(layoutKey)) ?? defaultFloatingVideo(viewport())}
    catch {geometry = defaultFloatingVideo(viewport())}
    let disposed = false
    let gesture: {id: number; mode: 'move' | 'resize'; target: HTMLElement; x: number; y: number; before: FloatingVideoGeometry} | undefined

    panel.classList.add('flowtu-video-floating')
    panel.setAttribute('aria-label', 'Floating reference video')
    header.classList.add('floating-video-titlebar')
    header.tabIndex = 0
    header.setAttribute('aria-label', 'Move video window')
    header.title = 'Drag to move. Arrow keys move the window; Shift moves faster.'
    const grip = document.createElement('span'); grip.className = 'floating-video-grip'; grip.setAttribute('aria-hidden', 'true')
    grip.innerHTML = '<svg viewBox="0 0 12 18"><circle cx="3" cy="3" r="1.4"/><circle cx="9" cy="3" r="1.4"/><circle cx="3" cy="9" r="1.4"/><circle cx="9" cy="9" r="1.4"/><circle cx="3" cy="15" r="1.4"/><circle cx="9" cy="15" r="1.4"/></svg>'
    header.prepend(grip)
    const resetButton = document.createElement('button'); resetButton.type = 'button'; resetButton.className = 'floating-video-reset'
    resetButton.textContent = 'Reset'; resetButton.setAttribute('aria-label', 'Reset video window position'); resetButton.title = 'Restore the video window position and size'
    // Append after the existing close button so integrations querying the first header button keep working.
    header.append(resetButton)
    const resizeHandle = document.createElement('button'); resizeHandle.type = 'button'; resizeHandle.className = 'floating-video-resize'
    resizeHandle.setAttribute('aria-label', 'Resize video window'); resizeHandle.title = 'Drag to resize. Arrow keys change the size.'
    resizeHandle.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 15 10-10M10 16l6-6M15 17l2-2"/></svg>'
    panel.append(resizeHandle)

    const persist = () => {try {localStorage.setItem(layoutKey, JSON.stringify(geometry))} catch {/* Storage can be disabled in embedded/private sessions. */}}
    const apply = (next: FloatingVideoGeometry, save = false) => {
        if (disposed) return
        geometry = fitFloatingVideo(next, viewport())
        panel.style.left = `${geometry.x}px`; panel.style.top = `${geometry.y}px`
        panel.style.right = 'auto'; panel.style.bottom = 'auto'
        panel.style.width = `${geometry.width}px`; panel.style.height = `${geometry.height}px`
        if (save) persist()
    }
    const finish = (cancel = false) => {
        const active = gesture; if (!active) return
        gesture = undefined; panel.classList.remove('is-dragging', 'is-resizing')
        if (active.target.hasPointerCapture(active.id)) active.target.releasePointerCapture(active.id)
        apply(cancel ? active.before : geometry, true)
    }
    const start = (event: PointerEvent, mode: 'move' | 'resize', target: HTMLElement) => {
        if (event.button !== 0 || !event.isPrimary || gesture || disposed) return
        if (mode === 'move' && event.target instanceof Element && event.target.closest(controls)) return
        event.preventDefault(); event.stopPropagation()
        gesture = {id: event.pointerId, mode, target, x: event.clientX, y: event.clientY, before: {...geometry}}
        target.focus({preventScroll: true}); target.setPointerCapture(event.pointerId)
        panel.classList.add(mode === 'move' ? 'is-dragging' : 'is-resizing')
    }
    const moveStart = (event: PointerEvent) => start(event, 'move', header)
    const resizeStart = (event: PointerEvent) => start(event, 'resize', resizeHandle)
    const move = (event: PointerEvent) => {
        const active = gesture; if (!active || event.pointerId !== active.id) return
        event.preventDefault(); event.stopPropagation()
        const dx = event.clientX - active.x, dy = event.clientY - active.y
        apply(active.mode === 'move'
            ? {...active.before, x: active.before.x + dx, y: active.before.y + dy}
            : {...active.before, width: active.before.width + dx, height: active.before.height + dy})
    }
    const up = (event: PointerEvent) => {if (event.pointerId === gesture?.id) {event.preventDefault(); event.stopPropagation(); finish()}}
    const cancel = (event: PointerEvent) => {if (event.pointerId === gesture?.id) finish(true)}
    const blur = () => finish()
    const reset = () => {finish(); apply(defaultFloatingVideo(viewport()), true)}
    const resized = () => {finish(); apply(geometry, true)}
    const keyboard = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && gesture) {event.preventDefault(); event.stopPropagation(); finish(true); return}
        if (event.target !== header && event.target !== resizeHandle) return
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        if (event.key === 'Home') {reset(); return}
        const step = event.shiftKey ? 40 : 10
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
        apply(event.target === resizeHandle
            ? {...geometry, width: geometry.width + dx, height: geometry.height + dy}
            : {...geometry, x: geometry.x + dx, y: geometry.y + dy}, true)
    }
    resetButton.onclick = reset
    header.addEventListener('pointerdown', moveStart)
    resizeHandle.addEventListener('pointerdown', resizeStart)
    for (const target of [header, resizeHandle]) {
        target.addEventListener('pointermove', move); target.addEventListener('pointerup', up)
        target.addEventListener('pointercancel', cancel); target.addEventListener('lostpointercapture', cancel)
    }
    // Scope arrow shortcuts to the floating window, away from DAW timeline bindings.
    panel.addEventListener('keydown', keyboard, true)
    window.addEventListener('resize', resized); window.addEventListener('blur', blur)
    apply(geometry)

    const video = panel.querySelector('video')!
    const fitSource = () => {
        if (!video.videoWidth || !video.videoHeight) return
        const picture = halfPicture(video.videoWidth, video.videoHeight, window.innerWidth * .65, window.innerHeight * .48)
        apply({...geometry, width:picture.width, height:picture.height + 154})
    }
    video.addEventListener('loadedmetadata', fitSource)
    const reveal = () => {
        if (disposed) return
        panel.hidden = false
        apply(geometry)
    }
    const dispose = () => {
        if (disposed) return
        finish(); disposed = true
        video.removeEventListener('loadedmetadata', fitSource)
        header.removeEventListener('pointerdown', moveStart); resizeHandle.removeEventListener('pointerdown', resizeStart)
        for (const target of [header, resizeHandle]) {
            target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up)
            target.removeEventListener('pointercancel', cancel); target.removeEventListener('lostpointercapture', cancel)
        }
        panel.removeEventListener('keydown', keyboard, true); window.removeEventListener('resize', resized); window.removeEventListener('blur', blur)
        window.removeEventListener('pagehide', dispose); grip.remove(); resetButton.remove(); resizeHandle.remove()
    }
    window.addEventListener('pagehide', dispose, {once: true})
    return {reveal, reset, dispose}
}
