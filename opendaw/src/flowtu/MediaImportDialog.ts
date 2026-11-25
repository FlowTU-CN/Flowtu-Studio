import type {MediaDestination} from './media-import'
import './video-import.css'

export function chooseMediaDestination(file: File, targets: {id: string; name: string}[], preferredTrack?: string,
                                      assetsFirst = false): Promise<MediaDestination | undefined> {
    const dialog = document.createElement('dialog')
    dialog.className = 'flowtu-video-import ft-media-import'
    dialog.setAttribute('aria-label', 'Import media')
    dialog.innerHTML = `<form method="dialog">
        <h2>Import media</h2><p class="video-import-name"></p>
        <fieldset><legend>Destination</legend>
        <label><input type="radio" name="destination" value="existing" aria-label="Existing track">Existing track</label>
        <select aria-label="Destination track"></select>
        <label><input type="radio" name="destination" value="new" aria-label="New track">New track</label>
        <label><input type="radio" name="destination" value="assets" aria-label="Assets only"><span>Assets only<small>Use in Music Creation or FlowDeck.</small></span></label>
        </fieldset><footer><button type="button" class="cancel">Cancel</button><button type="submit" value="import" class="video-import-confirm">Import</button></footer>
        </form>`
    dialog.querySelector('.video-import-name')!.textContent = file.name
    const form = dialog.querySelector('form')!, select = dialog.querySelector('select')!
    const radios = Array.from(form.querySelectorAll<HTMLInputElement>('input'))
    for (const target of targets) select.add(new Option(target.name, target.id))
    if (preferredTrack && targets.some(t => t.id === preferredTrack)) select.value = preferredTrack
    radios[0].disabled = !targets.length
    const choice = assetsFirst ? 'assets' : targets.length ? 'existing' : 'new'
    const selected = radios.find(input => input.value === choice)!
    selected.checked = true
    const refresh = () => {select.disabled = !radios[0].checked}
    form.onchange = refresh
    refresh()
    dialog.querySelector<HTMLButtonElement>('.cancel')!.onclick = () => dialog.close()
    return new Promise(resolve => {
        dialog.addEventListener('close', () => {
            const kind = new FormData(form).get('destination')
            dialog.remove()
            if (dialog.returnValue !== 'import') resolve(undefined)
            else if (kind === 'existing' && select.value) resolve({kind, trackId: select.value})
            else if (kind === 'assets' || kind === 'new') resolve({kind})
            else resolve(undefined)
        }, {once: true})
        document.body.append(dialog)
        dialog.showModal()
        selected.focus()
    })
}
