import {createToolbarMenu} from './ToolbarMenu'
import {tr} from './studio-language'
import './creative-toolbox.css'

const plannedTools = [
    ['Voice generation','M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zm-3 6a6 6 0 0 0 12 0m-6 6v4m-3 0h6'],
    ['Translation','M3 6h11M8 3v3m4 1c-.8 4-4 7.5-8 10m2-7c1 2 3 4 6 6m2 4 4-10 4 10m-6-4h5'],
    ['Lip sync','M2 12c3-2 6-6 9-3l1 1 1-1c3-3 6 1 9 3-3 4-6 6-10 6s-7-2-10-6zm1 0c6 2 12 2 18 0'],
    ['Dialogue','M3 4h13v10H8l-4 3v-3H3zm16 5h2v11h-3v2l-4-2H9v-3']
] as const

export function fillPlannedTools(list: HTMLUListElement, withIcons=false) {
    list.replaceChildren(...plannedTools.map(([label,path]) => {
        const item = document.createElement('li')
        if (withIcons) item.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="'+path+'"/></svg>'
        const name = document.createElement('span')
        name.dataset.i18n = ''
        name.textContent = label
        item.append(name)
        return item
    }))
}

export function createComposerToolbox() {
    const menu = createToolbarMenu('Toolbox')
    menu.element.classList.add('ft-creative-add')
    menu.panel.classList.add('ft-creative-tools')
    menu.trigger.innerHTML = '<svg aria-hidden="true" viewBox="0 0 20 20"><path d="M10 3.5v13M3.5 10h13"/></svg>'
    const heading = document.createElement('h3')
    const list = document.createElement('ul')
    fillPlannedTools(list,true)
    menu.panel.append(heading,list)
    const labels = () => {
        menu.trigger.title = menu.trigger.ariaLabel = tr('Toolbox')
        menu.panel.ariaLabel = tr('Toolbox')
        heading.textContent = tr('Planned tools')
    }
    labels()
    return {element:menu.element, labels, close:()=>menu.close(false), dispose:menu.dispose}
}
