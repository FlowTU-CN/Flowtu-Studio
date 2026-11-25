import {keyProfile, profileNames, setKeyProfile, splitKeyLabel, toolKeyLabel, type KeyProfile} from './tool-shortcuts'
import {linkStudioSkin, setStudioSkin, skinNames, studioSkin, type StudioSkin} from './studio-skin'
import type {EditingTool} from './editing-state'
import './studio-settings.css'

export function installStudioSettings(menu: HTMLElement) {
    const unlink = linkStudioSkin(document)
    const button = document.createElement('button')
    button.textContent = 'Keyboard & appearance…'
    const dialog = document.createElement('dialog')
    dialog.className = 'ft-studio-settings'
    dialog.setAttribute('aria-label','Keyboard and appearance')
    dialog.innerHTML = `<form method="dialog"><h2>Studio settings</h2>
        <label>Editing shortcuts<select name="profile"></select></label>
        <div class="ft-binding-list"></div>
        <label>Device skin<select name="skin"></select></label>
        <footer><button>Done</button></footer></form>`
    const profile = dialog.querySelector<HTMLSelectElement>('[name=profile]')!
    const skin = dialog.querySelector<HTMLSelectElement>('[name=skin]')!
    for (const [id,label] of Object.entries(profileNames)) profile.add(new Option(label,id))
    for (const [id,label] of Object.entries(skinNames)) skin.add(new Option(label,id))
    const bindings = dialog.querySelector('.ft-binding-list')!
    const refresh = () => {
        const tools = {select:'Smart / select', range:'Range', trim:'Trim', cut:'Blade', mute:'Mute', erase:'Erase', fade:'Fade'}
        const pairs = Object.entries(tools).map(([id,label]) => [label,toolKeyLabel(id as EditingTool)])
        pairs.push(['Split',splitKeyLabel()], ['Locators to selection','P'], ['Play / Pause','Space'])
        if (keyProfile() === 'protools') pairs.push(['Zoom out / in','R / T'])
        if (keyProfile() === 'cubase') pairs.push(['Zoom out / in','G / H'], ['Go to In / Out','Num 1 / 2'], ['Cycle on / off','Num /'])
        bindings.replaceChildren()
        for (const [label,key] of pairs) {
            if (!key) continue
            const text = document.createElement('span'), kbd = document.createElement('kbd')
            text.textContent = label; kbd.textContent = key
            bindings.append(text,kbd)
        }
    }
    profile.onchange = () => {setKeyProfile(profile.value as KeyProfile); refresh()}
    skin.onchange = () => setStudioSkin(skin.value as StudioSkin)
    button.onclick = () => {profile.value = keyProfile(); skin.value = studioSkin(); refresh(); dialog.showModal()}
    menu.appendChild(button)
    document.body.append(dialog)
    return () => {unlink(); dialog.remove(); button.remove()}
}
