import './toolbar-menu.css'

let nextId = 0
let activeMenu: {close: (restoreFocus?: boolean) => void} | undefined
const nativeFields = 'input,select,textarea,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=slider]'
const focusable = 'summary,button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'

/** A disclosure panel that retains its existing controls and their DOM ancestry. */
export function createToolbarMenu(label: string, {closeOnAction = true}: {closeOnAction?: boolean} = {}) {
    const element = document.createElement('div'); element.className = 'flowtu-toolbar-menu'
    const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'flowtu-menu-trigger'
    const text = document.createElement('span'); text.className = 'flowtu-menu-label'
    const chevron = document.createElement('span'); chevron.className = 'flowtu-menu-chevron'; chevron.setAttribute('aria-hidden', 'true')
    chevron.innerHTML = '<svg viewBox="0 0 12 12"><path d="m3 4.5 3 3 3-3"/></svg>'
    trigger.append(text, chevron)
    const panel = document.createElement('div'); panel.className = 'flowtu-menu-panel'; panel.hidden = true; panel.tabIndex = -1
    panel.id = `flowtu-toolbar-menu-${++nextId}`
    panel.setAttribute('role', 'group')
    trigger.setAttribute('aria-controls', panel.id); trigger.setAttribute('aria-expanded', 'false')
    trigger.dataset.flowtuMenu = 'trigger'; panel.dataset.flowtuMenu = 'panel'
    element.append(trigger, panel)
    let opened = false, disposed = false, nativePopover = typeof panel.showPopover === 'function'
    let fallbackHost: HTMLElement | null = null, fallbackHostHadClass = false
    let frame = 0
    if (nativePopover) panel.setAttribute('popover', 'manual')
    panel.dataset.placement = nativePopover ? 'popover' : 'fallback'

    const setLabel = (value: string) => {text.textContent = value; panel.setAttribute('aria-label', value)}
    setLabel(label)
    const isInside = (target: EventTarget | null) => target instanceof Node && element.contains(target)
    const controls = () => [...panel.querySelectorAll<HTMLElement>(focusable)].filter(control =>
        !control.closest('[hidden],[inert]') && control.getClientRects().length > 0)
    const focusEdge = (last = false) => {const items = controls(); (items[last ? items.length - 1 : 0] ?? panel).focus({preventScroll: true})}
    const position = () => {
        if (!opened || disposed) return
        const viewport = window.visualViewport
        const leftEdge = (viewport?.offsetLeft ?? 0) + 8, topEdge = (viewport?.offsetTop ?? 0) + 8
        const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
        panel.style.maxWidth = `${Math.max(32, width - 16)}px`
        panel.style.maxHeight = `${Math.max(32, height - 16)}px`
        const anchor = trigger.getBoundingClientRect(), bounds = panel.getBoundingClientRect()
        const rightEdge = leftEdge + width - 16, bottomEdge = topEdge + height - 16
        const below = anchor.bottom + 6, above = anchor.top - bounds.height - 6
        const preferred = below + bounds.height <= bottomEdge || anchor.top - topEdge < bottomEdge - anchor.bottom ? below : above
        const x = Math.max(leftEdge, Math.min(anchor.left, rightEdge - bounds.width))
        const y = Math.max(topEdge, Math.min(preferred, bottomEdge - bounds.height))
        const offset = nativePopover ? {left: 0, top: 0} : element.getBoundingClientRect()
        panel.style.left = `${x - offset.left}px`; panel.style.top = `${y - offset.top}px`
    }
    const schedulePosition = () => {
        if (!opened || frame) return
        frame = requestAnimationFrame(() => {frame = 0; position()})
    }
    const close = (restoreFocus = true) => {
        if (!opened) return
        const hadFocus = panel.contains(document.activeElement) || document.activeElement === trigger
        opened = false
        if (activeMenu === api) activeMenu = undefined
        if (frame) {cancelAnimationFrame(frame); frame = 0}
        if (nativePopover) {try {panel.hidePopover()} catch {/* A fullscreen transition can already have hidden it. */}}
        panel.hidden = true; trigger.setAttribute('aria-expanded', 'false')
        if (fallbackHost && !fallbackHostHadClass) fallbackHost.classList.remove('flowtu-menu-fallback-open')
        fallbackHost = null
        // Do not steal focus from a dialog or editor opened by an action.
        if (restoreFocus && hadFocus && trigger.isConnected) trigger.focus({preventScroll: true})
    }
    const open = (focus?: 'first' | 'last') => {
        if (disposed || trigger.disabled || !element.isConnected) return
        if (!opened) {
            activeMenu?.close(false); activeMenu = api
            opened = true; panel.hidden = false; trigger.setAttribute('aria-expanded', 'true')
            if (nativePopover) {
                try {panel.showPopover()}
                catch {nativePopover = false; panel.removeAttribute('popover'); panel.dataset.placement = 'fallback'}
            }
            if (!nativePopover) {
                fallbackHost = element.closest<HTMLElement>('.flowtu-bar,.flowtu-editing-toolbar')
                fallbackHostHadClass = fallbackHost?.classList.contains('flowtu-menu-fallback-open') ?? false
                fallbackHost?.classList.add('flowtu-menu-fallback-open')
            }
            position()
        }
        if (focus) focusEdge(focus === 'last')
    }
    const triggerClick = (event: MouseEvent) => {if (opened) close(); else open(event.detail === 0 ? 'first' : undefined)}
    const triggerKeys = (event: KeyboardEvent) => {
        if (event.metaKey || event.ctrlKey) return
        // Keep native Enter/Space button activation, but not the DAW's window shortcuts.
        if (event.key !== 'Tab') event.stopPropagation()
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault(); event.stopPropagation(); open(event.key === 'ArrowUp' ? 'last' : 'first')
    }
    const panelKeys = (event: KeyboardEvent) => {
        const nativeField = event.target instanceof Element && event.target.closest(nativeFields)
        if (!nativeField && (event.metaKey || event.ctrlKey)) return
        if (event.key !== 'Tab') event.stopPropagation()
        if (nativeField) return
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        const items = controls(); if (!items.length) return
        event.preventDefault(); event.stopPropagation()
        const current = items.indexOf(document.activeElement as HTMLElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (current + 1) % items.length : (current <= 0 ? items.length : current) - 1
        items[next].focus({preventScroll: true})
    }
    const escape = (event: KeyboardEvent) => {
        if (!opened || event.key !== 'Escape' || event.isComposing) return
        if (event.target instanceof Element && event.target.closest(nativeFields)) {
            // Let range/time fields restore their draft before closing causes blur/change.
            // Their native Escape behavior must also remain available to selects and inputs.
            queueMicrotask(() => {
                if (disposed) return
                close()
                if (document.activeElement === document.body && trigger.isConnected) trigger.focus({preventScroll: true})
            })
            return
        }
        event.preventDefault(); event.stopImmediatePropagation(); close()
    }
    const outside = (event: PointerEvent) => {if (opened && !isInside(event.target)) close(false)}
    const focusChanged = (event: FocusEvent) => {if (opened && !isInside(event.target)) close(false)}
    const actionClick = (event: MouseEvent) => {
        if (!opened || !closeOnAction || !(event.target instanceof Element)) return
        if (event.target.closest('[data-menu-keep-open],form') || event.target.closest(nativeFields)) return
        const action = event.target.closest<HTMLElement>('button,a[href]')
        if (action && panel.contains(action) && !action.matches(':disabled,[aria-disabled=true]')) close()
    }
    // Native fullscreen changes can dismiss popovers without a click.
    const popoverChanged = (event: Event) => {if ((event as ToggleEvent).newState === 'closed' && opened) close(false)}
    const blurred = () => close(false)
    const scroll = (event: Event) => {if (opened && !(event.target instanceof Node && panel.contains(event.target))) schedulePosition()}
    trigger.addEventListener('click', triggerClick); trigger.addEventListener('keydown', triggerKeys)
    panel.addEventListener('keydown', panelKeys); panel.addEventListener('click', actionClick); panel.addEventListener('toggle', popoverChanged)
    document.addEventListener('keydown', escape, true); document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', focusChanged, true); document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', schedulePosition); window.addEventListener('blur', blurred)
    window.visualViewport?.addEventListener('resize', schedulePosition); window.visualViewport?.addEventListener('scroll', schedulePosition)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedulePosition)
    observer?.observe(trigger); observer?.observe(panel)
    const dispose = () => {
        if (disposed) return
        close(false); disposed = true; observer?.disconnect()
        trigger.removeEventListener('click', triggerClick); trigger.removeEventListener('keydown', triggerKeys)
        panel.removeEventListener('keydown', panelKeys); panel.removeEventListener('click', actionClick); panel.removeEventListener('toggle', popoverChanged)
        document.removeEventListener('keydown', escape, true); document.removeEventListener('pointerdown', outside, true)
        document.removeEventListener('focusin', focusChanged, true); document.removeEventListener('scroll', scroll, true)
        window.removeEventListener('resize', schedulePosition); window.removeEventListener('blur', blurred)
        window.visualViewport?.removeEventListener('resize', schedulePosition); window.visualViewport?.removeEventListener('scroll', schedulePosition)
        window.removeEventListener('pagehide', dispose)
    }
    const api = {element, trigger, panel, setLabel, close, dispose}
    window.addEventListener('pagehide', dispose, {once: true})
    return api
}
