import type {StudioService} from '../service/StudioService'
import {deleteFilmSheet,readFilmBook} from './film-sheets'
import {deleteProjectAsset,projectAssets} from './scoring-assets'
import {tr} from './studio-language'
import './video-import.css'

type Target={id:string;name:string;kind:'Audio'|'MIDI'|'Video'}
const promptFor=(service:StudioService,target:Target)=>{
    if (target.kind==='Video') {
        const book=readFilmBook(service.project)
        if (!book.sheets.some(film=>film.id===target.id && film.hasVideo)) return
        return book.active===target.id
            ? 'Remove this video track, its cue sheet and scene analysis from this project?'
            : 'Remove this video, its cue sheet and scene analysis from this project?'
    }
    const asset=projectAssets(service.project).find(asset=>asset.id===target.id)
    if (!asset) return
    return asset.stored ? 'Remove this media item from this project?' : 'Remove this media item and its timeline clip from this project?'
}

/** A local modal also works in embedded Studio where browser confirm() is unavailable. */
export function mediaRemoveButton(service:StudioService,target:Target,onRemoved:()=>void,onError:(error:unknown)=>void,compact=false) {
    const project=service.project, button=document.createElement('button')
    button.type='button';button.dataset.deleteMedia=target.id
    const label=tr('Remove from Media')
    button.title=button.ariaLabel=label+' · '+target.name
    if (compact) {
        button.className='ft-media-remove'
        button.innerHTML='<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 5.5h13m-9-2h5m-7.5 2 1 11h8l1-11m-7 3v5m3-5v5"/></svg>'
    } else button.textContent=label
    button.onclick=e=>{
        e.stopPropagation()
        if (!service.hasProfile || service.project!==project) return
        const question=promptFor(service,target)
        if (!question) return
        const dialog=document.createElement('dialog')
        dialog.className='flowtu-video-import ft-media-confirm';dialog.ariaLabel=label
        dialog.innerHTML='<form method="dialog"><h2></h2><p class="video-import-name"></p><p class="video-import-hint"></p><footer><button value="cancel" autofocus></button><button value="remove"></button></footer></form>'
        dialog.querySelector('h2')!.textContent=label
        dialog.querySelector('.video-import-name')!.textContent=target.name
        dialog.querySelector('.video-import-hint')!.textContent=tr(question)+' '+tr('The original file stays on disk.')
        dialog.querySelector('[value=cancel]')!.textContent=tr('Cancel')
        dialog.querySelector('[value=remove]')!.textContent=tr('Delete')
        dialog.onkeydown=event=>event.stopPropagation()
        dialog.onclose=()=>{
            dialog.remove()
            if (dialog.returnValue!=='remove' || !service.hasProfile || service.project!==project) return
            try {
                if (question!==promptFor(service,target)) throw new Error(tr('The media changed. Select it again.'))
                if (target.kind==='Video') deleteFilmSheet(project,target.id)
                else deleteProjectAsset(project,target.id)
                onRemoved()
            } catch (error) {onError(error)}
        }
        document.body.append(dialog);dialog.showModal()
    }
    return button
}
