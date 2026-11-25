import skinCSS from './studio-settings.css?inline'

export const skinNames = {studio:'Flowtu Blue', modular:'Modular Graphite', phosphor:'Phosphor', ultraviolet:'Ultraviolet'} as const
export type StudioSkin = keyof typeof skinNames
const storageKey = 'flowtu.device-skin.v1'
let active: StudioSkin = 'studio'
try {
    const name = localStorage.getItem(storageKey)
    if (name && Object.hasOwn(skinNames, name)) active = name as StudioSkin
} catch {}
const listeners = new Set<() => void>()
export function onStudioSkinChange(update: () => void) {
    listeners.add(update)
    return () => {listeners.delete(update)}
}
const documents = new Set<Document>()
export const studioSkin = () => active
export function linkStudioSkin(doc: Document) {
    documents.add(doc)
    doc.documentElement.dataset.studioSkin = active
    const styles = doc === document ? null : doc.createElement('style')
    if (styles) {
        styles.textContent = skinCSS
        doc.head.append(styles)
    }
    return () => {documents.delete(doc); styles?.remove()}
}
export function setStudioSkin(name: StudioSkin) {
    if (!Object.hasOwn(skinNames, name)) return
    if (active === name) return
    active = name
    try {localStorage.setItem(storageKey,name)} catch {}
    documents.forEach(doc => doc.documentElement.dataset.studioSkin = name)
    listeners.forEach(update => update())
}
