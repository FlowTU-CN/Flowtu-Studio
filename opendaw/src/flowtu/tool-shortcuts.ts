import type {EditingTool} from './editing-state'

export const profileNames = {flowtu:'Flowtu Default', video:'Final Cut / CapCut', cubase:'Cubase', protools:'Pro Tools'} as const
export type KeyProfile = keyof typeof profileNames
type Keys = Readonly<Record<string, EditingTool>>
export const toolShortcuts: Keys = {a:'select',v:'select',b:'cut',r:'range',t:'trim',f:'fade',e:'erase','1':'select','2':'cut','3':'trim','4':'fade','5':'mute','6':'erase','7':'range'}
const tools: Record<KeyProfile, Keys> = {
    flowtu: toolShortcuts,
    video: {a:'select', b:'cut', r:'range', t:'trim'},
    cubase: {'1':'select', '2':'range', '3':'cut', '5':'erase', '7':'mute'},
    protools: {f6:'trim', f7:'range', f8:'select'}
}
const storageKey = 'flowtu.keyboard-profile.v1'
let active: KeyProfile = 'flowtu'
try {
    const stored = localStorage.getItem(storageKey)
    if (stored && Object.hasOwn(profileNames, stored)) active = stored as KeyProfile
} catch { /* In-memory preferences are available in private browsing. */ }
const listeners = new Set<() => void>()
export const keyProfile = () => active
export function setKeyProfile(value: KeyProfile) {
    if (!Object.hasOwn(profileNames, value)) return
    active = value
    try {localStorage.setItem(storageKey, value)} catch {}
    listeners.forEach(notify => notify())
}
export function onKeyProfileChange(notify: () => void) {
    listeners.add(notify)
    return () => {listeners.delete(notify)}
}
type Modifiers = {altKey?:boolean;ctrlKey?:boolean;metaKey?:boolean;shiftKey?:boolean;code?:string}
export function toolForKey(key: string, modifiers: Modifiers = {}): EditingTool | undefined {
    if (modifiers.altKey || modifiers.ctrlKey || modifiers.metaKey || modifiers.shiftKey) return
    if (active !== 'flowtu' && modifiers.code?.startsWith('Numpad')) return
    return tools[active][key.toLowerCase()]
}
export function toolKeyLabel(tool: EditingTool) {
    const matches = Object.entries(tools[active]).filter(([,value]) => value === tool).map(([key]) => key)
    return (matches.find(key => /^[a-z]/.test(key)) ?? matches[0] ?? '').toUpperCase()
}
export const splitKeyLabel = () => active === 'protools' ? 'B' : active === 'cubase' ? 'Alt/Opt+X' : 'Cmd/Ctrl+B'
export function profileSplit(key: string, e: Modifiers) {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return false
    if (active === 'protools') return key.toLowerCase() === 'b' && !e.altKey
    return active === 'cubase' && !!e.altKey && (e.code === 'KeyX' || key.toLowerCase() === 'x')
}
