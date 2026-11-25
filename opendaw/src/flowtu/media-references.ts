import {mediaKind} from './media-import'

export function createMediaReferences(importFiles: (files: File[]) => Promise<readonly File[]>) {
    const element = document.createElement('section')
    element.className = 'ft-media-references'
    element.innerHTML = '<header><strong>Media references</strong><label>Add files<input type="file" multiple accept="image/*,video/*,audio/*,.wav,.aif,.aiff,.flac,.mp3,.m4a,.mid,.midi,.kar,.smf"></label></header><p>Drop images, video, audio or MIDI here.</p><div class="ft-reference-list"></div>'
    const input = element.querySelector('input')!, list = element.querySelector('.ft-reference-list')!
    const urls = new Set<string>()
    let revision = 0
    async function add(inputFiles: FileList | null) {
        const files = Array.from(inputFiles ?? []), current = revision
        const music = files.filter(file => mediaKind(file))
        const accepted = music.length ? await importFiles(music) : []
        if (current !== revision) return
        for (const file of files) {
            if (music.includes(file) && (!accepted.includes(file) || mediaKind(file) === 'midi')) continue
            const kind = mediaKind(file) === 'audio' ? 'audio' : file.type.split('/')[0]
            if (!['image','video','audio'].includes(kind)) continue
            const url = URL.createObjectURL(file), card = document.createElement('figure')
            urls.add(url)
            const media = document.createElement(kind === 'image' ? 'img' : kind === 'audio' ? 'audio' : 'video')
            media.src = url
            if (media instanceof HTMLMediaElement) {media.controls = true; media.preload = 'metadata'}
            else media.alt = file.name
            const caption = document.createElement('figcaption'), remove = document.createElement('button')
            caption.textContent = file.name
            remove.textContent = 'Remove'; remove.title = 'Remove reference preview'
            remove.onclick = () => {card.remove(); URL.revokeObjectURL(url); urls.delete(url)}
            card.append(media,caption,remove); list.append(card)
        }
    }
    input.onchange = () => {add(input.files); input.value = ''}
    element.ondragover = event => {if (event.dataTransfer?.types.includes('Files')) event.preventDefault()}
    element.ondrop = event => {event.preventDefault(); event.stopPropagation(); add(event.dataTransfer?.files ?? null)}
    return {element, clear() {revision++; list.replaceChildren(); urls.forEach(url => URL.revokeObjectURL(url)); urls.clear()},
        pause() {element.querySelectorAll('audio,video').forEach(media => (media as HTMLMediaElement).pause())}}
}
