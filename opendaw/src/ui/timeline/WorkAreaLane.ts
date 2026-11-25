import {tr, watchStudioLanguage} from "@/flowtu/studio-language"
import {locatorSnap} from './AudioClipSnap'
import {deferNextFrame, Html} from '@opendaw/lib-dom'
import type {Lifecycle} from '@opendaw/lib-std'
import type {StudioService} from '@/service/StudioService'
import {getWorkArea, manualWorkArea, setWorkArea, subscribeWorkAreaPicture} from '@/flowtu/work-area'
import {getTimelineSelection, subscribeTimelineSelection} from '@/flowtu/timeline-selection'
import {formatTimelineTime, getFrameRate, parseTimelineTime} from '@/flowtu/time-format'
import {timeSettings, subscribeTimeSettings} from '@/flowtu/time-settings'
import type {AudioTimeRange} from '@/flowtu/audio-range'

const clock = (seconds: number) => formatTimelineTime(seconds, timeSettings.display, getFrameRate(timeSettings.fps))

export function workAreaControl(service: StudioService, lifecycle: Lifecycle) {
    const {project} = service
    const label = document.createElement('span')
    label.className = 'ft-work-label'
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Work Area ▾'
    button.title = 'Set loop and export locators · P sets them to the selection'
    const dialog = document.createElement('dialog')
    dialog.dataset.i18n = ''
    dialog.className = 'ft-work-dialog'
    dialog.setAttribute('aria-label', 'Export work area')
    dialog.innerHTML = `<form><strong>Loop &amp; export work area</strong><label>In <input name="start" required></label>
        <label>Out <input name="end" required></label><div class="ft-work-presets"><button type="button" name="selection">Use selection · P</button>
        <button type="button" name="auto">Auto · full project</button></div><output role="status"></output>
        <footer><button type="button" name="cancel">Cancel</button><button type="submit">Apply</button></footer></form>`
    const form = dialog.querySelector('form')!
    const start = form.elements.namedItem('start') as HTMLInputElement
    const end = form.elements.namedItem('end') as HTMLInputElement
    const selectionButton = form.elements.namedItem('selection') as HTMLButtonElement
    const output = form.querySelector('output')!
    button.onclick = () => {
        const area = getWorkArea(project)
        start.value = clock(project.tempoMap.ppqnToSeconds(area.start))
        end.value = clock(project.tempoMap.ppqnToSeconds(area.end))
        output.value = ''
        dialog.showModal()
    }
    selectionButton.onclick = () => {
        const area = getTimelineSelection(project)
        if (area) {setWorkArea(project, area); dialog.close()}
    }
    const updateSelection = () => {selectionButton.disabled = !getTimelineSelection(project)}
    lifecycle.own(subscribeTimelineSelection(project, updateSelection))
    updateSelection()
    form.querySelector<HTMLButtonElement>('[name=auto]')!.onclick = () => {setWorkArea(project); dialog.close()}
    form.querySelector<HTMLButtonElement>('[name=cancel]')!.onclick = () => dialog.close()
    form.onsubmit = event => {
        event.preventDefault()
        const times = [start, end].map(field => parseTimelineTime(field.value, timeSettings.display, getFrameRate(timeSettings.fps)))
        if (times[0] === null || times[1] === null) {output.value = 'Enter valid In and Out times.'; return}
        try {
            setWorkArea(project, {start: Math.round(project.tempoMap.secondsToPPQN(times[0])), end: Math.round(project.tempoMap.secondsToPPQN(times[1]))})
            dialog.close()
        } catch (error) {output.value = String(error instanceof Error ? error.message : error)}
    }
    label.append(button, dialog)
    return label
}

export function createWorkAreaLane(service: StudioService, lifecycle: Lifecycle) {
    const {project, timeline: {range, snapping}} = service
    const lane = document.createElement('div')
    lane.dataset.i18n = ''
    lane.className = 'ft-work-lane'
    lane.setAttribute('aria-label', 'Export work area ruler')
    lane.title = 'Drag to set loop and export bounds. Alt-drag to move. Shift bypasses snap. Double-click to toggle loop.'
    const band = document.createElement('div')
    const caption = document.createElement('span')
    const handles = (['start', 'end'] as const).map(edge => {
        const handle = document.createElement('i')
        handle.dataset.edge = edge
        return handle
    })
    band.append(caption)
    lane.append(band, ...handles)
    let saved = getWorkArea(project), automatic = !manualWorkArea(project)
    let draft: AudioTimeRange | undefined
    const paint = () => {
        const area = draft ?? saved
        const left = range.unitToX(area.start), right = range.unitToX(area.end)
        const visibleLeft = Math.max(0, left), visibleRight = Math.min(right, range.width)
        band.style.left = visibleLeft + 'px'
        band.style.width = Math.max(0, visibleRight - visibleLeft) + 'px'
        caption.textContent = (automatic && !draft ? tr('Auto') + '   ' : '') + clock(project.tempoMap.ppqnToSeconds(area.start)) + ' – ' + clock(project.tempoMap.ppqnToSeconds(area.end))
        handles.forEach((h, i) => {
            h.hidden = right <= left
            h.style.left = (i ? right : left) + 'px'
        })
    }
    const loop = project.timelineBox.loopArea
    const reflectLoop = () => {lane.dataset.looping = String(loop.enabled.getValue())}
    const refresh = () => {saved = getWorkArea(project); automatic = !manualWorkArea(project); paint()}
    const {request} = lifecycle.own(deferNextFrame(refresh))
    lifecycle.ownAll(range.subscribe(paint), Html.watchResize(lane, paint), project.editing.subscribe(request),
        loop.enabled.catchupAndSubscribe(reflectLoop), loop.from.subscribe(request), loop.to.subscribe(request),
        project.tempoMap.subscribe(request), subscribeWorkAreaPicture(project, request), {terminate: subscribeTimeSettings(paint)}, {terminate: watchStudioLanguage(paint)})
    let active: number | undefined, anchor = 0, edge: string | undefined
    let origin = 0, startX = 0, span = 0, dragSnap: ReturnType<typeof locatorSnap> | undefined
    const raw = (e: PointerEvent) => range.xToUnit(e.clientX - lane.getBoundingClientRect().left)
    const snap = (pulse: number, bypass: boolean) =>
        Math.min(0x7fffffff, Math.max(0, dragSnap!(pulse, bypass)))
    lane.onpointerdown = e => {
        if (active !== undefined || e.button !== 0 || !e.isPrimary) return
        active = e.pointerId
        startX = e.clientX
        dragSnap = locatorSnap(project, snapping)
        origin = raw(e)
        edge = (e.target as HTMLElement).dataset.edge
        if (e.altKey && saved.start <= origin && origin <= saved.end && saved.end > saved.start) edge = 'move'
        anchor = edge === 'start' ? saved.end : edge === 'end' || edge === 'move' ? saved.start : snap(origin, e.shiftKey)
        span = saved.end - saved.start
        lane.setPointerCapture(active)
        e.preventDefault()
    }
    const update = (e: PointerEvent) => {
        if (!draft && Math.abs(e.clientX - startX) < 2) return
        if (edge === 'move') {
            const start = Math.min(0x7fffffff - span, snap(anchor + raw(e) - origin, e.shiftKey))
            draft = {start, end: start + span}
        } else {
            const offset = edge === 'start' ? saved.start - origin : edge === 'end' ? saved.end - origin : 0
            const next = snap(raw(e) + offset, e.shiftKey)
            draft = edge === 'start' ? {start: Math.min(next, anchor - 1), end: anchor}
                : edge === 'end' ? {start: anchor, end: Math.max(next, anchor + 1)}
                : {start: Math.min(anchor, next), end: Math.max(anchor, next)}
        }
        lane.toggleAttribute('data-snapped', snapping.guide.getValue() !== null)
        paint()
    }
    const cancel = () => {
        const id = active
        active = undefined
        if (id !== undefined && lane.hasPointerCapture(id)) lane.releasePointerCapture(id)
        draft = undefined
        dragSnap = undefined
        snapping.guide.setValue(null)
        lane.removeAttribute('data-snapped')
        paint()
    }
    lane.onpointermove = e => {if (e.pointerId === active) update(e)}
    lane.onpointerup = e => {
        if (e.pointerId !== active) return
        update(e)
        if (draft && draft.end > draft.start) setWorkArea(project, draft)
        cancel()
        refresh()
    }
    lane.ondblclick = () => {
        if (saved.end > saved.start) project.editing.modify(() => loop.enabled.setValue(!loop.enabled.getValue()))
    }
    lane.onlostpointercapture = lane.onpointercancel = () => {if (active !== undefined) cancel()}
    lifecycle.own({terminate: cancel})
    paint()
    return lane
}
