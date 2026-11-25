import {navigationButton,transportSteps,labelNavigation,type TransportNavigation} from './transport-navigation'
import {FRAME_RATES,selectFrameRate,type TimeDisplayMode} from './time-format'
import {timeSettings,setTimeSettings,subscribeTimeSettings} from './time-settings'
import {tr,watchStudioLanguage} from './studio-language'

const glyphs = {
    play: '<path class="play-shape" fill="currentColor" stroke="none" d="M7 4.7a1 1 0 0 1 1.5-.86l11 7.3a1 1 0 0 1 0 1.72l-11 7.3A1 1 0 0 1 7 19.3Z"/><path class="pause-shape" fill="currentColor" stroke="none" d="M6 4h4v16H6zm8 0h4v16h-4z"/>',
    window: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 9h5v5m-5 0 5-5"/>',
    full: '<path d="M8.5 4H4v4.5M15.5 4H20v4.5M20 15.5V20h-4.5M4 15.5V20h4.5"/>',
    more: '<path d="M5 12h.2m6.7 0h.2m6.7 0h.2" stroke-width="3.2"/>'
}
const icon = (key: keyof typeof glyphs) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[key]}</svg>`

export function createVideoTransport(doc: Document, actions: {
    play(): void; navigate(action:TransportNavigation):void; seek(time: number): void; fullscreen(): void | Promise<void>; detach(): void
    cue(): void; importVideo(): void; toggleFit(): void; focusWindow(): void
}) {
    const element = doc.createElement('div')
    element.className = 'ft-monitor-transport'
    element.setAttribute('role', 'group')
    element.setAttribute('aria-label', 'Video playback controls')
    element.innerHTML = `<input class="ft-score-seek" type="range" min="0" max="8" step="0.001" value="0" aria-label="Reference video position">
        <div class="ft-monitor-bar"><div class="ft-monitor-playback"><button type="button" class="ft-monitor-play" data-action="play" aria-label="Play" aria-keyshortcuts="Space">${icon('play')}</button>
        <span class="ft-monitor-meter" role="img" aria-label="Master output level" title="Stereo master output"><i></i><i></i></span></div>
        <div class="ft-monitor-time"><div class="ft-monitor-format"><output class="ft-score-clock" aria-label="Project position" aria-live="off"></output><svg viewBox="0 0 10 8" aria-hidden="true"><path d="m1 2 4 4 4-4" fill="none" stroke="currentColor"/></svg><select data-clock-format></select></div><span aria-hidden="true">/</span><output class="ft-score-duration" aria-label="Timeline end" aria-live="off"></output><select class="ft-monitor-fps" data-clock-rate></select></div>
        <div class="ft-monitor-actions"><button type="button" data-action="popout">${icon('window')}</button><button type="button" data-action="fullscreen" title="Full screen" aria-label="Full screen">${icon('full')}</button>
        <button type="button" data-action="monitor-options" title="Monitor options" aria-label="Monitor options" aria-expanded="false">${icon('more')}</button></div></div>
        <div class="ft-monitor-menu" hidden><button type="button" data-action="cue-play">Play from cue in</button><button type="button" data-action="fit"></button>
        <button type="button" data-action="focus-video">Show video window</button><button type="button" data-action="import-video">Import video…</button></div>`
    const getButton = (action: string) => element.querySelector<HTMLButtonElement>(`[data-action=${action}]`)!
    const seek = element.querySelector<HTMLInputElement>('input')!
    const clock = element.querySelector<HTMLOutputElement>('.ft-score-clock')!, end = element.querySelector<HTMLOutputElement>('.ft-score-duration')!
    const play = getButton('play'), detach = getButton('popout'), full = getButton('fullscreen'), options = getButton('monitor-options')
    const fit = getButton('fit'), focus = getButton('focus-video'), cue = getButton('cue-play'), menu = element.querySelector<HTMLElement>('.ft-monitor-menu')!
    const meter = element.querySelector<HTMLElement>('.ft-monitor-meter')!
    const navigation = transportSteps.map(action=>{
        const button=navigationButton(doc,action,actions.navigate)
        if (action==='next' || action==='previous') button.dataset.gesture=action+'-frame'
        return button
    })
    play.before(...navigation.slice(0,3))
    play.after(...navigation.slice(3))
    const display=element.querySelector<HTMLSelectElement>('[data-clock-format]')!
    const rate=element.querySelector<HTMLSelectElement>('[data-clock-rate]')!
    const displays = {time:'Time',timecode:'Timecode',frames:'Time + frames'} as const
    for (const id of Object.keys(displays)) {
        const option=doc.createElement('option'); option.value=id; display.add(option)
    }
    for (const {id,label} of FRAME_RATES) {
        const option=doc.createElement('option'); option.value=id; option.text=label; rate.add(option)
    }
    const labels=()=>{
        navigation.forEach(labelNavigation)
        for (const option of display.options) option.text=tr(displays[option.value as TimeDisplayMode])
        display.title=display.ariaLabel=tr('Display')
        rate.title=rate.ariaLabel=tr('Frame rate')
    }
    labels()
    const unlang=watchStudioLanguage(labels)
    const untime=subscribeTimeSettings(()=>{
        display.value=timeSettings.display;selectFrameRate(rate,timeSettings.fps)
    })
    display.onchange=()=>setTimeSettings({display:display.value as TimeDisplayMode})
    rate.onchange=()=>setTimeSettings({fps:rate.value})
    for (const select of [display,rate]) select.onkeydown=event=>{if(event.key!=='Tab')event.stopPropagation()}
    const menuOpen = (open: boolean) => {menu.hidden = !open; options.setAttribute('aria-expanded', String(open))}
    options.onclick = () => {menuOpen(menu.hidden); if (!menu.hidden) menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()}
    const showFullscreenState = () => {
        const maximized = !!doc.body.dataset.videoMaximized
        full.title = doc.fullscreenElement ? 'Exit full screen' : maximized ? 'Restore window' : 'Full screen'
        full.setAttribute('aria-label', full.title)
        full.setAttribute('aria-pressed', String(!!doc.fullscreenElement || maximized))
    }
    doc.addEventListener('fullscreenchange', showFullscreenState)
    full.onclick = () => {void Promise.resolve(actions.fullscreen()).then(showFullscreenState)}
    play.onclick = actions.play; detach.onclick = actions.detach
    for (const [control, fn] of [[cue, actions.cue], [fit, actions.toggleFit], [focus, actions.focusWindow], [getButton('import-video'), actions.importVideo]] as const) {
        control.onclick = () => {menuOpen(false); options.focus(); fn()}
    }
    const outside = (event: Event) => {if (!menu.hidden && !element.contains(event.target as Node)) menuOpen(false)}
    doc.addEventListener('pointerdown', outside, true)
    element.addEventListener('focusout', event => {if (!element.contains(event.relatedTarget as Node | null)) menuOpen(false)})
    element.onkeydown = event => {if (event.key === 'Escape' && !menu.hidden) {event.preventDefault(); event.stopPropagation(); menuOpen(false); options.focus()}}
    // Ignore transport echoes only during an actual scrub. Keyboard focus can stay on the slider after playback resumes.
    let scrubbing = false
    seek.onpointerdown = () => {scrubbing = true}
    seek.onpointerup = seek.onpointercancel = seek.onlostpointercapture = () => {scrubbing = false}
    seek.oninput = () => actions.seek(seek.valueAsNumber)
    return {element, seek,
        updatePosition(seconds: number, maximum: number, format: (seconds: number) => string) {
            const text = format(seconds), total = format(maximum)
            if (clock.textContent !== text) clock.textContent = text
            if (end.textContent !== total) end.textContent = total
            seek.max = String(maximum)
            if (!scrubbing) seek.value = String(seconds)
            seek.setAttribute('aria-valuetext', text)
            element.style.setProperty('--film-position', `${Math.min(100, 100 * seek.valueAsNumber / maximum)}%`)
        },
        updateControls(playing: boolean, ready: boolean, hasProject: boolean, detached: boolean, isPopup: boolean, cover: boolean) {
            for (const button of navigation) button.disabled = !hasProject
            play.disabled = cue.disabled = seek.disabled = !hasProject
            play.setAttribute('aria-pressed', String(playing)); play.setAttribute('aria-label', playing ? 'Pause' : 'Play')
            play.title = playing ? 'Pause · Space' : 'Play · Space'
            detach.disabled = !detached && !ready; detach.title = tr(detached ? 'Bring back' : 'Pop out'); detach.setAttribute('aria-label', detach.title)
            full.disabled = !ready; fit.disabled = !ready
            showFullscreenState()
            fit.textContent = cover ? 'Fit picture in frame' : 'Fill frame with picture'
            focus.hidden = !detached || isPopup
        },
        levels(left: number, right: number) {
            // Map the same linear amplitudes as the mixer onto a compact -48 to 0 dB meter.
            for (const [key, amplitude] of [['--left', left], ['--right', right]] as const) {
                meter.style.setProperty(key, Math.min(1, Math.max(0, (48 + 20 * Math.log10(amplitude || 0)) / 48)).toFixed(3))
            }
        },
        dispose() {unlang();untime();doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('fullscreenchange', showFullscreenState); element.remove()}
    }
}
