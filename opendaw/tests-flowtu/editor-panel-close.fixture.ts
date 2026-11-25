import assert from 'node:assert/strict'
import {Option} from '@opendaw/lib-std'
import {PanelContents} from '../src/ui/workspace/PanelContents'
import {PanelState} from '../src/ui/workspace/PanelState'
import {PanelType} from '../src/ui/workspace/PanelType'

// Browser-window lifecycle adapter. This is not a browser or popup-permission test.
type SurfaceFixture = {
    ground: {children: unknown[]}
    owner: {focus(): void}
    own(value: {terminate(): void}): void
    close(): void
}
const windows = new Map<string, SurfaceFixture>()
let windowFocuses = 0, closedWindows = 0
let delayNextOpen = false, releasePendingOpen: (() => void) | undefined
Reflect.set(globalThis, 'panelWindowFixture', {
    windows,
    async open(_width: number, _height: number, id: string) {
        if (delayNextOpen) {
            delayNextOpen = false
            await new Promise<void>(resolve => {releasePendingOpen = resolve})
        }
        const terminables: Array<{terminate(): void}> = []
        const surface: SurfaceFixture = {
            ground: {children: []},
            owner: {focus() {windowFocuses++}},
            own(value) {terminables.push(value)},
            close() {
                if (!windows.delete(id)) return
                closedWindows++
                terminables.splice(0).forEach(value => value.terminate())
            }
        }
        windows.set(id, surface)
        return Option.wrap(surface)
    }
})

const target = {id: 'currently-edited-midi-clip', notes: [{pitch: 60, position: 0, duration: 960}]}
const dataBefore = structuredClone(target)
let created = 0, terminated = 0, embedded = 0, minimized = 0, popped = 0
const panels = new PanelContents({create(lifecycle, type) {
    assert.equal(type, PanelType.ContentEditor)
    created++
    lifecycle.own({terminate() {terminated++}})
    return {target} as never
}})
const state = PanelState.create({type: 'panel', name: 'Editor', icon: 'pencil' as never,
    panelType: PanelType.ContentEditor, constrains: {type: 'flex', minSize: 248, flex: 1}})
const container = {children: [] as Array<{target: typeof target}>}
const panel = panels.getByType(PanelType.ContentEditor)
const handler = panel.bind(state, container as never, {
    onEmbed() {embedded++}, onMinimized() {minimized++}, onPopout() {popped++}
})
assert.equal(panel.isVisible, true)
assert.equal(created, 1); assert.equal(embedded, 1)
assert.equal(container.children[0].target, target)
const pendingShowRevision = panel.visibilityRevision
panel.hide()
assert.equal(state.isMinimized, true); assert.equal(panel.isVisible, false)
assert.equal(panels.isClosed(state), true)
assert.equal(container.children.length, 0)
assert.equal(terminated, 1); assert.equal(minimized, 1)
assert.notEqual(panel.visibilityRevision, pendingShowRevision, 'Closing invalidates an already queued auto-show')
const hiddenShowRevision = panel.visibilityRevision
panel.hide()
assert.equal(terminated, 1); assert.equal(minimized, 1)
assert.notEqual(panel.visibilityRevision, hiddenShowRevision, 'Explicit hide also cancels an opening request queued while hidden')
assert.deepEqual(target, dataBefore, 'Closing must not edit or clear the clip')

panels.showIfAvailable(PanelType.ContentEditor)
assert.equal(panel.isVisible, true); assert.equal(state.isMinimized, false)
assert.equal(created, 2); assert.equal(embedded, 2)
assert.equal(container.children[0].target, target, 'Reopening retains the edited clip')
panels.showIfAvailable(PanelType.ContentEditor)
assert.equal(created, 2, 'Show on an already visible editor must not remount it')
panels.toggleVisibility(PanelType.ContentEditor)
assert.equal(panel.isVisible, false); assert.equal(terminated, 2)
panels.toggleVisibility(PanelType.ContentEditor)
assert.equal(panel.isVisible, true); assert.equal(created, 3)

panel.togglePopout()
await Promise.resolve()
assert.equal(panel.isPopout, true); assert.equal(panel.isVisible, true)
assert.equal(container.children.length, 0)
assert.equal(created, 4); assert.equal(terminated, 3); assert.equal(popped, 1)
panels.showIfAvailable(PanelType.ContentEditor)
assert.equal(windowFocuses, 1); assert.equal(created, 4)
panels.toggleVisibility(PanelType.ContentEditor)
assert.equal(closedWindows, 1); assert.equal(panel.isPopout, false)
assert.equal(panel.isVisible, false); assert.equal(state.isMinimized, true)
assert.equal(created, 4, 'Closing the floating editor must not recreate it in the workspace')
assert.equal(terminated, 4); assert.equal(container.children.length, 0)
panels.showIfAvailable(PanelType.ContentEditor)
assert.equal(created, 5); assert.equal(panel.isVisible, true)
assert.equal(container.children[0].target, target)
assert.deepEqual(target, dataBefore)

// Closing while the browser window is still opening must win over its delayed result.
delayNextOpen = true
panel.togglePopout()
assert.equal(panel.isPopout, false)
assert.ok(releasePendingOpen)
panel.hide()
assert.equal(terminated, 5); assert.equal(state.isMinimized, true)
releasePendingOpen()
await new Promise<void>(resolve => setImmediate(resolve))
assert.equal(panel.isPopout, false); assert.equal(panel.isVisible, false)
assert.equal(closedWindows, 2)
assert.equal(created, 5, 'An obsolete popout result must never recreate the editor')
assert.equal(container.children.length, 0)
panels.showIfAvailable(PanelType.ContentEditor)
assert.equal(created, 6); assert.equal(container.children[0].target, target)

handler.terminate()
assert.equal(terminated, 6)
assert.equal(panel.isVisible, false); assert.equal(panel.panelState.isEmpty(), true)
panels.showIfAvailable(PanelType.ContentEditor)
panel.hide()
assert.equal(created, 6, 'A released placeholder must not mount hidden content')
console.log('EDITOR_PANEL_CLOSE_OK')
