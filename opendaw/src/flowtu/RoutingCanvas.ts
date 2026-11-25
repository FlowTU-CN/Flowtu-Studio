import {openComposerWorkspace, closeComposerWorkspace} from './composer-workspaces'
import {UUID} from '@opendaw/lib-std'
import {MetaData, type AudioEffectDeviceAdapter, type AudioUnitBoxAdapter} from '@opendaw/studio-adapters'
import {AudioSendRouting} from '@opendaw/studio-enums'
import {EffectFactories, type Project} from '@opendaw/studio-core'
import type {StudioService} from '@/service/StudioService'
import {Surface} from '@/ui/surface/Surface'
import {Layers} from '@/ui/surface/Layers'
import {moveRoutingWindow} from './routing-window'
import {autoLayoutRouting} from './routing-layout'
import {routingViewport} from './routing-viewport'
import {playbackAction} from './playback-keys'
import {mountRoutingDevice} from './routing-device'
import {chooseColor, colorFor, paletteMenu, watchColor} from './device-colors'
import {localizeStudioDocument} from './studio-language'
import {linkStudioSkin} from './studio-skin'
import {maxCanvasCoordinate, canvasPosition, connectRoute, createRoutingBus, deleteRoutingBus, disconnectRoute, routesOf, savedPosition, sendFor, unitId, type Port, type Route} from './routing-graph'
import css from './routing-canvas.css?inline'
import skinCss from './studio-settings.css?inline'

type Point = {x: number; y: number}
const ns = 'http://www.w3.org/2000/svg'
const key = (route: Route) => [unitId(route.source), route.port, unitId(route.target), route.sendId ?? ''].join('/')
const curve = (a: Point, b: Point) => {
    const span = Math.max(44, Math.abs(b.x-a.x)*.4)
    return `M${a.x} ${a.y} C${a.x+span} ${a.y} ${b.x-span} ${b.y} ${b.x} ${b.y}`
}

function mountCanvas(service: StudioService, project: Project, root: HTMLElement, pop: (() => void) | undefined, close: () => void) {
    const doc = root.ownerDocument, win = doc.defaultView!
    const style = doc.createElement('style')
    style.textContent = doc === document ? css : skinCss + css
    doc.head.append(style)
    root.className = 'ft-patch'
    root.tabIndex = -1
    root.innerHTML = `<header><div class="ft-patch-titlebar"><div class="ft-patch-title"><strong>Audio routing</strong></div><button data-action="pop">Pop out ↗</button><button data-action="close">Close</button></div>
        <div class="ft-patch-tools"><button data-action="bus">＋ Bus</button>
        <select aria-label="Effect for new FX node"></select><button data-action="effect">＋ FX node</button>
        <button data-action="undo">Undo</button><button data-action="layout" title="Arrange nodes from input to output">Auto layout</button>
        <div class="ft-patch-zoom"><button data-action="minus" aria-label="Zoom out">−</button><button data-action="zoom" aria-label="Zoom">100%</button><button data-action="plus" aria-label="Zoom in">+</button><button data-action="fit" title="Fit all nodes">Fit</button></div></div></header>
        <div class="ft-patch-scroll" title="Wheel to zoom · Drag background to pan"><div class="ft-patch-frame"><div class="ft-patch-world"></div></div></div>
        <footer><output role="status">Connect Out or Send to an In. Select a cable to edit it.</output><div class="ft-patch-inspector"></div>
        <div class="ft-patch-connections"><select data-routes aria-label="Connections" data-i18n=""></select><button data-action="remove-route" data-i18n="" disabled>Delete connection</button></div></footer>`
    const world = root.querySelector<HTMLElement>('.ft-patch-world')!
    const viewportFrame = world.parentElement!
    const scroll = viewportFrame.parentElement!
    const wires = doc.createElementNS(ns, 'svg')
    wires.classList.add('ft-patch-wires')
    world.append(wires)
    const status = root.querySelector('output')!, inspector = root.querySelector<HTMLElement>('.ft-patch-inspector')!
    const button = (label: string, action: () => void, aria?: string) => {
        const el = doc.createElement('button')
        el.type = 'button'; el.textContent = label; el.onclick = action
        if (aria) {el.setAttribute('aria-label', aria); el.title = aria}
        return el
    }
    const act = (fn: () => void) => {
        try {fn()} catch (error) {status.value = error instanceof Error ? error.message : String(error)}
    }
    const action = (name: string) => root.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!
    const select = root.querySelector('select')!
    const palette = paletteMenu(doc)
    action('layout').after(palette.element)
    EffectFactories.AudioList.forEach((factory, index) => {
        const option = doc.createElement('option')
        option.value = String(index); option.textContent = factory === EffectFactories.Revamp ? 'Parametric EQ' : factory.defaultName
        option.selected = factory === EffectFactories.Revamp
        select.append(option)
    })
    action('bus').onclick = () => act(() => createRoutingBus(project))
    action('effect').onclick = () => act(() => createRoutingBus(project, EffectFactories.AudioList[Number(select.value)]))
    action('undo').onclick = () => project.editing.undo()
    action('pop').hidden = !pop
    if (pop) action('pop').onclick = pop
    action('close').onclick = close
    const panels = new Map<AudioUnitBoxAdapter, HTMLElement>()
    const bounds = () => {
        let width = 1, height = 1
        for (const card of panels.values()) {
            width = Math.max(width, card.offsetLeft + card.offsetWidth + 28)
            height = Math.max(height, card.offsetTop + card.offsetHeight + 28)
        }
        return {width, height}
    }
    const viewport = routingViewport(scroll, viewportFrame, world, bounds, action('zoom'))
    action('zoom').onclick = () => viewport.zoom(1)
    action('plus').onclick = () => viewport.zoom(viewport.scale * 1.25)
    action('minus').onclick = () => viewport.zoom(viewport.scale / 1.25)
    action('fit').onclick = viewport.fit
    action('layout').onclick = () => act(() => {
        autoLayoutRouting(project, panels, paths)
        render()
        viewport.fit()
    })
    const cardSubscriptions: Array<() => void> = []
    const editors = new Map<AudioEffectDeviceAdapter, ReturnType<typeof mountRoutingDevice>>()
    const sizeChanges = new ResizeObserver(() => {viewport.size(); draw()})
    const inputs = new Map<string, AudioUnitBoxAdapter>()
    let pending: {source: AudioUnitBoxAdapter; port: Port} | undefined
    const connectionMenu = root.querySelector<HTMLSelectElement>('select[data-routes]')!
    const removeRoute = action('remove-route')
    let selectedNode: AudioUnitBoxAdapter | undefined
    let selected = '', paths: Route[] = [], pointer: Point | undefined
    let drag: {id: number; card: HTMLElement; unit: AudioUnitBoxAdapter; origin: Point; start: Point} | undefined
    let wiring: {id: number; x: number; y: number} | undefined
    let pan: {id: number; x: number; y: number; left: number; top: number} | undefined
    const point = (el: Element): Point => {
        const box = el.getBoundingClientRect(), origin = world.getBoundingClientRect()
        return {x: (box.left-origin.left+box.width/2)/viewport.scale, y: (box.top-origin.top+box.height/2)/viewport.scale}
    }
    const portPoint = (unit: AudioUnitBoxAdapter, port: string) => {
        const el = panels.get(unit)?.querySelector(`[data-port="${port}"]`)
        return el ? point(el) : undefined
    }
    const draw = () => {
        wires.replaceChildren()
        for (const route of paths) {
            const from = portPoint(route.source, route.port), to = portPoint(route.target, 'in')
            if (!from || !to) continue
            const line = doc.createElementNS(ns, 'path')
            line.setAttribute('d', curve(from, to))
            line.style.stroke = panels.get(route.target)!.style.getPropertyValue('--ft-node-color')
            line.dataset.target = unitId(route.target)
            line.setAttribute('class', route.port + (selected === key(route) ? ' selected' : ''))
            const hit = doc.createElementNS(ns, 'path')
            hit.setAttribute('d', line.getAttribute('d')!); hit.classList.add('hit')
            const tooltip = doc.createElementNS(ns, 'title')
            tooltip.textContent = route.source.label + ' → ' + route.target.label
            hit.append(tooltip)
            hit.onpointerenter = () => line.classList.add('hovered')
            hit.onpointerleave = () => line.classList.remove('hovered')
            hit.onclick = () => {selectConnection(key(route)); root.focus({preventScroll:true})}
            wires.append(line, hit)
        }
        if (pending && pointer) {
            const from = portPoint(pending.source, pending.port)
            if (from) {
                const line = doc.createElementNS(ns, 'path')
                line.setAttribute('class', pending.port + ' pending')
                line.setAttribute('d', curve(from, pointer)); wires.append(line)
            }
        }
    }
    function selectConnection(id: string) {
        pending = undefined
        pointer = undefined
        selected = id
        selectedNode = undefined
        panels.forEach(card => card.removeAttribute('data-selected'))
        root.querySelectorAll('.armed').forEach(el => el.classList.remove('armed'))
        draw()
        inspect()
    }
    function deleteConnection() {
        const route = paths.find(candidate => key(candidate) === selected)
        if (!route) return
        disconnectRoute(project, route)
        selected = ''
        status.value = 'Disconnected.'
        render()
        root.focus({preventScroll:true})
    }
    function deleteNode(unit: AudioUnitBoxAdapter) {
        deleteRoutingBus(project, unit)
        selected = ''
        selectedNode = undefined
        status.value = 'Node deleted.'
        render()
        root.focus({preventScroll:true})
    }
    connectionMenu.onchange = () => {selectConnection(connectionMenu.value); root.focus({preventScroll:true})}
    removeRoute.onclick = deleteConnection
    function populateConnections() {
        const prompt = doc.createElement('option')
        prompt.textContent = 'Select a connection'
        prompt.dataset.i18n = ''
        prompt.value = ''
        connectionMenu.replaceChildren(prompt)
        for (const route of paths) {
            const option = doc.createElement('option')
            option.value = key(route)
            option.textContent = route.source.label + ' · ' + (route.port === 'out' ? 'Out' : 'Send') + ' → ' + route.target.label
            connectionMenu.append(option)
        }
        if (selected && !paths.some(route => key(route) === selected)) selected = ''
        connectionMenu.disabled = !paths.length
    }
    const inspect = () => {
        inspector.replaceChildren()
        const route = paths.find(r => key(r) === selected)
        connectionMenu.value = selected
        removeRoute.disabled = !route
        if (!route) return
        status.value = route.source.label + ' → ' + route.target.label
        if (route.port === 'send') {
            const send = sendFor(route)
            if (!send) return
            const pre = send.routingField.getValue() === AudioSendRouting.Pre
            const level = doc.createElement('input')
            level.type = 'number'; level.min = '-96'; level.max = '12'; level.step = '.5'
            level.value = String(send.sendGain.getValue())
            level.setAttribute('aria-label', 'Send level in dB')
            level.onchange = () => {
                const db = level.valueAsNumber
                if (Number.isFinite(db) && level.validity.valid) project.editing.modify(() => send.sendGain.setValue(db), true)
                else level.value = String(send.sendGain.getValue())
            }
            inspector.append(level, 'dB', button(pre ? 'Pre fader' : 'Post fader', () =>
                project.editing.modify(() => send.routingField.setValue(pre ? AudioSendRouting.Post : AudioSendRouting.Pre), true)))
        }
    }
    const finish = (target: AudioUnitBoxAdapter) => {
        if (!pending) return
        const route = {...pending, target}
        pending = undefined; pointer = undefined
        act(() => {
            connectRoute(project, route.source, target, route.port)
            const connection = routesOf(route.source).find(r => r.target === target && r.port === route.port)
            selected = connection ? key(connection) : ''
            status.value = 'Connected.'
        })
        render()
    }
    const arrange = () => {viewport.size()}
    let lastGraph = ''
    const render = (onlyIfChanged = false) => {
        if (drag || wiring) return
        const units = project.rootBoxAdapter.audioUnits.adapters()
        const graph = units.map(unit => ({unit, effects: unit.audioEffects.unwrapOrNull()?.adapters() ?? [],
            position: savedPosition(unit), routes: routesOf(unit)}))
        // Native editors observe parameter edits directly. Keep focus and
        // native pickers alive while another window adjusts a device.
        const signature = JSON.stringify(graph.map(({unit, effects, position, routes}) => [
            unitId(unit), unit.label, position, routes.map(key),
            effects.map(fx => UUID.toString(fx.uuid))
        ]))
        if (onlyIfChanged && signature === lastGraph) {
            if (selected && !inspector.contains(doc.activeElement)) inspect()
            return
        }
        lastGraph = signature
        const active = new Set(graph.flatMap(node => node.effects))
        for (const [fx, editor] of editors) {
            if (!active.has(fx) || fx.deviceHost() !== editor.host) {
                editor.dispose()
                editors.delete(fx)
            }
        }
        sizeChanges.disconnect()
        cardSubscriptions.splice(0).forEach(dispose => dispose())
        for (const card of panels.values()) card.remove()
        panels.clear(); inputs.clear()
        paths = []
        const nextY = [28, 28, 94]
        let destination = 1, track = 0
        for (const {unit, effects, position, routes} of graph) {
            const lane = unit.isOutput ? 2 : unit.isBus ? 1 : 0
            const xy = position ?? {x: 30 + lane * 300, y: nextY[lane]}
            const card = doc.createElement('article'), title = doc.createElement('h3'), ports = doc.createElement('div')
            card.className = 'ft-patch-node'
            card.dataset.kind = ['track','bus','master'][lane]
            card.setAttribute('aria-label', unit.label)
            card.style.left = xy.x + 'px'; card.style.top = xy.y + 'px'
            const slot = unit.isOutput ? 0 : unit.isBus ? destination++ : track++
            const nodeSwatch = chooseColor(doc, project, unit.box, 'Node color', slot)
            const nodeColor = watchColor(unit.box, () => {
                nodeSwatch.value = colorFor(unit.box, slot)
                card.style.setProperty('--ft-node-color', nodeSwatch.value)
                for (const line of wires.querySelectorAll<SVGPathElement>('path[data-target]')) {
                    if (line.dataset.target === unitId(unit)) line.style.stroke = nodeSwatch.value
                }
            })
            cardSubscriptions.push(nodeColor.terminate)
            const name = doc.createElement('span')
            name.translate = false
            name.textContent = unit.label
            title.append(name, nodeSwatch)
            const pickNode = () => {
                selectedNode = unit.isBus && !unit.isOutput ? unit : undefined
                selected = ''
                pending = undefined
                pointer = undefined
                panels.forEach((node, owner) => node.toggleAttribute('data-selected', owner === selectedNode))
                status.value = unit.label
                draw()
                inspect()
            }
            if (unit.isBus && !unit.isOutput) {
                const remove = button('⌫', () => deleteNode(unit), 'Delete node')
                remove.dataset.deleteNode = ''
                remove.dataset.i18n = ''
                title.append(remove)
                card.toggleAttribute('data-selected', selectedNode === unit)
                title.tabIndex = 0
                title.onfocus = pickNode
            }
            card.addEventListener('pointerdown', event => {
                if (!(event.target as Element).closest('h3') && (selected || selectedNode)) selectConnection('')
            }, true)
            title.title = 'Drag to move'
            title.onpointerdown = e => {
                if (e.button !== 0 || (e.target as Element).closest('input,button')) return
                e.preventDefault()
                pickNode()
                root.focus({preventScroll:true})
                drag = {id:e.pointerId, card, unit, origin:{x:card.offsetLeft, y:card.offsetTop}, start:{x:e.clientX, y:e.clientY}}
                title.setPointerCapture(e.pointerId)
            }
            card.append(title)
            ports.className = 'ft-patch-ports'; card.append(ports)
            if (unit.isBus) {
                inputs.set(unitId(unit), unit)
                const input = button('● In', () => finish(unit), unit.label + ' input')
                input.dataset.port = 'in'; input.dataset.unit = unitId(unit); ports.append(input)
            }
            if (!unit.isOutput) for (const port of ['out','send'] as const) {
                const start = () => {
                    selected = ''; pending = {source:unit, port}; inspect()
                    root.querySelectorAll('.armed').forEach(el => el.classList.remove('armed'))
                    socket.classList.add('armed')
                    status.value = unit.label + (port === 'out' ? ' output' : ' send') + ' · choose an In'
                    draw()
                }
                const socket = button(port === 'out' ? 'Out ●' : 'Send ●', start, unit.label + ' ' + port)
                socket.dataset.port = port
                socket.onpointerdown = e => {
                    if (e.button !== 0) return
                    start()
                    wiring = {id:e.pointerId, x:e.clientX, y:e.clientY}
                    socket.setPointerCapture(e.pointerId)
                }
                if (pending?.source === unit && pending.port === port) socket.classList.add('armed')
                ports.append(socket)
            }
            for (const fx of effects) {
                let editor = editors.get(fx)
                if (!editor) {
                    editor = mountRoutingDevice(doc, service, fx)
                    editors.set(fx, editor)
                }
                card.append(editor.frame)
            }
            card.classList.toggle('with-devices', effects.length > 0)
            paths.push(...routes)
            panels.set(unit, card); world.append(card)
            sizeChanges.observe(card)
            nextY[lane] = Math.max(nextY[lane], xy.y + card.offsetHeight + 48)
        }
        // The widest open device sets each column's width. Keep manually placed nodes
        // at their saved coordinates.
        const widths = [208,208,208]
        for (const {unit} of graph) {
            const lane = unit.isOutput ? 2 : unit.isBus ? 1 : 0
            widths[lane] = Math.max(widths[lane], panels.get(unit)!.offsetWidth)
        }
        const x = [30, 30 + widths[0] + 92, 30 + widths[0] + widths[1] + 184]
        for (const {unit, position} of graph) {
            if (!position) panels.get(unit)!.style.left = x[unit.isOutput ? 2 : unit.isBus ? 1 : 0] + 'px'
        }
        populateConnections(); arrange(); draw(); inspect()
    }
    function resetWire() {
        pending = undefined; wiring = undefined; pointer = undefined
        status.value = 'Connect Out or Send to an In.'
        render()
    }
    world.onpointerdown = e => {
        if (e.target !== world && e.target !== wires || e.button !== 0) return
        pan = {id:e.pointerId, x:e.clientX, y:e.clientY, left:scroll.scrollLeft, top:scroll.scrollTop}
        world.setPointerCapture(e.pointerId)
        selected = ''; selectedNode = undefined; resetWire()
    }
    const move = (e: PointerEvent) => {
        if (drag?.id === e.pointerId) {
            const x = Math.max(0, Math.min(maxCanvasCoordinate, drag.origin.x + (e.clientX - drag.start.x) / viewport.scale))
            const y = Math.max(0, Math.min(maxCanvasCoordinate, drag.origin.y + (e.clientY - drag.start.y) / viewport.scale))
            drag.card.style.left = x + 'px'; drag.card.style.top = y + 'px'
            arrange(); draw()
        } else if (pan?.id === e.pointerId) {
            scroll.scrollLeft = pan.left + pan.x - e.clientX; scroll.scrollTop = pan.top + pan.y - e.clientY
        } else if (pending) {
            const bounds = world.getBoundingClientRect()
            pointer = {x:(e.clientX-bounds.left)/viewport.scale, y:(e.clientY-bounds.top)/viewport.scale}; draw()
        }
    }
    const up = (e: PointerEvent) => {
        if (drag?.id === e.pointerId) {
            const {card, unit, origin} = drag; drag = undefined
            const xy = {x:card.offsetLeft, y:card.offsetTop}
            if (xy.x !== origin.x || xy.y !== origin.y) project.editing.modify(() => MetaData.store(unit.box, xy, canvasPosition), true)
            render()
        }
        if (wiring?.id === e.pointerId) {
            const moved = Math.hypot(e.clientX-wiring.x, e.clientY-wiring.y) > 4
            wiring = undefined
            if (moved) {
                const input = doc.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-port=in]')
                const target = inputs.get(input?.dataset.unit ?? '')
                if (target) finish(target)
                else resetWire()
            }
        }
        pan = undefined
    }
    const cancel = () => {drag = undefined; pan = undefined; resetWire()}
    const keydown = (e: KeyboardEvent) => {
        const target = e.target as Element | null
        if (target?.closest?.('.ft-floating-composer')) return
        const editingText = target?.closest?.('textarea, input:not([type=color]), [contenteditable=true], [role=textbox]')
        const menuOpen = target?.closest?.('select') && CSS.supports('selector(select:open)') && target.matches('select:open')
        if ((e.key === 'Backspace' || e.key === 'Delete') && !e.isComposing && !e.altKey && !e.ctrlKey && !e.metaKey &&
            !target?.closest?.('input, textarea, select, [contenteditable=true], [role=slider], [data-ft-device]') &&
            (root.contains(target) || target === doc.body && !pop)) {
            e.preventDefault()
            e.stopImmediatePropagation()
            if (!e.repeat) {
                if (selected) deleteConnection()
                else if (selectedNode?.box.isAttached()) deleteNode(selectedNode)
            }
            return
        }
        if (playbackAction(e) === 'toggle' && !editingText && !menuOpen) {
            const topDialog = Array.from(doc.querySelectorAll('dialog[open]')).at(-1)
            if (topDialog && !topDialog.contains(root)) return
            e.preventDefault()
            e.stopImmediatePropagation()
            if (!e.repeat && service.hasProfile && service.project === project) {
                if (service.engine.isPlaying.getValue()) service.engine.stop()
                else {
                    if (service.audioContext.state === 'suspended') void service.audioContext.resume().catch(console.warn)
                    service.engine.play()
                }
            }
            return
        }
        if (e.key === 'Escape' && (pending || drag)) {e.preventDefault(); e.stopPropagation(); cancel()}
        else if (e.key === 'Escape' && !pop) close()
    }
    const onResize = () => {arrange(); draw()}
    const stops = new AbortController(), opts = {signal:stops.signal}
    world.addEventListener('pointermove',move,opts)
    world.addEventListener('pointerup',up,opts)
    world.addEventListener('pointercancel',cancel,opts)
    win.addEventListener('keydown',keydown,{...opts,capture:true})
    win.addEventListener('resize',onResize,opts)
    let frame = 0
    const refresh = () => {
        if (!frame) frame = win.requestAnimationFrame(() => {frame = 0; render(true)})
    }
    const editing = project.editing.subscribe(refresh)
    const unlinkLanguage = doc !== document ? localizeStudioDocument(doc) : undefined
    render()
    return () => {
        win.cancelAnimationFrame(frame)
        sizeChanges.disconnect()
        for (const editor of editors.values()) editor.dispose()
        cardSubscriptions.splice(0).forEach(dispose => dispose())
        unlinkLanguage?.(); palette.terminate(); viewport.dispose()
        stops.abort(); editing.terminate(); style.remove()
    }
}

export function installRoutingCanvas(service: StudioService, launcher: HTMLElement) {
    let close: (() => void) | undefined, external: Surface | null = null
    let position: Point | undefined
    const open = () => {
        if (!service.hasProfile) return
        if (external?.owner.closed) external.close()
        if (close) {external?.owner.focus(); return}
        const project = service.project
        const dialog = document.createElement('dialog')
        const root = document.createElement('section')
        dialog.className = 'ft-patch-dialog'
        dialog.setAttribute('aria-label', 'Audio routing')
        dialog.append(root)
        Layers.install(dialog)
        document.body.append(dialog)
        openComposerWorkspace(dialog)
        const shutdown = () => {const release = close; close = undefined; release?.()}
        const pop = async () => {
            const popButton = root.querySelector<HTMLButtonElement>('[data-action=pop]')!
            if (popButton.disabled) return
            popButton.disabled = true
            const current = close
            let child: Surface | undefined
            try {
                const rect = dialog.getBoundingClientRect()
                const screen = {x:window.screenX + rect.left, y:window.screenY + window.outerHeight - window.innerHeight + rect.top}
                const result = await Surface.get().root().new(1080, 720, crypto.randomUUID(), 'Audio routing · Flowtu Studio', screen)
                child = result.unwrapOrNull() ?? undefined
                if (!child) {
                    root.querySelector('output')!.value = 'Allow pop-ups to open the routing window.'
                    return
                }
                if (close !== current) {child.close(); return}
                const owner = child.owner, doc = owner.document
                const pane = doc.createElement('section')
                child.ground.append(pane)
                const skin = linkStudioSkin(doc)
                child.own({terminate:skin})
                const release = mountCanvas(service, project, pane, undefined, shutdown)
                child.own({terminate:release})
                const surface = child
                const closeExternal = () => surface.close()
                // Some browsers can discard a child tab without dispatching its unload event.
                const poll = window.setInterval(() => {if (owner.closed) surface.close()}, 500)
                child.own({terminate: () => {
                    window.clearInterval(poll)
                    if (close === closeExternal) close = undefined
                    if (external === surface) external = null
                }})
                current?.()
                external = surface
                close = closeExternal
            } catch (error) {
                child?.close()
                root.querySelector('output')!.value = error instanceof Error ? error.message : String(error)
            } finally {popButton.disabled = false}
        }
        const release = mountCanvas(service, project, root, pop, shutdown)
        const releaseDrag = moveRoutingWindow(dialog, root.querySelector<HTMLElement>('.ft-patch-title')!, position, next => {position = next})
        close = () => {releaseDrag(); release(); closeComposerWorkspace(dialog); dialog.remove()}
        dialog.oncancel = event => {event.preventDefault(); shutdown()}
    }
    launcher.onclick = open
    const projectChange = service.projectProfileService.subscribe(() => {close?.(); close = undefined})
    window.addEventListener('pagehide', () => {close?.(); close = undefined; projectChange.terminate()}, {once:true})
}
