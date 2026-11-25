import assert from 'node:assert/strict'

// Isolated event-contract test. This is not a browser gesture or visual test.
class Target {
    listeners = new Map<string, Set<(event: any) => void>>()
    options = new Map<string, any>()
    addEventListener(name: string, callback: (event: any) => void, options?: any) {
        const listeners = this.listeners.get(name) ?? new Set(); listeners.add(callback)
        this.listeners.set(name, listeners); this.options.set(name, options)
    }
    removeEventListener(name: string, callback: (event: any) => void) {this.listeners.get(name)?.delete(callback)}
    emit(name: string, detail: Record<string, unknown> = {}) {
        const event = {target: region, ctrlKey: false, metaKey: false, deltaMode: 0, deltaY: 0, clientX: 500, clientY: 300,
            defaultPrevented: false, stopped: false, preventDefault() {this.defaultPrevented = true}, stopImmediatePropagation() {this.stopped = true}, ...detail}
        for (const callback of this.listeners.get(name) ?? []) callback(event)
        return event
    }
}
class ElementFixture {
    constructor(readonly name: string, readonly parent?: ElementFixture) {}
    closest(selector: string): ElementFixture | null {return selector.split(',').includes(this.name) ? this : this.parent?.closest(selector) ?? null}
    contains(element: ElementFixture): boolean {return this === element || !!element.parent && this.contains(element.parent)}
    getBoundingClientRect() {return {left: 100, width: 1000, top: 200, height: 400}}
}
const region = new ElementFixture('regions'), canvas = new ElementFixture('canvas', region), toolbar = new ElementFixture('toolbar')
const htmlClasses=new Set<string>()
const documentFixture = Object.assign(new Target(), {
    dialog: false, fullscreenElement: null as unknown, rejectFullscreen: false, fullscreenTarget: null as unknown,
    querySelector(selector: string) {return selector === 'dialog[open]' ? this.dialog : selector === '[data-scope=regions]' ? region : null},
    documentElement: {classList:{contains:(name:string)=>htmlClasses.has(name)},async requestFullscreen() {if (documentFixture.rejectFullscreen) throw new Error('denied'); documentFixture.fullscreenTarget = this; documentFixture.fullscreenElement = this}},
    async exitFullscreen() {this.fullscreenElement = null}
})
const windowFixture = new Target()
let requestId = 0
const callbacks = new Map<number, () => void>()
const flush = () => {const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback())}
Object.assign(globalThis, {Element: ElementFixture, document: documentFixture, window: windowFixture,
    requestAnimationFrame: (callback: () => void) => {callbacks.set(++requestId, callback); return requestId}, cancelAnimationFrame: (id: number) => callbacks.delete(id)})
const {installTrackpadZoom, pinchZoomLogDelta} = await import('../src/flowtu/TrackpadZoom')
const range = {
    min: .2, max: .6, width: 1000, calls: [] as {scale: number; anchor: number}[],
    get center() {return (this.min + this.max) / 2},
    normalize(value: number) {return value / 10_000},
    xToValue(x: number) {return this.min + (x - 12) / (this.width - 12) * (this.max - this.min)},
    scaleBy(scale: number, anchor: number) {this.calls.push({scale, anchor}); this.min += (this.min - anchor) * scale; this.max += (this.max - anchor) * scale}
}
const service = {hasProfile: true, timeline: {range}, engine: {position: {getValue: () => 3500}}}
const helper = installTrackpadZoom(service as any)
assert.deepEqual(documentFixture.options.get('wheel'), {capture: true, passive: false})


// Plain horizontal/vertical trackpad scrolling remains with the native timeline.
const pan = documentFixture.emit('wheel', {deltaX: 15, deltaY: 2})
assert.equal(pan.defaultPrevented, false); assert.equal(pan.stopped, false); assert.equal(callbacks.size, 0)
const initialAnchor = range.xToValue(400), initialRatio = (initialAnchor - range.min) / (range.max - range.min)
const initialSpan = range.max - range.min
const zoom = documentFixture.emit('wheel', {target: canvas, ctrlKey: true, deltaY: -5})
documentFixture.emit('wheel', {target: canvas, ctrlKey: true, deltaY: -5})
assert.equal(zoom.defaultPrevented, true); assert.equal(zoom.stopped, true) // Native Shift / wheel handlers cannot double-process it.
assert.equal(range.calls.length, 0); assert.equal(callbacks.size, 1)
flush()
assert.equal(range.calls.length, 1)
assert.ok(Math.abs((range.max - range.min) / initialSpan - Math.exp(-.06)) < 1e-12)
assert.ok(Math.abs((initialAnchor - range.min) / (range.max - range.min) - initialRatio) < 1e-12)
assert.equal(range.calls[0].anchor, initialAnchor)

// Workspace controls use the visible playhead; an off-screen playhead uses center.
documentFixture.emit('wheel', {target: toolbar, ctrlKey: true, deltaY: 1}); flush()
assert.equal(range.calls.at(-1)!.anchor, .35)
service.engine.position.getValue = () => 9000
const center = range.center
documentFixture.emit('wheel', {target: toolbar, ctrlKey: true, deltaY: 1}); flush()
assert.equal(range.calls.at(-1)!.anchor, center)

const beforeExcluded = range.calls.length
assert.equal(documentFixture.emit('wheel', {target: new ElementFixture('input'), ctrlKey: true, deltaY: 1}).stopped, false)
documentFixture.dialog = true
assert.equal(documentFixture.emit('wheel', {ctrlKey: true, deltaY: 1}).stopped, false)
documentFixture.dialog = false; service.hasProfile = false
assert.equal(documentFixture.emit('wheel', {ctrlKey: true, deltaY: 1}).stopped, false)
service.hasProfile = true; flush(); assert.equal(range.calls.length, beforeExcluded)

// Safari's cumulative scale becomes an incremental ratio. Its duplicate wheel is consumed once.
documentFixture.emit('gesturestart', {scale: 1})
documentFixture.emit('gesturechange', {scale: 1.1})
documentFixture.emit('wheel', {ctrlKey: true, deltaY: -20})
flush(); assert.ok(Math.abs(range.calls.at(-1)!.scale - (1 / 1.1 - 1)) < 1e-12)
documentFixture.emit('gesturechange', {scale: 1.21}); flush()
assert.ok(Math.abs(range.calls.at(-1)!.scale - (1 / 1.1 - 1)) < 1e-12)
documentFixture.emit('gestureend')
documentFixture.emit('wheel', {ctrlKey: true, deltaY: 1}); flush()
assert.ok(range.calls.at(-1)!.scale > 0)
assert.ok(Math.abs(pinchZoomLogDelta(.1) * 10 - pinchZoomLogDelta(1)) < 1e-12)
assert.equal(pinchZoomLogDelta(Infinity), 0)
assert.equal(pinchZoomLogDelta(1e9), .4)
assert.equal(pinchZoomLogDelta(-1e9), -.4)

htmlClasses.add('ft-lite-open')
assert.equal(documentFixture.emit('wheel',{ctrlKey:true,deltaY:-1}).defaultPrevented,false)
assert.equal(documentFixture.emit('gesturestart',{scale:1}).defaultPrevented,false)
assert.equal(documentFixture.emit('wheel',{target:new ElementFixture('[data-lite-native-editor]'),ctrlKey:true,deltaY:-1}).defaultPrevented,true)
flush(); htmlClasses.clear()

assert.equal(await helper.toggleFullscreen(), true)
assert.equal(documentFixture.fullscreenTarget, documentFixture.documentElement)
assert.equal(helper.isFullscreen(), true)
documentFixture.emit('wheel', {ctrlKey: true, deltaY: -1}); flush() // No different event scope in fullscreen.
assert.equal(await helper.toggleFullscreen(), false)
documentFixture.rejectFullscreen = true
await assert.rejects(helper.toggleFullscreen(), /denied/)
assert.equal(helper.isFullscreen(), false)

documentFixture.emit('wheel', {ctrlKey: true, deltaY: 1})
assert.equal(callbacks.size, 1)
helper.dispose(); assert.equal(callbacks.size, 0)
const beforeDisposed = range.calls.length
assert.equal(documentFixture.emit('wheel', {ctrlKey: true, deltaY: 1}).stopped, false)
flush(); assert.equal(range.calls.length, beforeDisposed)
console.log('TRACKPAD_ZOOM_OK: pan, pointer anchor, workspace anchor, smooth deltas, batching, exclusions, Safari, fullscreen, disposal')
