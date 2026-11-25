import assert from 'node:assert/strict'

// DOM/event contract fixture using the real native ShortcutManager. It does not
// stand in for browser keyboard/clipboard permissions or audio playback QA.
class ElementFixture {
    children: ElementFixture[] = []; parent: ElementFixture | null = null
    dataset: Record<string, string> = {}; attributes: Record<string, string> = {}
    listeners = new Map<string, Set<(event: any) => void>>()
    nativeClipboard?: (event: any) => void
    constructor(readonly tag: string, readonly ownerDocument = documentFixture) {}
    append(...children: ElementFixture[]) {children.forEach(child => {child.parent = this; this.children.push(child)})}
    contains(node: unknown): boolean {return node === this || this.children.some(child => child.contains(node))}
    getAttribute(name: string) {return this.attributes[name] ?? null}
    matches(selector: string): boolean {
        return selector.split(',').some(part => {
            if (part === 'canvas[data-note-editor]') return this.tag === 'canvas' && 'noteEditor' in this.dataset
            if (part === 'canvas[data-value-editor]') return this.tag === 'canvas' && 'valueEditor' in this.dataset
            if (part === 'canvas[data-audio-editor]') return this.tag === 'canvas' && 'audioEditor' in this.dataset
            if (part.startsWith('[contenteditable]')) return this.attributes.contenteditable !== undefined && this.attributes.contenteditable !== 'false'
            if (part.startsWith('[role=')) return this.attributes.role === part.slice(6, -1)
            if (part === '[data-flowtu-menu]') return 'flowtuMenu' in this.dataset
            if (part === '[data-menu-group-id]') return 'menuGroupId' in this.dataset
            return this.tag === part
        })
    }
    closest(selector: string): ElementFixture | null {return this.matches(selector) ? this : this.parent?.closest(selector) ?? null}
    querySelector(selector: string): ElementFixture | null {
        for (const child of this.children) {if (child.matches(selector)) return child; const found = child.querySelector(selector); if (found) return found}
        return null
    }
    focus() {this.ownerDocument.activeElement = this}
    addEventListener(type: string, callback: (event: any) => void) {const list = this.listeners.get(type) ?? new Set(); list.add(callback); this.listeners.set(type, list)}
    removeEventListener(type: string, callback: (event: any) => void) {this.listeners.get(type)?.delete(callback)}
    emit(type: string, event: any) {for (const callback of this.listeners.get(type) ?? []) callback(event)}
    dispatchEvent(event: any) {event.target = this; root.emit(event.type, event); this.nativeClipboard?.(event); return !event.defaultPrevented}
}
class InputFixture extends ElementFixture {}
class TextareaFixture extends ElementFixture {}
class ClipboardFixture {
    target: unknown; defaultPrevented = false; stopped = false
    readonly clipboardData: unknown
    constructor(readonly type: string, init: any) {this.clipboardData = init.clipboardData}
    preventDefault() {this.defaultPrevented = true}
    stopImmediatePropagation() {this.stopped = true}
}
const documentFixture = {activeElement: null as ElementFixture | null, overlay: false, querySelector: (_selector: string) => documentFixture.overlay ? {} : null}
const root = new ElementFixture('root'), content = new ElementFixture('content'), ruler = new ElementFixture('ruler')
const piano = new ElementFixture('canvas'), notes = new ElementFixture('canvas'), velocity = new ElementFixture('canvas')
const values = new ElementFixture('canvas'), field = new InputFixture('input'), menu = new ElementFixture('menu'), headerButton = new ElementFixture('button')
root.dataset.editorKind = 'notes'; notes.dataset.noteEditor = ''; values.dataset.valueEditor = ''; menu.dataset.flowtuMenu = 'panel'
root.append(ruler, content, headerButton); content.append(piano, notes, velocity, field, menu)
Object.assign(globalThis, {document: documentFixture, window: {}, Element: ElementFixture, HTMLElement: ElementFixture,
    HTMLInputElement: InputFixture, HTMLTextAreaElement: TextareaFixture, ClipboardEvent: ClipboardFixture})
const {installContentEditorFocus, primaryContentCanvas} = await import('../src/ui/timeline/editors/ContentEditorFocus')
const {ShortcutManager, Shortcut, Key} = await import('@opendaw/lib-dom')
const installed = installContentEditorFocus(root as never, content as never)
assert.equal(primaryContentCanvas(content as never), notes, 'Restore must choose the piano-roll editor, not the left piano-key canvas')
const shortcuts = new ShortcutManager()
let selected = 0, deleted = 0, noteMoves = 0, playheadMoves = 0
const timelineContext = shortcuts.createContext(root as never, 'ruler')
timelineContext.register(Shortcut.of(Key.ArrowRight), () => {playheadMoves++})
const noteContext = shortcuts.createContext(notes as never, 'native piano roll')
noteContext.register(Shortcut.of(Key.KeyA, {ctrl: true}), () => {selected = 4})
noteContext.register(Shortcut.of(Key.DeleteAction), () => {deleted += selected; selected = 0})
noteContext.register(Shortcut.of(Key.ArrowRight), () => {noteMoves++})
noteContext.register(Shortcut.of(Key.ArrowUp), () => {noteMoves++})
const press = (target: ElementFixture, key: string, code: string, modifiers = {}) => {
    target.focus()
    const event = {target, key, code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false,
        defaultPrevented: false, preventDefault() {this.defaultPrevented = true}, ...modifiers}
    root.emit('keydown', event)
    shortcuts.handleEvent(event as never)
    return event
}
press(ruler, 'a', 'KeyA', {ctrlKey: true})
assert.equal(selected, 4); assert.equal(documentFixture.activeElement, notes)
press(headerButton, 'a', 'KeyA', {ctrlKey: true}); assert.equal(documentFixture.activeElement, notes)
press(velocity, 'Backspace', 'Backspace')
assert.equal(deleted, 4); assert.equal(documentFixture.activeElement, notes)
press(ruler, 'ArrowRight', 'ArrowRight')
assert.equal(playheadMoves, 1); assert.equal(noteMoves, 0); assert.equal(documentFixture.activeElement, ruler)
press(velocity, 'ArrowRight', 'ArrowRight'); press(ruler, 'ArrowUp', 'ArrowUp')
assert.equal(noteMoves, 2)
press(field, 'a', 'KeyA', {ctrlKey: true}); assert.equal(documentFixture.activeElement, field)
press(menu, 'a', 'KeyA', {ctrlKey: true}); assert.equal(documentFixture.activeElement, menu)
documentFixture.overlay = true
press(ruler, 'a', 'KeyA', {ctrlKey: true}); assert.equal(documentFixture.activeElement, ruler)
documentFixture.overlay = false
press(ruler, 'a', 'KeyA', {ctrlKey: true, isComposing: true}); assert.equal(documentFixture.activeElement, ruler)
root.dataset.editorKind = 'audio'
press(ruler, 'a', 'KeyA', {ctrlKey: true}); assert.equal(documentFixture.activeElement, ruler)
root.dataset.editorKind = 'value'; content.append(values)
press(ruler, 'a', 'KeyA', {ctrlKey: true}); assert.equal(documentFixture.activeElement, values)
press(ruler, 'ArrowUp', 'ArrowUp'); assert.equal(documentFixture.activeElement, ruler)

root.dataset.editorKind = 'notes'
let copies = 0, allowed = true
const clipboardData = {setData() {}}
notes.nativeClipboard = event => {assert.equal(event.clipboardData, clipboardData); if (allowed) {copies++; event.preventDefault()}}
const copy = () => {ruler.focus(); const event = new ClipboardFixture('copy', {clipboardData}); event.target = ruler; root.emit('copy', event); return event}
const copied = copy(); assert.equal(copies, 1); assert.equal(copied.defaultPrevented, true); assert.equal(copied.stopped, true)
allowed = false
assert.equal(copy().defaultPrevented, false, 'Do not consume commands rejected by native playback restrictions')
installed.terminate(); ruler.focus(); press(ruler, 'a', 'KeyA', {ctrlKey: true}); assert.equal(documentFixture.activeElement, ruler)
noteContext.terminate(); timelineContext.terminate()
console.log('CONTENT_EDITOR_FOCUS_OK')
