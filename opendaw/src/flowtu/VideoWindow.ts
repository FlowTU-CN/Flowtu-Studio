import {halfPicture} from './picture-size'
import {handleCueShortcut} from './cue-shortcut'
import {playbackAction} from './playback-keys'

export interface VideoWindowOptions {
    video: HTMLVideoElement
    attachTransport(doc: Document, target: HTMLElement, fullscreen: () => void | Promise<void>, dock: () => void): {dispose(): void}
    restore(): void
    onChange(open: boolean): void
    togglePlayback(): void
    markCue?(): boolean
    stopPlayback?(): void
    returnToStart?(): void
    macOS?: boolean
    tell(message: string): void
    /** Drive the engine's shared frame reader from the visible video window, or restore its normal owner. */
    setFrameWindow?(owner: Window | null): void
}

/** The detached monitor owns its video element while the Studio supplies its source and transport. */
export function installVideoWindow(options: VideoWindowOptions) {
    const {video} = options
    const parentDocument = video.ownerDocument
    const parent = video.ownerDocument.defaultView ?? window
    let popup: Window | undefined, stage: HTMLElement | undefined, transport: {dispose(): void} | undefined
    let picture: HTMLVideoElement | undefined, poll: number | undefined, disposed = false
    let restoreBounds: {x: number; y: number; width: number; height: number} | undefined
    let removeListeners: (() => void) | undefined

    const isOpen = () => !!popup && !popup.closed
    const detach = (closeWindow: boolean, restore: boolean) => {
        const previous = popup
        if (!previous) return
        // Clear ownership before closing or restoring: either may synchronously emit lifecycle events.
        popup = undefined; restoreBounds = undefined
        removeListeners?.(); removeListeners = undefined
        if (poll !== undefined) parent.clearInterval(poll)
        if (picture) {
            picture.pause()
            picture.removeAttribute('src')
            picture.load()
        }
        transport?.dispose(); transport = undefined
        picture = undefined; poll = undefined; stage = undefined
        options.setFrameWindow?.(null)
        if (restore) options.restore()
        if (closeWindow && !previous.closed) previous.close()
        if (!disposed) options.onChange(false)
    }
    const dock = () => detach(true, true)
    const focus = () => {if (isOpen()) popup!.focus()}
    const fullscreen = () => {
        const target = stage?.ownerDocument.body
        if (!isOpen() || !target) return
        const doc = target.ownerDocument
        const owner = popup!
        if (restoreBounds) {
            const {x, y, width, height} = restoreBounds
            restoreBounds = undefined
            delete target.dataset.videoMaximized
            owner.resizeTo(width, height); owner.moveTo(x, y)
            return
        }
        // Some browsers permit script-opened windows to resize, but refuse native fullscreen.
        const maximize = () => {
            if (owner !== popup || owner.closed || restoreBounds) return
            const screen = owner.screen as Screen & {availLeft?: number; availTop?: number}
            restoreBounds = {x: owner.screenX, y: owner.screenY, width: owner.outerWidth, height: owner.outerHeight}
            owner.moveTo(screen.availLeft ?? 0, screen.availTop ?? 0)
            owner.resizeTo(screen.availWidth, screen.availHeight)
            target.dataset.videoMaximized = 'true'
        }
        if (doc.fullscreenElement) return doc.exitFullscreen().catch(() => options.tell('Use Escape to leave full screen.'))
        if (target.requestFullscreen) return target.requestFullscreen().catch(maximize)
        return maximize()
    }
    const open = (): boolean => {
        if (disposed) return false
        if (isOpen()) {focus(); return true}
        if (popup) detach(false, true)
        // Keep this synchronous in the user's click handler so popup blockers can permit it.
        let opened: Window | null
        const size = video.videoWidth && video.videoHeight
            ? halfPicture(video.videoWidth, video.videoHeight, parent.screen.availWidth * .8, parent.screen.availHeight * .72)
            : {width:640,height:360}
        try {opened = parent.open('', '_blank',
            `popup,width=${Math.max(320,size.width)},height=${size.height + 64},resizable=yes,scrollbars=no`)}
        catch {opened = null}
        if (!opened || opened.closed) {
            options.tell('Allow pop-up windows for this site, then choose Pop out again. In an embedded browser, open Flowtu in a desktop browser first.')
            return false
        }
        popup = opened
        try {
            const doc = opened.document
            doc.title = 'Flowtu Studio · Reference Video'
            const style = doc.createElement('style')
            style.textContent = `
                :root{color-scheme:dark;font-family:system-ui,sans-serif;background:#05080d;color:#e8eff7}
                *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
                body{display:flex;flex-direction:column}
                main{position:relative;flex:1;min-height:0;display:grid;place-items:center;background:#000}
                main video{display:block;width:100%!important;height:100%!important;max-width:100%;max-height:100%;object-fit:contain;position:absolute;inset:0;background:#000}
                body[data-film-fit=cover] main video{object-fit:cover}
                body:fullscreen{width:100vw;height:100vh}
            `
            doc.head.append(style)
            stage = doc.createElement('main'); stage.setAttribute('aria-label', 'Reference video')
            doc.body.replaceChildren(stage)
            transport = options.attachTransport(doc, doc.body, fullscreen, dock)
            // Moving a live decoder between documents can reset it in the new window.
            video.pause()
            picture = doc.createElement('video')
            picture.muted = true
            picture.playsInline = true
            picture.preload = 'auto'
            picture.src = video.src
            stage.append(picture)
            const owned = opened
            const keydown = (event: KeyboardEvent) => {
                if (handleCueShortcut(event, doc, options.markCue)) return
                if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey) return
                const target = event.target as Element | null
                // Child-window elements are not instanceof the opener's Element constructor.
                if (target && typeof target.closest === 'function' && target.closest('input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=slider]')) return
                const command = playbackAction(event, options.macOS)
                const action = command && {toggle: options.togglePlayback, stop: options.stopPlayback, start: options.returnToStart}[command]
                if (!action) return
                event.preventDefault(); event.stopImmediatePropagation()
                if (!event.repeat) action()
            }
            const leaving = () => {if (popup === owned) detach(false, true)}
            const updateFrameWindow = () => {
                if (disposed || popup !== owned || owned.closed) return
                options.setFrameWindow?.(doc.hidden ? null : owned)
            }
            owned.addEventListener('pagehide', leaving)
            owned.addEventListener('beforeunload', leaving)
            owned.addEventListener('keydown', keydown, true)
            doc.addEventListener('visibilitychange', updateFrameWindow)
            parentDocument.addEventListener('visibilitychange', updateFrameWindow)
            removeListeners = () => {
                owned.removeEventListener('pagehide', leaving)
                owned.removeEventListener('beforeunload', leaving)
                owned.removeEventListener('keydown', keydown, true)
                doc.removeEventListener('visibilitychange', updateFrameWindow)
                parentDocument.removeEventListener('visibilitychange', updateFrameWindow)
            }
            // Some embedded browsers close windows without forwarding pagehide to the opener.
            poll = parent.setInterval(() => {if (popup === owned && owned.closed) detach(false, true)}, 500)
            options.onChange(true)
            updateFrameWindow()
            focus()
            return true
        } catch {
            detach(true, true)
            options.tell('This browser could not open the video window. Open Flowtu in a desktop browser and try again.')
            return false
        }
    }
    const dispose = () => {
        if (disposed) return
        disposed = true
        // The studio is unloading; do not remount UI or restart playback during teardown.
        detach(true, false)
    }
    return {open, dock, isOpen, focus, fullscreen, dispose, get picture() {return picture}}
}
