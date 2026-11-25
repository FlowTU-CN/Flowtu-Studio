import {tr, watchStudioLanguage} from './studio-language'
import type {Project} from '@opendaw/studio-core'
import type {StudioService} from '../service/StudioService'
import {Mixer} from '../ui/mixer/Mixer'
import {Terminator} from '@opendaw/lib-std'
import {mountLiteEditTools} from './LiteEditTools'

const icons = {
    direction: '<path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 3v6m8 0v6m-5 0v6" stroke-width="3"/>',
    analysis: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16m10-16v16M3 9h4m-4 6h4m10-6h4m-4 6h4"/>',
    sheets: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8m-8 4h8m-8 4h5"/>',
    collapse: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'
}
function control(label: string, glyph?: keyof typeof icons) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.desktopLabel = label
    if (glyph) button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[glyph]+'</svg>'
    return button
}

export function installLiteDesktop(root: HTMLElement, bar: HTMLElement, inspector: HTMLElement, timeline: HTMLElement, service: StudioService) {
    const media = matchMedia('(min-width: 900px)')
    const layout = root.querySelector<HTMLElement>('.ft-lite-layout')!
    const topline = root.querySelector<HTMLElement>('.ft-lite-topline')!
    const analysis = timeline.querySelector<HTMLElement>('.ft-lite-analysis')!
    const topAnchor = document.createComment('Compact project header')
    const analysisAnchor = document.createComment('Inline scene analysis')
    topline.before(topAnchor)
    analysis.before(analysisAnchor)
    const host = bar.parentElement!
    const rail = document.createElement('nav')
    rail.className = 'ft-lite-rail'
    const direction = control('Music direction', 'direction'), scenes = control('Scene analysis', 'analysis')
    const sheets = control('Cue sheets','sheets'), collapse = control('Collapse panel','collapse')
    rail.append(direction, scenes, sheets, collapse)
    layout.prepend(rail)
    const detail = document.createElement('section')
    detail.className = 'ft-lite-native'
    detail.dataset.liteNativeEditor = ''
    detail.tabIndex = -1
    timeline.append(detail)
    const mixerToggle = control('Mixer', 'direction')
    mixerToggle.className = 'ft-lite-mixer-toggle'
    const mixerLabel = document.createElement('span')
    mixerToggle.append(mixerLabel)
    const mixerBody = document.createElement('section')
    mixerBody.className = 'ft-lite-mixer-body'
    mixerBody.id = 'ft-lite-channel-strips'
    mixerToggle.setAttribute('aria-controls', mixerBody.id)
    detail.append(mixerToggle, mixerBody)
    const mixerLife = new Terminator()
    let mixerOpen = false, mixerProject:Project|undefined
    function refreshMixer() {
        mixerToggle.disabled = !service.hasProfile
        const visible = active && mixerOpen && service.hasProfile
        mixerBody.hidden = !visible
        mixerToggle.setAttribute('aria-expanded', String(visible))
        const next = visible ? service.project : undefined
        if (next === mixerProject) return
        mixerLife.terminate()
        mixerBody.replaceChildren()
        mixerProject = next
        if (next) mixerBody.append(Mixer({lifecycle:mixerLife, service, compact:true}))
    }
    mixerToggle.onclick = () => {mixerOpen = !mixerOpen; refreshMixer()}
    const editTools = document.createElement('div')
    timeline.querySelector('.ft-lite-section-head h2')!.after(editTools)
    editTools.hidden = true
    let unmountTools: (() => void) | undefined
    type LeftPanel = 'direction'|'analysis'|'closed'
    let active = false, mounted = false, left: LeftPanel = 'direction'
    let previousLeft: 'direction'|'analysis' = 'direction'
    let proClipLauncher = false, liteClipLauncher = false
    const adopted = new Map<string, {node: HTMLElement; anchor: Comment}>()
    const sources = ['.flowtu-editing-toolbar','[data-panel-type="Timeline"] .flowtu-timeline']
    const tracking=new Terminator()
    let scrollFrame=0
    function revealFocusedTrack() {
        if (!mounted || scrollFrame) return
        scrollFrame=requestAnimationFrame(()=>{
            scrollFrame=0
            const row=detail.querySelector<HTMLElement>('.scrollable .flowtu-track-focused')
            const scroller=row?.closest<HTMLElement>('.scrollable')
            if (!row || !scroller || !row.offsetHeight) return
            const bounds=row.getBoundingClientRect(), viewport=scroller.getBoundingClientRect()
            if (bounds.top<viewport.top) scroller.scrollTop+=bounds.top-viewport.top
            else if (bounds.bottom>viewport.bottom) scroller.scrollTop+=Math.min(bounds.top-viewport.top,bounds.bottom-viewport.bottom)
        })
    }
    function focusTimeline() {
        const target = detail.querySelector<HTMLElement>('[data-scope="regions"]') ?? detail
        target.focus({preventScroll:true})
    }
    function restoreTimeline() {
        unmountTools?.()
        unmountTools = undefined
        editTools.hidden = true
        for (const {node,anchor} of adopted.values()) {
            if (anchor.isConnected) anchor.replaceWith(node)
            else node.remove()
        }
        adopted.clear()
    }
    function mountTimeline() {
        if (!mounted) return
        for (const selector of sources) {
            const original = [...host.querySelectorAll<HTMLElement>(selector)].find(node => !detail.contains(node))
            const existing = adopted.get(selector)
            if (existing) {
                if (!original && existing.node.isConnected && existing.anchor.isConnected) continue
                if (selector === '.flowtu-editing-toolbar') {
                    unmountTools?.()
                    unmountTools = undefined
                    editTools.hidden = true
                }
                existing.node.remove()
                existing.anchor.remove()
                adopted.delete(selector)
            }
            if (!original) continue
            const anchor = document.createComment('Studio panel')
            original.before(anchor)
            adopted.set(selector,{node:original,anchor})
            const next = sources.slice(sources.indexOf(selector)+1).map(key=>adopted.get(key)?.node).find(node=>node)
            detail.insertBefore(original,next ?? mixerToggle)
            if (original.matches('.flowtu-editing-toolbar')) {
                editTools.hidden = false
                unmountTools = mountLiteEditTools(service,editTools,original)
            }
            if (original.matches('.flowtu-timeline')) revealFocusedTrack()
        }
    }
    // Native panels are rebuilt when a different project is opened.
    const panels = new MutationObserver(records => {
        if (!mounted) return
        const recordsOfPanels = records.some(record => !root.contains(record.target) && [...record.addedNodes].some(node =>
            node instanceof HTMLElement && (node.matches('.flowtu-editing-toolbar,.flowtu-timeline,[data-panel-type]') ||
                node.querySelector('.flowtu-editing-toolbar,.flowtu-timeline,[data-panel-type]'))))
        if (recordsOfPanels || [...adopted.values()].some(item=>!item.anchor.isConnected || !item.node.isConnected)) {
            mountTimeline()
            if (document.activeElement===document.body || document.activeElement===detail) focusTimeline()
        }
    })
    detail.hidden=true
    function setMounted(on: boolean) {
        if (on===mounted) return
        mounted = on
        panels.disconnect()
        timeline.classList.toggle('ft-lite-native-open',on)
        detail.hidden = !on
        const clips=service.timeline.clips.visible
        if (on) {
            proClipLauncher=clips.getValue()
            clips.setValue(liteClipLauncher)
            mountTimeline()
            panels.observe(host,{childList:true,subtree:true})
            const focusChanges=tracking.own(new Terminator())
            tracking.own(service.projectProfileService.catchupAndSubscribe(profile=>{
                focusChanges.terminate()
                profile.ifSome(({project})=>focusChanges.own(project.timelineFocus.track.catchupAndSubscribe(revealFocusedTrack)))
            }))
            focusTimeline()
        } else {
            tracking.terminate()
            cancelAnimationFrame(scrollFrame);scrollFrame=0
            liteClipLauncher=clips.getValue()
            restoreTimeline()
            clips.setValue(proClipLauncher)
        }
    }
    function paint() {
        const enabled = active && media.matches
        const collapsed = left === 'closed'
        layout.dataset.leftPanel = left
        rail.hidden = !enabled
        direction.setAttribute('aria-pressed',String(left==='direction'))
        scenes.setAttribute('aria-pressed',String(left==='analysis'))
        collapse.setAttribute('aria-expanded',String(!collapsed))
        collapse.dataset.desktopLabel = collapsed ? 'Expand panel' : 'Collapse panel'
        for (const el of [direction,scenes,sheets,collapse]) el.ariaLabel = el.title = tr(el.dataset.desktopLabel!)
        mixerLabel.textContent = mixerToggle.title = tr('Mixer')
        const mixerHost = enabled ? detail : timeline
        if (mixerToggle.parentElement !== mixerHost) mixerHost.append(mixerToggle,mixerBody)
        refreshMixer()
        setMounted(enabled)
        if (enabled) {
            if (topline.parentElement!==bar) bar.append(topline)
            if (analysis.parentElement!==layout) layout.append(analysis)
        } else {
            if (topline.parentElement!==root) topAnchor.after(topline)
            if (analysis.parentElement!==timeline) analysisAnchor.after(analysis)
        }
    }
    function showPanel(value: LeftPanel) {
        if (value !== 'closed') previousLeft=value
        left=value
        paint()
    }
    direction.onclick = () => showPanel('direction')
    scenes.onclick = () => showPanel('analysis')
    collapse.onclick = () => showPanel(layout.dataset.leftPanel==='closed' ? previousLeft : 'closed')
    sheets.onclick = () => inspector.querySelector<HTMLButtonElement>('.ft-sheets-open')?.click()
    const profileChanges = service.projectProfileService.subscribe(refreshMixer)
    paint()
    media.addEventListener('change',paint)
    const unlang = watchStudioLanguage(paint)
    return {activate(on:boolean){active=on;paint()}, dispose() {
        active=false;paint();panels.disconnect();media.removeEventListener('change',paint);unlang()
        profileChanges.terminate();mixerLife.terminate();mixerToggle.remove();mixerBody.remove()
        rail.remove();detail.remove();editTools.remove();topAnchor.remove();analysisAnchor.remove()
    }}
}
