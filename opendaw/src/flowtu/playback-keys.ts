export type PlaybackKeyAction = 'toggle' | 'stop' | 'start'

export function playbackAction(event: Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isComposing'>, macOS = false): PlaybackKeyAction | undefined {
    if (event.isComposing || event.altKey || event.shiftKey) return
    if (event.ctrlKey || event.metaKey) {
        const goToStart = macOS
            ? event.metaKey && !event.ctrlKey && event.key === 'ArrowLeft'
            : event.ctrlKey && !event.metaKey && event.key === 'Home'
        return goToStart ? 'start' : undefined
    }
    if (event.code === 'Space' || event.key === ' ') return 'toggle'
    if (event.key === '.') return 'stop'
    return undefined
}

/** Capture before native button activation and the global shortcut dispatcher. */
export function installPlaybackKeys(actions: {ready:()=>boolean; toggle:()=>void; stop:()=>void; start:()=>void}, macOS: boolean, target:Document=document):()=>void {
    const keydown=(event:KeyboardEvent)=>{
        if(event.defaultPrevented || !actions.ready() || target.querySelector('dialog[open]')) return
        if(event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=slider],[data-flowtu-menu]')) return
        const action=playbackAction(event, macOS)
        if(!action) return
        event.preventDefault();event.stopImmediatePropagation()
        // Holding Space must not repeatedly start and stop playback.
        if(!event.repeat) actions[action]()
    }
    target.addEventListener('keydown',keydown,true)
    return ()=>target.removeEventListener('keydown',keydown,true)
}
