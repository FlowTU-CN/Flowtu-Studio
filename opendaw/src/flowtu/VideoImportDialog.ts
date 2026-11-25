import './video-import.css'

export function chooseVideoImportOptions(file: File): Promise<{originalAudio: boolean} | undefined> {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog')
        dialog.className = 'flowtu-video-import'
        dialog.setAttribute('aria-labelledby', 'flowtu-video-import-heading')
        dialog.innerHTML = `<form method="dialog"><h2 id="flowtu-video-import-heading">Import reference video</h2>
            <p class="video-import-name"></p>
            <label class="video-import-audio"><input type="checkbox" checked name="original-audio"><span>Import original audio<small>Create a new audio track aligned with the video.</small></span></label>
            <p class="video-import-hint">The video monitor stays muted. Its soundtrack plays through the new track and can be edited separately.</p>
            <footer><button value="cancel">Cancel</button><button value="import" class="video-import-confirm">Import</button></footer></form>`
        dialog.querySelector('.video-import-name')!.textContent = file.name
        const checkbox = dialog.querySelector<HTMLInputElement>('input')!
        dialog.addEventListener('close', () => {
            const options = dialog.returnValue === 'import' ? {originalAudio: checkbox.checked} : undefined
            dialog.remove()
            resolve(options)
        }, {once: true})
        document.body.append(dialog)
        dialog.showModal()
        dialog.querySelector<HTMLButtonElement>('.video-import-confirm')!.focus()
    })
}
