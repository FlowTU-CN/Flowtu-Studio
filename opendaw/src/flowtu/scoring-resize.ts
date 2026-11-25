import {halfPicture} from './picture-size'
import {Dragging} from '@opendaw/lib-dom'
import {Option, Terminable} from '@opendaw/lib-std'

export function installScoringResize(root: HTMLElement) {
    const body = root.querySelector<HTMLElement>('.ft-score-body')!
    const [cuePanel, monitor, results, toolbox] = [...body.children] as HTMLElement[]
    const surface = root.parentElement!
    const divider = (label: string, horizontal: boolean, begin: () => (delta: number) => void) => {
        const grip = document.createElement('div')
        grip.className = 'ft-score-divider'
        grip.tabIndex = 0
        grip.setAttribute('role', 'separator')
        grip.setAttribute('aria-orientation', horizontal ? 'horizontal' : 'vertical')
        grip.setAttribute('aria-label', label)
        grip.title = label
        const axis = horizontal ? 'clientY' : 'clientX'
        const drag = Dragging.attach(grip, start => {
            const move = begin()
            return Option.wrap({update: event => move(event[axis] - start[axis])})
        })
        grip.onkeydown = event => {
            const keys = horizontal ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
            const index = keys.indexOf(event.key)
            if (index < 0) return
            event.preventDefault(); event.stopPropagation()
            begin()(index === 0 ? -16 : 16)
        }
        return {grip, drag}
    }
    const side = (pane: HTMLElement, variable: string, direction = 1) => () => {
        const width = pane.offsetWidth
        const total = surface.clientWidth
        const monitorMinimum = parseFloat(getComputedStyle(monitor).minWidth)
        const max = width + monitor.offsetWidth - monitorMinimum
        return (delta: number) => {
            surface.style.setProperty(variable, `${100 * Math.min(max, width + direction * delta) / total}%`)
        }
    }
    const left = divider('Resize scoring sidebar', false, side(cuePanel, '--ft-cue-width'))
    const right = divider('Resize cue results and video', false, side(results, '--ft-result-width'))
    const toolboxDivider = divider('Resize toolbox', false, side(toolbox, '--ft-toolbox-width', -1))
    const setHeight = (height: number) => {
        monitor.dataset.proPictureResized = ''
        surface.style.setProperty('--ft-picture-height', height + 'px')
    }
    const bottom = divider('Resize scoring workspace and timeline', true, () => {
        const height = monitor.offsetHeight
        return delta => setHeight(height + delta)
    })
    // The monitor's left edge meets the media pane. Dragging the lower-left
    // corner can change both columns and the timeline split in one gesture.
    const corner = document.createElement('button')
    corner.type = 'button'; corner.className = 'ft-picture-corner'
    corner.title = corner.ariaLabel = 'Resize video monitor · drag or use arrow keys'
    monitor.prepend(corner)
    const changeWidth = side(results, '--ft-result-width')
    const cornerDrag = Dragging.attach(corner, start => {
        const move = changeWidth(), height = monitor.offsetHeight
        return Option.wrap({update: event => {
            move(event.clientX - start.clientX)
            setHeight(height + event.clientY - start.clientY)
        }})
    })
    corner.onkeydown = event => {
        const {key} = event
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(key)) return
        event.preventDefault(); event.stopPropagation()
        if (key === 'Home') {
            delete monitor.dataset.proPictureResized
            surface.style.removeProperty('--ft-picture-height')
            surface.style.removeProperty('--ft-result-width')
        } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
            changeWidth()(key === 'ArrowLeft' ? -16 : 16)
        } else {
            setHeight(monitor.offsetHeight + (key === 'ArrowUp' ? -16 : 16))
        }
    }
    let source = '', sourceWidth = 0, sourceHeight = 0
    const updateFit = () => {
        if (sourceWidth > 0 && sourceHeight > 0 && monitor.clientWidth > 20) {
            const picture = halfPicture(sourceWidth, sourceHeight, monitor.clientWidth - 20, Math.max(80, window.innerHeight * .45 - 56))
            surface.style.setProperty('--ft-picture-auto', picture.height + 56 + 'px')
        } else {
            surface.style.removeProperty('--ft-picture-auto')
        }
    }
    let lastWidth = -1
    const observer = new ResizeObserver(entries => {
        const width = entries[0].contentRect.width
        if (width !== lastWidth) {lastWidth = width; updateFit()}
    })
    observer.observe(monitor)
    cuePanel.after(left.grip)
    results.before(right.grip)
    toolbox.before(toolboxDivider.grip)
    root.append(bottom.grip)
    const gestures = Terminable.many(left.drag, right.drag, toolboxDivider.drag, bottom.drag, cornerDrag)
    return {
        fitVideo(url: string, width: number, height: number) {
            if (source !== url) {
                source = url
                delete monitor.dataset.proPictureResized
                surface.style.removeProperty('--ft-picture-height')
            }
            sourceWidth = width; sourceHeight = height
            monitor.style.setProperty('--ft-picture-half-width', width > 0 ? (width / 2) + 'px' : '100%')
            monitor.style.setProperty('--ft-picture-half-height', height > 0 ? (height / 2) + 'px' : '100%')
            updateFit()
        },
        terminate() {observer.disconnect(); gestures.terminate()}
    }
}
