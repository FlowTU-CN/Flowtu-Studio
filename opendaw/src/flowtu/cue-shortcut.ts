/** Both studio windows write to the same project transport and cue sheet. */
export function handleCueShortcut(event: KeyboardEvent, doc: Document, mark?: () => boolean): boolean {
    if (!mark || event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        (event.code !== 'KeyM' && event.key.toLowerCase() !== 'm')) return false

    // Use the event's own DOM, including when the reference monitor is in another window.
    const target = event.composedPath()[0] as Element | undefined
    const field = target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=slider]')
    if (field && !field.classList.contains('ft-score-seek')) return false
    if (doc.querySelector('dialog[open],[role=dialog][aria-modal=true]:not([hidden]),[role=menu]:not([hidden]),[data-menu-group-id],[data-flowtu-menu=panel]:not([hidden]),.ft-monitor-menu:not([hidden])')) return false
    if (!event.repeat && !mark()) return false
    event.preventDefault()
    event.stopImmediatePropagation()
    return true
}
