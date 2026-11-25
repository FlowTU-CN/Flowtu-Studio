import {attachComposerLayer} from './composer-workspaces'
import {tr} from './studio-language'
import {createComposerToolbox} from './CreativeToolbox'
import './lite-composer-dock.css'

const dimensionsKey = 'flowtu.lite.composer.size.v1'
type Size = {width: number; height: number}
const defaults: Size = {width: 744, height: 113}
function readSize(fallback:Size=defaults): Size {
    try {
        const saved = JSON.parse(localStorage.getItem(dimensionsKey) ?? 'null')
        if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) return saved
    } catch { /* Browser storage is optional. */ }
    return {...fallback}
}

/** The prompt and send button travel with the current viewport; both control the same project. */
export function createLiteComposerDock(prompt: HTMLTextAreaElement, send: HTMLButtonElement, status: HTMLElement, options:{surface?:'lite'|'pro'; clearSelection:()=>void}) {
    const element = document.createElement('section')
    element.className = 'ft-floating-composer ' + (options.surface === 'pro' ? 'ft-pro-composer' : 'ft-lite-dock')
    element.hidden = true
    element.innerHTML = `<div class="ft-lite-dock-glass" role="group">
        <div class="ft-lite-dock-meta"><span class="ft-lite-dock-scope"></span><button type="button" class="ft-dock-clear" hidden>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6"/></svg>
        </button><button type="button" class="ft-lite-dock-hide">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5"/></svg>
        </button></div>
    </div><button type="button" class="ft-lite-dock-show" hidden>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 9v2m3-5v8m4-11v14m4-11v8m3-5v2"/></svg><span></span><i aria-hidden="true"></i>
    </button>`
    const glass = element.firstElementChild as HTMLElement
    const toolbox = createComposerToolbox()
    glass.append(toolbox.element)
    const context = glass.querySelector<HTMLElement>('.ft-lite-dock-scope')!
    const meta = context.parentElement!
    const clear = glass.querySelector<HTMLButtonElement>('.ft-dock-clear')!
    clear.onclick = () => {options.clearSelection(); prompt.focus({preventScroll:true})}
    const hide = glass.querySelector<HTMLButtonElement>('.ft-lite-dock-hide')!
    const show = element.querySelector<HTMLButtonElement>('.ft-lite-dock-show')!
    glass.id = 'ft-lite-composer-' + crypto.randomUUID()
    for (const button of [hide,show]) button.setAttribute('aria-controls',glass.id)
    const origins = [prompt,send,status].map(node => {
        const anchor = document.createComment('Compact composer control')
        node.before(anchor)
        return {node,anchor}
    })
    let size = readSize()
    let detachLayer: (() => void) | undefined
    let fieldsMounted=false
    let originalSendLabel:string|null=null, originalSendTitle='', originalPlaceholder=''
    function collapse(fold:boolean, focus=false) {
        if (fold) toolbox.close()
        element.classList.toggle('ft-composer-folded',fold)
        glass.hidden = fold
        show.hidden = !fold
        show.setAttribute('aria-expanded',String(!fold))
        hide.setAttribute('aria-expanded',String(!fold))
        syncFields()
        if (!fold) paintSize()
        if (focus && !element.hidden) (fold ? show : prompt).focus({preventScroll:true})
    }
    hide.onclick = () => collapse(true,true)
    show.onclick = () => collapse(false,true)
    glass.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) {
            event.preventDefault(); event.stopPropagation(); collapse(true,true)
        }
    },true)

    const bounds = (dimension:keyof Size) => dimension === 'width'
        ? [Math.min(340, Math.max(1, element.clientWidth - 32)), Math.max(1,element.clientWidth - 32)]
        : [96,Math.max(96,Math.floor(window.innerHeight * 0.32))]
    function resize(dimension:keyof Size, value:number) {
        const [min,max] = bounds(dimension)
        const pixels = Math.round(Math.max(min,Math.min(max,value)))
        glass.style.setProperty('--ft-dock-' + dimension, pixels + 'px')
        const handle = glass.querySelector<HTMLElement>('[data-resize="' + dimension + '"]')!
        handle.setAttribute('aria-valuenow', String(pixels))
        handle.setAttribute('aria-valuemin', String(min))
        handle.setAttribute('aria-valuemax', String(max))
        return pixels
    }
    function paintSize() {
        if (!element.clientWidth) return
        resize('width',size.width)
        resize('height',size.height)
    }
    function saveSize() {
        try {localStorage.setItem(dimensionsKey, JSON.stringify(size))} catch { /* Keep the live size. */ }
    }
    function handle(dimension:keyof Size) {
        const width = dimension === 'width', grip = document.createElement('div')
        grip.className = 'ft-lite-dock-grip'; grip.dataset.resize = dimension
        grip.tabIndex = 0; grip.setAttribute('role','separator')
        grip.setAttribute('aria-orientation', width ? 'vertical' : 'horizontal')
        const keys = width ? ['ArrowLeft','ArrowRight'] : ['ArrowDown','ArrowUp']
        const display = () => width ? glass.offsetWidth : glass.offsetHeight
        grip.onkeydown = e => {
            const delta = keys.indexOf(e.key)
            if (delta < 0 && e.key !== 'Home') return
            e.preventDefault(); e.stopPropagation()
            size[dimension] = resize(dimension,e.key === 'Home' ? defaults[dimension] : display() + (delta === 0 ? -16 : 16))
            saveSize()
        }
        grip.ondblclick = () => {size[dimension]=resize(dimension,defaults[dimension]);saveSize()}
        grip.onpointerdown = start => {
            if (start.button !== 0 || !start.isPrimary) return
            start.preventDefault()
            grip.focus({preventScroll:true}); grip.setPointerCapture(start.pointerId)
            const initial = display(), initialSize = size[dimension]
            grip.onpointermove = move => {
                if (move.pointerId !== start.pointerId) return
                const distance = width ? 2 * (move.clientX - start.clientX) : start.clientY - move.clientY
                size[dimension] = resize(dimension, initial + distance)
            }
            const finish = (event:PointerEvent) => {
                if (event.pointerId !== start.pointerId) return
                grip.onpointermove = grip.onpointerup = grip.onpointercancel = grip.onlostpointercapture = null
                if (grip.hasPointerCapture(start.pointerId)) grip.releasePointerCapture(start.pointerId)
                if (event.type === 'pointercancel') {size[dimension] = initialSize; paintSize()}
                else saveSize()
            }
            grip.onpointercancel = grip.onpointerup = grip.onlostpointercapture = finish
        }
        glass.append(grip)
        return grip
    }
    const horizontal = handle('width'), vertical = handle('height')
    const observer = new ResizeObserver(paintSize)
    function labels() {
        toolbox.labels()
        clear.title = clear.ariaLabel = tr('Clear Range')
        horizontal.title = horizontal.ariaLabel = tr('Resize composer width')
        vertical.title = vertical.ariaLabel = tr('Resize composer height')
        glass.ariaLabel = tr(options.surface === 'pro' ? 'Music Creation' : 'Score Lite')
        hide.title = hide.ariaLabel = tr('Collapse panel') + ' (Esc)'
        show.querySelector('span')!.textContent = tr('Music Creation')
        show.title = show.ariaLabel = tr('Expand panel') + ' · ' + tr('Music Creation')
        show.setAttribute('aria-expanded',String(!glass.hidden))
        hide.setAttribute('aria-expanded',String(!glass.hidden))
        if (fieldsMounted) {
            send.ariaLabel = tr('Generate MIDI')
            send.title = send.ariaLabel + ' (Enter)'
            prompt.placeholder = tr('Describe the music for this cue…')
        }
    }
    function syncFields() {
        const attach=!element.hidden && (options.surface !== 'pro' || !glass.hidden)
        if (attach === fieldsMounted) return
        fieldsMounted=attach
        if (attach) {
            originalSendLabel=send.ariaLabel;originalSendTitle=send.title;originalPlaceholder=prompt.placeholder
            prompt.classList.add('ft-dock-field');send.classList.add('ft-dock-send');status.classList.add('ft-dock-feedback')
            meta.after(prompt,send); hide.before(status)
            labels()
        } else {
            prompt.classList.remove('ft-dock-field');send.classList.remove('ft-dock-send');status.classList.remove('ft-dock-feedback')
            send.ariaLabel=originalSendLabel;send.title=originalSendTitle;prompt.placeholder=originalPlaceholder
            for (const {node,anchor} of origins) {
                if (anchor.parentNode) anchor.after(node)
                else node.remove()
            }
        }
    }
    function setActive(on:boolean) {
        if (on === !element.hidden) return
        element.hidden = !on
        syncFields()
        if (on) {
            detachLayer=attachComposerLayer(element)
            size=readSize(size)
            labels()
            observer.observe(element)
            window.addEventListener('resize',paintSize)
            paintSize()
        } else {
            toolbox.close()
            detachLayer?.(); detachLayer=undefined
            observer.disconnect(); window.removeEventListener('resize',paintSize)
        }
    }
    collapse(options.surface === 'pro')
    return {element, setActive, setCollapsed:collapse, labels, setScope(name:string,range:string,selected = false) {
        clear.hidden = !selected
        const text = [name,range].filter(Boolean).join(' · ')
        if (context.textContent !== text) context.textContent = context.title = text
    }, dispose() {
        setActive(false)
        toolbox.dispose()
        for (const {anchor} of origins) anchor.remove()
        element.remove()
    }}
}
