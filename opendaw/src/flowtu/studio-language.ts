import {routingDeleteMessages} from './routing-delete-messages'
import {liteMessages} from './lite-messages'
import {projectLibraryMessages} from './project-library-messages'
import {litePanelMessages} from './lite-panel-messages'
import {nativeMessages, nativeCaptions} from './native-messages'
import {studioMessages} from './studio-messages'
import {workspaceMessages} from './workspace-messages'

import {guideMessages} from './guide-messages'
import {editingMessages} from './editing-messages'

export const studioLanguages = {
    en: 'English', 'zh-CN': '简体中文', es: 'Español', pt: 'Português', ja: '日本語', ko: '한국어'
} as const
export type StudioLanguage = keyof typeof studioLanguages
const locales = Object.keys(studioLanguages) as StudioLanguage[]
const storageKey = 'flowtu.studio.language'
const messages = new Map([studioMessages, workspaceMessages, editingMessages, guideMessages, nativeMessages, routingDeleteMessages, litePanelMessages, liteMessages, projectLibraryMessages].join('\n').split('\n').map(row => {
    const words = row.split('|')
    if (words.length !== locales.length) throw new Error('Incomplete Studio translation: ' + words[0])
    return [words[0], words] as const
}))
const listeners = new Set<() => void>()
function defaultLanguage(): StudioLanguage {
    try {
        const saved = localStorage.getItem(storageKey)
        if (locales.includes(saved as StudioLanguage)) return saved as StudioLanguage
    } catch { /* Storage is optional in embedded workspaces. */ }
    const browser = typeof navigator === 'undefined' ? 'en' : navigator.language.toLowerCase().split('-')[0]
    return browser === 'zh' ? 'zh-CN' : locales.includes(browser as StudioLanguage) ? browser as StudioLanguage : 'en'
}
let language = defaultLanguage()
export const studioLanguage = () => language
export function setStudioLanguage(next: StudioLanguage) {
    if (!locales.includes(next) || next === language) return
    language = next
    try {localStorage.setItem(storageKey, next)} catch { /* Session preference still applies. */ }
    for (const refresh of listeners) refresh()
}
export function watchStudioLanguage(refresh: () => void) {
    listeners.add(refresh)
    return () => {listeners.delete(refresh)}
}
export function tr(source: string, ...values: (string | number)[]): string {
    const output = messages.get(source)?.[locales.indexOf(language)] ?? source
    return values.length ? output.replace(/\{(\d+)\}/g, (token, index) => String(values[Number(index)] ?? token)) : output
}

// Only Studio-owned captions belong here. Track names, filenames, plug-in presets, cue names,
// prompt text, and editable content live in separate elements and must remain exactly as entered.
const captions = [
    ...nativeCaptions,
    '[data-i18n]', '[data-guide]', '.flowtu-bar > button', '.flowtu-menu-label', '.flowtu-workspace-menu .flowtu-menu-panel > :is(button,a,label)',
    '.flowtu-status', '.ft-patch-scroll', '.ft-patch-node > h3', '.ft-palette select', '.ft-palette > span', '.ft-palette option', '.ft-color-swatch',
    '.ft-patch > header :is(strong,button,select)', '.ft-patch > footer output', '.ft-patch-inspector button',
    '.flowtu-panel-cards .dock-choices span', '.flowtu-panel-cards .dock-mode button',
    '.ft-studio-settings :is(h2,label,option,button)', '.ft-binding-list span',
    '.flowtu-video-import :is(h2,legend,label,small,button,.video-import-hint)', '.flowtu-video-import label > span',
    '.ft-score-cue-empty', '.ft-score-take-empty', '.ft-score-session-title b', '.flowtu-range-tools output', '.ft-score-heading nav button', '.ft-score-left-views button', '.ft-score-section-title strong',
    '.ft-score [data-action]', '.ft-score-detail label', '.ft-score-detail [data-preset]', '.ft-score-caption',
    '.ft-direction-controls :is(label,summary,option)', '.ft-score-toolbox :is(summary,h3,li)', '.ft-score-footer > *',
    '.ft-asset-filters :is(input,option,button)', '.ft-asset-list > p', '.ft-asset-actions button', '.ft-film-card small',
    '.flowtu-video :is(strong,button,label,p)', '.ft-monitor-transport button',
    '.flowtu-editing-toolbar :is(button,summary,label,option)', '.flowtu-editing-toolbar button > span',
    '.edit-selection', '.edit-zoom-hint', '.flowtu-range-tools :is(button,label)', '.flowtu-envelope-tools button',
    '.flowtu-precision-transport :is(button,label,option)', '.flowtu-precision-transport .transport-error',
    '.flowtu-composer :is(header strong,.local-badge,button,label,footer output)', '.compose-examples > span',
    '.flowtu-composer option[value="new"]', '.flowtu-audio-tools :is(label,legend,h3,button,header strong,.fade-hint)',
    '.flowtu-audio-tools select:is([aria-label="Crossfade mode"],[aria-label="Crossfade curve"],[aria-label="Fade curve"]) option',
    '.ft-deck :is(.ft-deck-edit > small,.ft-deck-edit > button,.ft-deck-empty,button[data-preview])', '.ft-deck :is(.ft-deck-source,.ft-deck-outputs) button',
    '.flowtu-help :is(h2,b,p,li,button)'
].join(',')
type Original = {source: string; shown: string}
const patterns: ReadonlyArray<[RegExp, string]> = [
    [/^Session (.+)$/, 'Session {0}'],
    [/^Cue (.+) · Results$/, 'Cue {0} · Results'],
    [/^Cue (.+) selected\.$/, 'Cue {0} selected.'],
    [/^Cue (.+) removed\.$/, 'Cue {0} removed.'],
    [/^(.+) added to Assets$/, '{0} added to Assets'],
    [/^Imported (.+)$/, 'Imported {0}'],
    [/^Importing (.+)…$/, 'Importing {0}…'],
    [/^(\d+) aligned stereo WAV files$/, '{0} aligned stereo WAV files'],
    [/^Rendering (\d+)%$/, 'Rendering {0}%'],
    [/^(.+) output · choose an In$/, '{0} output · choose an In'],
    [/^(.+) send · choose an In$/, '{0} send · choose an In']
]
function translateCaption(source: string): string {
    const english = source.trim()
    if (!english) return source
    let translation = tr(english)
    if (translation === english && language !== 'en') {
        for (const [pattern, template] of patterns) {
            const matched = english.match(pattern)
            if (matched) {translation = tr(template, ...matched.slice(1)); break}
        }
    }
    return translation === english ? source : source.replace(english, () => translation)
}

export function localizeStudioDocument(doc: Document): () => void {
    const originalText = new WeakMap<Text, Original>()
    const originalAttrs = new WeakMap<Element, Map<string, Original>>()
    function translate(element: Element) {
        if (!element.matches(captions) || element.closest('[contenteditable="true"],[data-no-i18n]')) return
        for (const child of element.childNodes) {
            if (child.nodeType !== 3 || !child.nodeValue?.trim()) continue
            const node = child as Text, previous = originalText.get(node)
            const source = previous && previous.shown === node.data ? previous.source : node.data
            const guide = element.getAttribute('data-guide')
            const shown = guide && language !== 'en' ? tr(guide, element.getAttribute('data-guide-arg') ?? '') : translateCaption(source)
            if (node.data !== shown) {
                if (element.localName === 'option' && !element.hasAttribute('value')) element.setAttribute('value', source)
                node.data = shown
            }
            if (source !== shown || previous) originalText.set(node, {source, shown})
        }
        for (const attr of ['title', 'placeholder', 'aria-label']) {
            const value = element.getAttribute(attr)
            if (!value) continue
            // Some upstream controls use aria-label as a stable lookup key.
            if (attr === 'aria-label' && !element.matches('[data-i18n],.ft-patch *, .ft-palette *, .ft-color-swatch, .ft-monitor-transport button, .ft-asset-filters input')) continue
            const attrs = originalAttrs.get(element) ?? new Map<string, Original>()
            const previous = attrs.get(attr)
            const source = previous && previous.shown === value ? previous.source : value
            const shown = translateCaption(source)
            if (shown !== value) element.setAttribute(attr, shown)
            if (source !== shown || previous) {attrs.set(attr, {source, shown}); originalAttrs.set(element, attrs)}
        }
    }
    function scan(root: Element) {
        translate(root)
        for (const element of root.querySelectorAll(captions)) translate(element)
    }
    const refresh = () => {
        doc.documentElement.lang = language
        scan(doc.body)
    }
    refresh()
    const unwatch = watchStudioLanguage(refresh)
    const observer = new MutationObserver(records => {
        if (language === 'en') return
        for (const record of records) {
            const target = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement
            if (!target) continue
            if (record.type !== 'childList') {translate(target); continue}
            for (const node of record.addedNodes) {
                if (node.nodeType === 1) scan(node as Element)
                else if (node.nodeType === 3) translate(target)
            }
        }
    })
    observer.observe(doc.body, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title','placeholder','aria-label']})
    return () => {observer.disconnect(); unwatch()}
}

export function installStudioLanguage(bar: HTMLElement) {
    const picker = bar.ownerDocument.createElement('select')
    picker.className = 'ft-studio-language'
    for (const [id, name] of Object.entries(studioLanguages)) picker.add(new Option(name, id))
    picker.onchange = () => setStudioLanguage(picker.value as StudioLanguage)
    const refresh = () => {
        picker.value = studioLanguage()
        picker.title = tr('Language')
        picker.setAttribute('aria-label', picker.title)
    }
    refresh()
    bar.append(picker)
    const unwatch = watchStudioLanguage(refresh)
    const detach = localizeStudioDocument(bar.ownerDocument)
    return () => {unwatch(); detach(); picker.remove()}
}

