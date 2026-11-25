import {Dragging} from '@opendaw/lib-dom'
import {Option} from '@opendaw/lib-std'

type Position = {x:number; y:number}

/** The title moves the panel in screen pixels, independently of the patch's zoom and scroll. */
export function moveRoutingWindow(dialog: HTMLDialogElement, title: HTMLElement, saved: Position | undefined,
                                  remember: (p: Position | undefined) => void) {
    const clampPosition = ({x, y}: Position) => {
        const visible = Math.min(240, dialog.offsetWidth, window.innerWidth)
        const left = Math.max(visible - dialog.offsetWidth, Math.min(window.innerWidth - visible, x))
        const top = Math.max(0, Math.min(window.innerHeight - title.offsetHeight - 8, y))
        dialog.style.inset = top + 'px auto auto ' + left + 'px'
        dialog.style.margin = '0'
        return {x:left, y:top}
    }
    let position = saved && clampPosition(saved)
    const center = () => {
        dialog.style.removeProperty('inset')
        dialog.style.removeProperty('margin')
        remember(position = undefined)
    }
    const onResize = () => {if (position) remember(position = clampPosition(position))}
    const drag = Dragging.attach(title, event => {
        const start = dialog.getBoundingClientRect()
        const previous = position
        title.classList.add('dragging')
        return Option.wrap({
            update: ({clientX, clientY}: Dragging.Event) => {
                position = clampPosition({x:start.left + clientX - event.clientX, y:start.top + clientY - event.clientY})
            },
            cancel: () => {if (previous) position = clampPosition(previous); else center()},
            finally: () => {title.classList.remove('dragging'); remember(position)}
        })
    }, {immediate:true})
    const keyboard = (event: KeyboardEvent) => {
        if (event.key === 'Home') {event.preventDefault(); event.stopPropagation(); center(); return}
        const step = event.shiftKey ? 40 : 10
        const directions: Record<string,Position> = {ArrowLeft:{x:-step,y:0}, ArrowRight:{x:step,y:0}, ArrowUp:{x:0,y:-step}, ArrowDown:{x:0,y:step}}
        const delta = directions[event.key]
        if (!delta) return
        event.preventDefault()
        event.stopPropagation()
        const {left,top} = dialog.getBoundingClientRect()
        remember(position = clampPosition({x:left + delta.x, y:top + delta.y}))
    }
    title.tabIndex = 0
    title.setAttribute('role','group')
    title.setAttribute('data-i18n','')
    title.setAttribute('aria-label','Move routing window')
    title.title = 'Drag to move the window. Double-click to center.'
    title.addEventListener('dblclick',center)
    title.addEventListener('keydown',keyboard)
    window.addEventListener('resize',onResize)
    return () => {
        drag.terminate()
        title.removeEventListener('dblclick',center)
        title.removeEventListener('keydown',keyboard)
        window.removeEventListener('resize',onResize)
    }
}
