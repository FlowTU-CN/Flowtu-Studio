import {tr} from './studio-language'
import './file-destination.css'

export type FileDestination = {
    readonly name: string
    readonly handle?: FileSystemFileHandle
    write(data: Blob | ArrayBuffer): Promise<void>
}

export const saveCancelled = (error: unknown) => error instanceof Error && error.name === 'AbortError'
const cancelled = () => new DOMException('Save cancelled', 'AbortError')
const fileName = (name: string) => name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().replace(/[. ]+$/, '').slice(0, 220) || 'Flowtu'

function chooser(name: string) {
    const dialog=document.createElement('dialog')
    dialog.className='ft-file-destination'
    const title=document.createElement('h2'), hint=document.createElement('p'), footer=document.createElement('footer')
    title.textContent=tr('Save file')
    dialog.ariaLabel=title.textContent
    const cancel=document.createElement('button')
    cancel.type='button'; cancel.textContent=tr('Cancel'); cancel.onclick=()=>dialog.close()
    footer.append(cancel)
    dialog.append(title,hint,footer)
    document.body.append(dialog)
    return {dialog,hint,footer,name}
}

// A real click on the link also works in browsers that reject scripted downloads after a slow render.
function browserDestination(suggestedName: string): FileDestination {
    let chosen=suggestedName
    return {get name(){return chosen}, async write(data) {
        const blob=data instanceof Blob ? data : new Blob([data])
        const url=URL.createObjectURL(blob)
        const {dialog,hint,footer}=chooser(chosen)
        hint.textContent=tr('Your browser manages the download folder. Enable “Ask where to save each file” in its download settings to choose a folder each time.')
        const field=document.createElement('label'), name=document.createElement('input')
        field.textContent=tr('File name');name.value=chosen;field.append(name);dialog.insertBefore(field,footer)
        const link=document.createElement('a');link.textContent=tr('Download');link.href=url
        const update=()=>{link.download=fileName(name.value)}
        name.oninput=update;update();footer.append(link)
        let ok=false
        link.onclick=()=>{update();chosen=link.download;ok=true;dialog.close()}
        if (typeof navigator.canShare==='function' && navigator.canShare({files:[new File([blob],chosen,{type:blob.type})]})) {
            const share=document.createElement('button')
            share.type='button';share.textContent=tr('Share or save to Files…')
            share.onclick=async()=>{
                const userName=fileName(name.value)
                try {
                    await navigator.share({files:[new File([blob],userName,{type:blob.type})]})
                    ok=true;chosen=userName;dialog.close()
                } catch (error) {if (!saveCancelled(error)) hint.textContent=String(error)}
            }
            footer.insertBefore(share,link)
        }
        try {
            await new Promise<void>(resolve=>{dialog.onclose=()=>resolve();dialog.showModal();name.focus();name.select()})
            if (!ok) throw cancelled()
        } finally {dialog.remove();if (ok) window.setTimeout(()=>URL.revokeObjectURL(url),60000);else URL.revokeObjectURL(url)}
    }}
}

async function pickNative(options: SaveFilePickerOptions, name: string): Promise<FileDestination | undefined> {
    try {
        const handle=await window.showSaveFilePicker({...options,suggestedName:name})
        return {name:handle.name,handle,async write(data) {
            const writable=await handle.createWritable()
            try {await writable.write(data);await writable.close()}
            catch (error) {await writable.abort().catch(()=>{});throw error}
        }}
    } catch (error) {
        if (saveCancelled(error)) return undefined
        // Sandboxed embeds may expose the API but refuse to open the OS dialog.
        if (error instanceof DOMException && ['SecurityError','NotAllowedError'].includes(error.name)) return browserDestination(name)
        throw error
    }
}

export async function chooseFileDestination(suggestedName: string, options: SaveFilePickerOptions = {}): Promise<FileDestination | undefined> {
    const name=fileName(suggestedName)
    if (typeof window.showSaveFilePicker!=='function') return browserDestination(name)
    if (!navigator.userActivation || navigator.userActivation.isActive) return pickNative(options,name)
    // Third-party exporters can finish encoding after activation expires. Reacquire it on an explicit click.
    const {dialog,hint,footer}=chooser(name);hint.textContent=name
    const pick=document.createElement('button');pick.type='button';pick.textContent=tr('Choose save location…');footer.append(pick)
    return new Promise((resolve,reject)=>{
        let choice:FileDestination|undefined
        dialog.onclose=()=>{dialog.remove();resolve(choice)}
        pick.onclick=async()=>{
            pick.disabled=true
            try {choice=await pickNative(options,name);dialog.close()}
            catch (error) {reject(error);dialog.close()}
        }
        dialog.showModal();pick.focus()
    })
}

/** Adapter for the SDK's Files.save contract (including reject-on-cancel). */
export async function saveNativeFile(buffer: ArrayBuffer, options: SaveFilePickerOptions = {}) {
    const suffix = Object.values(options.types?.[0]?.accept ?? {}).flat()[0] ?? ''
    const dest = await chooseFileDestination(options.suggestedName || 'Flowtu' + suffix, options)
    if (!dest) throw cancelled()
    await dest.write(buffer)
    return dest.name
}
