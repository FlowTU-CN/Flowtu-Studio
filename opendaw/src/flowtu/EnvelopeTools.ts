import {AudioRegionBoxAdapter, AudioUnitBoxAdapter, TrackBoxAdapter, TrackType, ValueEventBoxAdapter, ValueRegionBoxAdapter} from '@opendaw/studio-adapters'
import {AudioUnitBox, ValueRegionBox} from '@opendaw/studio-boxes'
import {Interpolation, LoopableRegion, PPQN} from '@opendaw/lib-dsp'
import {type Lifecycle} from '@opendaw/lib-std'
import type {ElementCapturing, Project, TimelineRange} from '@opendaw/studio-core'
import type {StudioService} from '../service/StudioService'
import type {RegionCaptureTarget} from '../ui/timeline/tracks/audio-unit/regions/RegionCapturing'
import type {TracksManager} from '../ui/timeline/tracks/audio-unit/TracksManager'
import {RegionLabel} from '../ui/timeline/RegionLabel'
import {PanelType} from '../ui/workspace/PanelType'
import {ValueEventEditing} from '../ui/timeline/editors/value/ValueEventEditing'
import {musicUnits} from './execute'
import {boundedEnvelopePosition, envelopeLocalPosition, envelopeValue} from './envelope'
import {editingTool} from './editing-state'
import {clearAudioRange} from './timeline-selection'
import './envelope.css'

const resolveUnit = (project: Project): AudioUnitBox | undefined => {
    const units = musicUnits(project)
    const focused = project.timelineFocus.track.flatMap(track => track.optAudioUnit).unwrapOrUndefined()
    if (focused && units.includes(focused)) return focused
    return units.find(unit => project.userEditingManager.audioUnit.isEditing(unit.editing))
        ?? units[0]
}

const labels = {volume: 'Volume', panning: 'Pan'} as const
type EnvelopeKind = keyof typeof labels

export function envelopeTrack(project: Project, unit: AudioUnitBox, kind: EnvelopeKind): TrackBoxAdapter | undefined {
    return project.boxAdapters.adapterFor(unit, AudioUnitBoxAdapter).tracks.controls(unit[kind]).unwrapOrUndefined()
}

function trackKind(track: TrackBoxAdapter): EnvelopeKind | undefined {
    const unit = track.optAudioUnit.unwrapOrUndefined()
    if (!unit) return undefined
    if (track.target.targetVertex.contains(unit.volume)) return 'volume'
    if (track.target.targetVertex.contains(unit.panning)) return 'panning'
    return undefined
}

export const isEnvelopeTrack = (track: TrackBoxAdapter): boolean =>
    track.type === TrackType.Value && trackKind(track) !== undefined

/** Must be called inside project.editing.modify. Reuses the chosen parameter's existing lane and nodes. */
export function ensureEnvelope(project: Project, unit: AudioUnitBox, kind: EnvelopeKind): {track: TrackBoxAdapter; region: ValueRegionBoxAdapter; created: boolean} {
    const adapter = project.boxAdapters.adapterFor(unit, AudioUnitBoxAdapter)
    if (project.audioUnitFreeze.isFrozen(adapter)) throw new Error('Unfreeze this track before editing automation.')
    let track = envelopeTrack(project, unit, kind)
    if (!track) {
        track = project.boxAdapters.adapterFor(adapter.tracks.create(TrackType.Value, unit[kind]), TrackBoxAdapter)
        track.box.height.setValue(96)
    }
    adapter.automationCollapsed.setValue(false)
    const existing = track.regions.collection.asArray().filter((r): r is ValueRegionBoxAdapter => r instanceof ValueRegionBoxAdapter)
    let start = 0, end: number
    if (existing.length) {
        const selected = project.timelineFocus.region.unwrapOrUndefined()
        const audio = selected instanceof AudioRegionBoxAdapter && selected.trackBoxAdapter.flatMap(t => t.optAudioUnit).contains(unit) ? selected : undefined
        const at = audio?.position ?? project.engine.position.getValue()
        const covering = existing.find(r => r.position <= at && r.complete > at)
        if (covering || !audio) return {track, region: covering ?? existing[0], created: false}
        // A newly imported clip can sit outside all saved automation. Fill only its uncovered interval.
        start = audio.position
        end = Math.min(audio.complete, existing.find(r => r.position > start)?.position ?? audio.complete)
    } else {
        const last = Math.max(PPQN.Bar * 4, ...adapter.tracks.values().flatMap(t => t.regions.collection.asArray().map(r => r.complete)))
        end = Math.ceil(last / PPQN.Bar) * PPQN.Bar
    }
    const name = labels[kind] + ' Envelope'
    const box = project.api.createTrackRegion(track.box, start, end - start, {name, hue: kind === 'panning' ? 28 : 207}).unwrap('Could not create ' + name) as ValueRegionBox
    const region = project.boxAdapters.adapterFor(box, ValueRegionBoxAdapter)
    const collection = region.optCollection.unwrap('The envelope has no point collection')
    const value = adapter.namedParameter[kind].getControlledUnitValue()
    if (collection.events.isEmpty()) collection.createEvent({position: 0, index: 0, value, interpolation: Interpolation.Linear})
    if (region.duration > 1) collection.createEvent({position: region.duration - 1, index: 0, value: collection.events.asArray()[0]?.value ?? value, interpolation: Interpolation.Linear})
    return {track, region, created: true}
}

/** Appends compact controls to the persistent edit toolbar. */
export function installEnvelopeTools(service: StudioService, toolbar: HTMLElement) {
    const group = document.createElement('span')
    group.className = 'flowtu-envelope-tools'
    group.innerHTML = '<button type="button" data-kind="volume" aria-label="Show volume envelope">Volume Env</button><button type="button" data-kind="panning" aria-label="Show pan envelope">Pan Env</button><button type="button" class="envelope-read">R Read</button><button type="button" class="envelope-points">Edit Points</button>'
    toolbar.append(group)
    const buttons = group.querySelectorAll<HTMLButtonElement>('[data-kind]')
    const read = group.querySelector<HTMLButtonElement>('.envelope-read')!, detailed = group.querySelector<HTMLButtonElement>('.envelope-points')!
    let lastKind: EnvelopeKind = 'volume'
    const status = document.createElement('output'); status.className = 'flowtu-envelope-status'; status.hidden = true; status.setAttribute('role', 'status'); document.body.append(status)
    let hideTimer: ReturnType<typeof setTimeout> | undefined
    const tell = (message: string) => {status.textContent = message; status.hidden = false; clearTimeout(hideTimer); hideTimer = setTimeout(() => status.hidden = true, 7000)}
    const current = (requested?: EnvelopeKind) => {
        if (!service.hasProfile) return undefined
        const project = service.project, unit = resolveUnit(project)
        if (!unit) return undefined
        const focus = project.timelineFocus.track.unwrapOrUndefined()
        const kind = requested ?? (focus?.optAudioUnit.contains(unit) ? trackKind(focus) : undefined) ?? lastKind
        return {project, unit, kind, adapter: project.boxAdapters.adapterFor(unit, AudioUnitBoxAdapter), track: envelopeTrack(project, unit, kind)}
    }
    const reveal = (openEditor: boolean, requested?: EnvelopeKind) => {
        const c = current(requested); if (!c) {tell('Add or select a track first.'); return}
        try {
            const result = c.project.editing.modify(() => {
                const result = ensureEnvelope(c.project, c.unit, c.kind)
                c.project.userEditingManager.audioUnit.edit(c.unit.editing)
                if (openEditor) c.project.userEditingManager.timeline.edit(result.region.box)
                return result
            }, true).unwrap('No editable envelope available')
            lastKind = c.kind
            c.project.regionSelection.deselectAll(); c.project.regionSelection.select(result.region)
            c.project.timelineFocus.focusRegion(result.region)
            if (openEditor) service.panelLayout.showIfAvailable(PanelType.ContentEditor)
            const view = service.timeline.range
            if (result.region.complete <= view.unitMin || result.region.position >= view.unitMax) {
                view.showUnitInterval(result.region.position, result.region.complete)
            }
            tell(`${c.adapter.label} · ${labels[c.kind]} envelope. Click the line to add a point, drag to edit, Alt-click to delete.`)
        } catch (error) {tell(error instanceof Error ? error.message : String(error))}
        refresh()
    }
    buttons.forEach(button => {button.onclick = () => reveal(false, button.dataset.kind as EnvelopeKind)})
    detailed.onclick = () => reveal(true)
    read.onclick = () => {
        const c = current(); if (!c?.track) return
        c.project.editing.modify(() => c.track!.enabled.toggle(), true)
        tell(labels[c.kind] + (c.track.enabled.getValue() ? ' automation is enabled' : ' automation bypassed; points retained'))
        refresh()
    }
    function refresh() {
        const c = current(), label = labels[c?.kind ?? lastKind]
        const suffix = c ? ' · ' + String(musicUnits(c.project).indexOf(c.unit) + 1).padStart(2, '0') : ''
        buttons.forEach(button => {
            const kind = button.dataset.kind as EnvelopeKind
            button.disabled = !c
            button.setAttribute('aria-pressed', String(!!c?.track && c.kind === kind && !c.adapter.automationCollapsed.getValue()))
            button.textContent = labels[kind] + ' Env' + suffix
            button.title = c ? c.adapter.label + ': show ' + labels[kind].toLowerCase() + ' envelope' : 'Add a track first'
        })
        detailed.disabled = !c; read.disabled = !c?.track
        detailed.setAttribute('aria-label', 'Open ' + label.toLowerCase() + ' envelope editor')
        detailed.textContent = 'Edit ' + label + ' Points'
        read.setAttribute('aria-label', 'Read ' + label.toLowerCase() + ' automation')
        read.setAttribute('aria-pressed', String(c?.track?.enabled.getValue() ?? false))
        read.textContent = (c?.track && !c.track.enabled.getValue() ? 'R Bypass · ' : 'R Read · ') + label
    }
    const timer = setInterval(refresh, 350); refresh()
    window.addEventListener('pagehide', () => {clearInterval(timer); clearTimeout(hideTimer); status.remove()}, {once: true})
}

/** Draw large nodes on the native timeline renderer, keeping the native curve itself. */
export function renderEnvelopeNodes(context: CanvasRenderingContext2D, range: TimelineRange, region: ValueRegionBoxAdapter, bound: {top: number; bottom: number}, pass: {rawStart: number; resultStart: number; resultEnd: number}, selection?: {start:number; end:number}) {
    const kind = region.trackBoxAdapter.mapOr(trackKind, undefined)
    if (!kind) return
    const dpr = devicePixelRatio
    context.save()
    if (kind === 'panning') {
        const center = (bound.top + bound.bottom) * dpr / 2
        context.strokeStyle = '#ffffff40'; context.lineWidth = dpr
        context.setLineDash([3 * dpr, 4 * dpr]); context.beginPath()
        context.moveTo(range.unitToX(pass.resultStart) * dpr, center); context.lineTo(range.unitToX(pass.resultEnd) * dpr, center)
        context.stroke(); context.setLineDash([])
    }
    const normal = kind === 'panning' ? '#ffc483' : '#92d0ff'
    if (region.events.mapOr(events => events.isEmpty(),false)) {
        const level = idleEnvelopeValue(region,kind)
        const y = (bound.bottom + level * (bound.top - bound.bottom)) * dpr
        context.strokeStyle = normal;context.globalAlpha = .65;context.lineWidth = dpr
        context.beginPath();context.moveTo(range.unitToX(pass.resultStart)*dpr,y)
        context.lineTo(range.unitToX(pass.resultEnd)*dpr,y);context.stroke()
    }
    region.events.ifSome(events => events.asArray().forEach(node => {
        const position = pass.rawStart + node.position
        if (position < pass.resultStart || position >= pass.resultEnd) return
        const x = range.unitToX(position) * dpr, y = (bound.bottom + node.value * (bound.top - bound.bottom)) * dpr
        const chosen = selection && position >= selection.start && position < selection.end
        context.fillStyle = chosen ? '#fff4e8' : normal
        context.strokeStyle = chosen ? '#ffad6a' : '#09263a'
        context.lineWidth = (chosen ? 2 : 1) * dpr
        context.beginPath(); context.arc(x, y, (chosen ? 5.5 : 4.5) * dpr, 0, Math.PI * 2); context.fill(); context.stroke()
    }))
    context.restore()
}

function idleEnvelopeValue(region:ValueRegionBoxAdapter, kind:EnvelopeKind) {
    const track = region.trackBoxAdapter.unwrap()
    return track.context.boxAdapters.adapterFor(track.audioUnit,AudioUnitBoxAdapter).namedParameter[kind].getControlledUnitValue()
}

/** Test only the painted stroke and nodes. All distances are in CSS pixels, independent of zoom or pixel ratio. */
export function envelopeTarget(region: ValueRegionBoxAdapter, kind:EnvelopeKind, range: Pick<TimelineRange, 'xToUnit' | 'unitToX'>,
                               x: number, y: number, top: number, bottom: number, retained: boolean) {
    const collection = region.optCollection.unwrapOrUndefined()
    if (!collection || region.loopDuration <= 0) return
    const nodeRadius = retained ? 8 : 6.5, lineRadius = retained ? 5 : 3.5
    const valueY = (value: number) => bottom + value * (top - bottom)
    if (collection.events.isEmpty()) {
        const value = idleEnvelopeValue(region,kind), at = range.xToUnit(x)
        if (at < region.position || at >= region.complete || Math.abs(valueY(value)-y) > lineRadius) return
        return {node:undefined,local:envelopeLocalPosition(at,region.offset,region.loopDuration),value}
    }
    let node: ValueEventBoxAdapter | undefined, nodeDistance = Infinity
    let curve: {local: number; value: number} | undefined, curveDistance = Infinity
    for (const pass of LoopableRegion.locateLoops(region, range.xToUnit(x-nodeRadius), range.xToUnit(x+nodeRadius))) {
        for (const event of collection.events.iterateRange(pass.resultStart-pass.rawStart,pass.resultEnd-pass.rawStart)) {
            const distance = Math.hypot(range.unitToX(pass.rawStart+event.position)-x,valueY(event.value)-y)
            if (distance <= nodeRadius && distance < nodeDistance) {node = event; nodeDistance = distance}
        }
        // Project onto the visible curve in a narrow window. A vertical-distance-only hit
        // test misses steep ramps and the vertical edges of a step.
        const from = Math.max(x-lineRadius,range.unitToX(pass.resultStart))
        const to = Math.min(x+lineRadius,range.unitToX(pass.resultEnd))
        const valueAtX = (px: number) => collection.valueAt(range.xToUnit(px)-pass.rawStart,0)
        let px = from, py = valueY(valueAtX(from))
        while (px < to) {
            const nx = Math.min(to,px+1), ny = valueY(valueAtX(nx))
            const dx = nx-px, dy = ny-py
            const t = Math.min(1, Math.max(0, ((x-px)*dx+(y-py)*dy)/(dx*dx+dy*dy)))
            const cx = px + t*dx, cy = py + t*dy, distance = Math.hypot(cx-x,cy-y)
            if (distance <= lineRadius && distance < curveDistance) {
                curveDistance = distance
                curve = {local:envelopeLocalPosition(range.xToUnit(cx),region.offset,region.loopDuration),value:envelopeValue(cy,top,bottom)}
            }
            px=nx; py=ny
        }
    }
    return node ? {node,local:node.position,value:node.value} : curve && {node:undefined,...curve}
}

/** Owns pointer gestures only in a volume or pan envelope's body; the header retains normal region move/trim. */
export function installEnvelopeEditing(element: HTMLElement, service: StudioService, capturing: ElementCapturing<RegionCaptureTarget>, range: TimelineRange, manager: TracksManager, lifecycle: Lifecycle) {
    const project = service.project
    const tooltip = document.createElement('output'); tooltip.className = 'flowtu-envelope-tooltip'; tooltip.hidden = true; document.body.append(tooltip)
    let selected: ValueEventBoxAdapter | undefined
    let finishDrag: (() => void) | undefined
    let lastStroke: ValueRegionBoxAdapter | undefined
    let selectedRegion: ValueRegionBoxAdapter | undefined
    const resolve = (target: RegionCaptureTarget | null, clientX: number, clientY: number) => {
        const previous = lastStroke
        lastStroke = undefined
        if (target?.type !== 'region' || !(target.region instanceof ValueRegionBoxAdapter) || editingTool.getValue() !== 'select') return
        const region = target.region, source = region.trackBoxAdapter.unwrapOrUndefined()
        if (!source) return
        const kind = trackKind(source)
        if (!kind) return
        const track = manager.tracks().find(t => t.trackBoxAdapter === manager.displayTrack(source))
        if (!track) return
        const rect = element.getBoundingClientRect(), rowTop = rect.top + track.position - manager.scrollableContainer.scrollTop
        const top = rowTop + RegionLabel.labelHeight() + 1, bottom = rowTop + track.size
        if (clientY < top || clientY > bottom) return
        const point = envelopeTarget(region,kind,range,clientX-rect.left,clientY,top,bottom,region === previous)
        if (!point) return
        lastStroke = region
        return {region,track,top,bottom,kind,point}
    }
    const pointerdown = (event: PointerEvent) => {
        if (event.button !== 0) return
        const hit = resolve(capturing.captureEvent(event),event.clientX,event.clientY)
        if (!hit) {selected = undefined; selectedRegion = undefined;return}
        const {region, top, bottom, point} = hit, collection = region.optCollection.unwrap()
        event.preventDefault(); event.stopImmediatePropagation(); element.focus({preventScroll: true})
        project.editing.mark()
        hit.track.audioUnitBoxAdapter.ifSome(unit => {
            if (!project.userEditingManager.audioUnit.isEditing(unit.box.editing)) project.editing.modify(() => project.userEditingManager.audioUnit.edit(unit.box.editing), true)
        })
        project.timelineFocus.focusRegion(region)
        project.regionSelection.deselectAll()
        clearAudioRange(project)
        selectedRegion = region
        const nodeAtCursor = point.node
        if (event.altKey) {
            if (nodeAtCursor) project.editing.modify(() => ValueEventEditing.deleteEvent(collection, nodeAtCursor), true)
            selected = undefined; return
        }
        let node = nodeAtCursor
        if (!node) node = project.editing.modify(() => ValueEventEditing.createOrMoveEvent(collection, point.local, point.value), false).unwrap()
        selected = node
        const initial = {position: node.position, value: node.value}, start = {x: event.clientX, y: event.clientY}
        const others = collection.events.asArray().filter(n => n !== node), previous = others.filter(n => n.position < initial.position).at(-1)?.position, next = others.find(n => n.position > initial.position)?.position
        const paired = others.some(n => n.position === initial.position)
        const updateTooltip = (e: PointerEvent) => {
            if (hit.kind === 'panning') {
                const pan = Math.round(200 * node!.value - 100)
                tooltip.textContent = pan === 0 ? 'Center' : Math.abs(pan) + '% ' + (pan < 0 ? 'L' : 'R')
            } else {
                const db = AudioUnitBoxAdapter.VolumeMapper.y(node!.value)
                tooltip.textContent = `${Number.isFinite(db) ? db.toFixed(1) : '−∞'} dB`
            }
            tooltip.style.left = `${e.clientX + 12}px`; tooltip.style.top = `${e.clientY - 28}px`; tooltip.hidden = false
        }
        updateTooltip(event)
        const move = (e: PointerEvent) => {
            if (e.pointerId !== event.pointerId) return
            e.preventDefault(); e.stopImmediatePropagation()
            const position = paired ? initial.position : boundedEnvelopePosition(initial.position + range.unitsPerPixel * (e.clientX - start.x), region.loopDuration, previous, next)
            const value = Math.max(0, Math.min(1, initial.value - (e.clientY - start.y) / Math.max(1, bottom - top)))
            project.editing.modify(() => {node!.box.position.setValue(position); node!.box.value.setValue(value)}, false)
            updateTooltip(e)
        }
        const finish = () => {
            project.editing.mark(); tooltip.hidden = true
            window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true)
            finishDrag = undefined
        }
        const up = (e: PointerEvent) => {if (e.pointerId === event.pointerId) {e.stopImmediatePropagation(); finish()}}
        finishDrag = finish
        window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true)
    }
    const dblclick = (event: MouseEvent) => {if (resolve(capturing.captureEvent(event),event.clientX,event.clientY)) {event.preventDefault(); event.stopImmediatePropagation()}}
    const keydown = (event: KeyboardEvent) => {
        if (editingTool.getValue() !== 'select' || !selectedRegion || !project.timelineFocus.region.contains(selectedRegion) || !selected || !selected.box.isAttached() || !['Delete', 'Backspace'].includes(event.key)) return
        const collection = selected.collection.unwrapOrUndefined(); if (!collection) return
        event.preventDefault(); event.stopImmediatePropagation()
        project.editing.modify(() => ValueEventEditing.deleteEvent(collection, selected!), true); selected = undefined
    }
    element.addEventListener('pointerdown', pointerdown, true); element.addEventListener('dblclick', dblclick, true); element.addEventListener('keydown', keydown, true)
    lifecycle.own({terminate: () => {finishDrag?.(); tooltip.remove(); element.removeEventListener('pointerdown', pointerdown, true); element.removeEventListener('dblclick', dblclick, true); element.removeEventListener('keydown', keydown, true)}})
    return (target: RegionCaptureTarget | null, x: number, y: number) => !!resolve(target,x,y)
}
