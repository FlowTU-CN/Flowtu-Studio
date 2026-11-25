const fieldsAndMenus = 'input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=slider],[role=menu],[data-menu-group-id],[data-flowtu-menu]'

export const primaryContentCanvas = (content: HTMLElement): HTMLCanvasElement | null =>
    content.querySelector<HTMLCanvasElement>('canvas[data-audio-editor],canvas[data-note-editor],canvas[data-value-editor]')

/** Restore the native editor's shortcut context without reimplementing its editing commands. */
export function installContentEditorFocus(element: HTMLElement, content: HTMLElement): {terminate(): void} {
    const document = element.ownerDocument
    const targetCanvas = (event: Event): HTMLCanvasElement | null => {
        if (event.defaultPrevented || !(event.target instanceof Element)
            || !element.contains(event.target) || event.target.closest(fieldsAndMenus)
            || document.querySelector('dialog[open],[role=menu],[data-menu-group-id]')) return null
        const kind = element.dataset.editorKind
        if (kind !== 'notes' && kind !== 'value') return null
        return content.querySelector<HTMLCanvasElement>(kind === 'notes' ? 'canvas[data-note-editor]' : 'canvas[data-value-editor]')
    }
    const keydown = (event: KeyboardEvent) => {
        if (event.isComposing || event.altKey) return
        const canvas = targetCanvas(event)
        if (!canvas || event.target === canvas) return
        const command = event.metaKey || event.ctrlKey, key = event.key.toLowerCase()
        const notes = element.dataset.editorKind === 'notes'
        const commonCommand = command && (key === 'a' || !event.shiftKey && (['c', 'x', 'v'].includes(key) || notes && key === 'd'))
        const deletion = !command && !event.shiftKey && (key === 'delete' || key === 'backspace')
        const pitch = notes && !command && (key === 'arrowup' || key === 'arrowdown')
        // The ruler's left/right keys continue to seek the playback position.
        const notePosition = notes && !command && !event.shiftKey && content.contains(event.target as Node)
            && (key === 'arrowleft' || key === 'arrowright')
        if (commonCommand || deletion || pitch || notePosition) canvas.focus({preventScroll: true})
    }
    const clipboard = (event: ClipboardEvent) => {
        const canvas = targetCanvas(event)
        if (!canvas || event.target === canvas) return
        canvas.focus({preventScroll: true})
        // System-menu copy/cut targets the previously focused ruler/header. Forward the
        // same clipboard payload through the native editor, and consume only if it did.
        const forwarded = new ClipboardEvent(event.type, {bubbles: true, cancelable: true, clipboardData: event.clipboardData})
        canvas.dispatchEvent(forwarded)
        if (forwarded.defaultPrevented) {event.preventDefault(); event.stopImmediatePropagation()}
    }
    element.addEventListener('keydown', keydown, true)
    for (const type of ['copy', 'cut', 'paste'] as const) element.addEventListener(type, clipboard, true)
    return {terminate() {
        element.removeEventListener('keydown', keydown, true)
        for (const type of ['copy', 'cut', 'paste'] as const) element.removeEventListener(type, clipboard, true)
    }}
}
