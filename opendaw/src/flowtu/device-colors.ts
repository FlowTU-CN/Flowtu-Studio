import {MetaData} from '@opendaw/studio-adapters'
import type {Box} from '@opendaw/lib-box'
import {Color} from '@opendaw/lib-std'
import {Pointers} from '@opendaw/studio-enums'
import type {Project} from '@opendaw/studio-core'
import {onStudioSkinChange, setStudioSkin, skinNames, studioSkin, type StudioSkin} from './studio-skin'

function supportsColor(box: Box): box is Parameters<typeof MetaData.read>[0] {
    return box.pointerRules.accepts.includes(Pointers.MetaData)
}
const origin = 'flowtu:device-color:v1'
const palettes = {
    studio: ['#75bbec','#f3a26b','#67cbbb','#c097e8','#9fc3dc','#e194ad','#a9c88c','#f0c27d'],
    modular: ['#ffa254','#64d1c1','#ff7395','#8dbbff','#e7c95e','#bb93f3','#9cd072','#ea9bad'],
    phosphor: ['#add780','#6cceac','#e2ce88','#93c9c2','#c1b683','#86c9e0','#b0b8dc','#d8a98b'],
    ultraviolet: ['#c397ef','#819ff2','#ec95c4','#86cee0','#edaa85','#a89beb','#93d4b9','#d6b2dc']
} satisfies Record<StudioSkin,string[]>

export function colorFor(box: Box, slot?: number): string {
    const custom = supportsColor(box) ? MetaData.read(box, origin) : null
    if (typeof custom === 'string' && /^#[a-f0-9]{6}$/i.test(custom)) return custom
    const index = slot ?? box.address.uuid.reduce((hash, part) => (Math.imul(hash, 31) + part) >>> 0, 0)
    const palette = palettes[studioSkin()]
    const base = palette[index % palette.length]
    if (slot === undefined || slot < palette.length) return base
    const {h, s, l} = Color.hexToHsl(base)
    return Color.hslToHex((h + 137.508 * Math.floor(slot / palette.length)) % 360, s, l)
}

export function chooseColor(doc: Document, project: Project, box: Box, label: string, slot?: number) {
    const input = doc.createElement('input')
    input.type = 'color'
    input.className = 'ft-color-swatch'
    input.title = label
    input.setAttribute('aria-label', label)
    input.value = colorFor(box, slot)
    input.onpointerdown = e => e.stopPropagation()
    if (supportsColor(box)) input.onchange = () => project.editing.modify(() => MetaData.store(box, input.value, origin), true)
    else input.hidden = true
    return input
}

export function resetColor(project: Project, box: Box) {
    if (supportsColor(box)) project.editing.modify(() => MetaData.clear(box, origin), true)
}
export function watchColor(box: Box, update: () => void) {
    update()
    const sub = supportsColor(box) ? MetaData.catchupAndSubscribe(box, origin, update) : undefined
    const unlink = onStudioSkinChange(update)
    return {terminate: () => {sub?.terminate(); unlink()}}
}

export function paletteMenu(doc: Document) {
    const label = doc.createElement('label')
    label.className = 'ft-palette'
    const caption = doc.createElement('span')
    caption.textContent = 'Palette'
    const menu = doc.createElement('select')
    menu.setAttribute('aria-label','Color palette')
    for (const [id, name] of Object.entries(skinNames)) {
        const option = doc.createElement('option')
        option.value = id
        option.textContent = name
        menu.append(option)
    }
    menu.value = studioSkin()
    menu.onchange = () => setStudioSkin(menu.value as StudioSkin)
    label.append(caption, menu)
    return {element: label, terminate: onStudioSkinChange(() => {menu.value = studioSkin()})}
}
