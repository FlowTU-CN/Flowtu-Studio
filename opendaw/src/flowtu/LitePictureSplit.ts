import {Dragging} from '@opendaw/lib-dom'
import {Option} from '@opendaw/lib-std'
import {halfPicture} from './picture-size'
import {tr, watchStudioLanguage} from './studio-language'

/** The separator stays in the monitor column so dragging it never touches the timeline playhead. */
export function installLitePictureSplit(layout: HTMLElement, viewer: HTMLElement, monitor: HTMLElement) {
    const grip = document.createElement('div')
    grip.className = 'ft-lite-picture-split'
    grip.tabIndex = 0
    grip.setAttribute('role', 'separator')
    grip.setAttribute('aria-orientation', 'horizontal')
    const label = () => {grip.title = grip.ariaLabel = tr('Resize picture and timeline')}
    label()
    const unlang = watchStudioLanguage(label)
    viewer.append(grip)
    let source: File | undefined, manual: number | undefined
    const applyHeight = (requested: number, min: number, max: number) => {
        const size = Math.round(Math.min(max, Math.max(min, requested)))
        layout.style.setProperty('--ft-lite-picture-height', size + 'px')
        grip.setAttribute('aria-valuemin', String(Math.round(min)))
        grip.setAttribute('aria-valuemax', String(Math.round(max)))
        grip.setAttribute('aria-valuenow', String(size))
    }
    const update = () => {
        if (!viewer.clientWidth) return
        const header = viewer.querySelector('header')!
        const transport = monitor.querySelector<HTMLElement>('.ft-monitor-transport')!
        const chrome = header.offsetHeight + transport.offsetHeight + grip.offsetHeight
        const min = chrome + 50
        const height = window.innerWidth >= 900 ? layout.clientHeight : window.innerHeight
        const max = Math.max(min, height - (window.innerWidth >= 900 ? 120 : 100))
        const video = monitor.querySelector('video')
        if (manual !== undefined) {
            applyHeight(manual, min, max)
        } else if (source && video?.videoWidth && video.videoHeight) {
            const picture = halfPicture(video.videoWidth, video.videoHeight, viewer.clientWidth, Math.max(50, height * .45 - chrome))
            applyHeight(chrome + picture.height, min, max)
        } else {
            layout.style.removeProperty('--ft-lite-picture-height')
            grip.setAttribute('aria-valuenow', String(viewer.offsetHeight))
        }
        viewer.toggleAttribute('data-picture-resized', manual !== undefined)
    }
    const resize = (value: number) => {manual = value; update(); manual = viewer.offsetHeight}
    const drag = Dragging.attach(grip, start => {
        const initial = viewer.offsetHeight
        return Option.wrap({update: event => resize(initial + event.clientY - start.clientY)})
    })
    grip.ondblclick = () => {manual = undefined; update()}
    grip.onkeydown = event => {
        if (!['Home', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        if (event.key === 'Home') {manual = undefined; update()}
        else resize(viewer.offsetHeight + (event.key === 'ArrowUp' ? -1 : 1) * (event.shiftKey ? 32 : 8))
    }
    const observer = new ResizeObserver(update)
    observer.observe(layout)
    observer.observe(viewer.querySelector('header')!)
    observer.observe(monitor.querySelector('.ft-monitor-transport')!)
    window.addEventListener('resize', update)
    return {
        sync(file?: File) {
            if (file !== source) {source = file; manual = undefined}
            update()
        },
        dispose() {drag.terminate(); observer.disconnect(); unlang(); grip.remove(); window.removeEventListener('resize', update)}
    }
}
