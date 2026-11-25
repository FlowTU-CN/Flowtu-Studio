/** Content-editing dialogs can host the same interactive composer. Transaction dialogs stay exclusive. */
const pages: HTMLDialogElement[] = []
const placements = new Set<(page: HTMLDialogElement | undefined, focus: Element | null) => void>()
const notify = (focus: Element | null) => {
    for (const place of placements) place(pages.at(-1), focus)
}
function leave(page: HTMLDialogElement, focus: Element | null) {
    const index = pages.indexOf(page)
    if (index < 0) return
    pages.splice(index, 1)
    notify(focus)
}
export function openComposerWorkspace(page: HTMLDialogElement) {
    const focus = document.activeElement
    page.showModal()
    pages.push(page)
    page.addEventListener('close', () => {if (!page.open) leave(page, null)}, {once:true})
    notify(focus)
}
export function closeComposerWorkspace(page: HTMLDialogElement) {
    const focus = document.activeElement
    page.close()
    leave(page, focus)
}

export function attachComposerLayer(dock: HTMLElement): () => void {
    const home = document.createComment('Studio composer')
    dock.before(home)
    const topLayer = typeof dock.showPopover === 'function'
    if (topLayer) dock.popover = 'manual'
    const place = (page: HTMLDialogElement | undefined, focus: Element | null) => {
        const restore = focus instanceof HTMLElement && dock.contains(focus) ? focus : null
        if (page && dock.parentElement !== page) page.append(dock)
        else if (!page && dock.previousSibling !== home) home.after(dock)
        // A fixed child of a transformed dialog is still clipped by that dialog. A native
        // popover keeps viewport positioning while the modal remains its accessibility owner.
        if (topLayer && dock.isConnected && !dock.matches(':popover-open')) dock.showPopover()
        restore?.focus({preventScroll:true})
    }
    placements.add(place)
    place(pages.at(-1), null)
    return () => {
        placements.delete(place)
        if (topLayer) {
            if (dock.matches(':popover-open')) dock.hidePopover()
            dock.removeAttribute('popover')
        }
        if (dock.previousSibling !== home) home.after(dock)
        home.remove()
    }
}
