import './project-library.css'
import {chooseFileDestination, type FileDestination} from './file-destination'
import {ProjectStorage} from '@opendaw/studio-core'
import {tr} from './studio-language'
import {accountOwner, cloudLibrary, deleteCloudProject, guestOwner, listDeviceProjects, removeDeviceProject, type CloudProject, type LibraryStatus, type ProjectEntry} from './project-library'

export type LibraryChoice = {kind: 'local'; entry: ProjectEntry} |
    {kind: 'cloud'; owner: string; remote: CloudProject; cached?: ProjectEntry} | {kind: 'import'} | {kind: 'legacy'; item: ProjectStorage.ListEntry}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const node = document.createElement(tag)
    if (text) node.textContent = text
    return node
}
function modal(title: string) {
    const dialog = el('dialog')
    dialog.className = 'ft-project-library'
    dialog.setAttribute('aria-label', tr(title))
    const header = el('header'), heading = el('h2', tr(title)), close = el('button','×')
    close.type = 'button'; close.setAttribute('aria-label', tr('Close'))
    close.onclick = () => dialog.close()
    header.append(heading,close); dialog.append(header); document.body.append(dialog)
    dialog.addEventListener('keydown', event => event.stopPropagation())
    return dialog
}
export type SaveLocation = 'device' | 'cloud' | 'file'
type SaveChoice = {name:string; location:'device'} | {name:string; location:'cloud'; account:string} | {name:string; location:'file'; destination:FileDestination}

export function chooseProjectLocation(suggestion:string, copy:boolean, preferred:SaveLocation|undefined,
    account:Promise<LibraryStatus>, previousFile?:FileSystemFileHandle):Promise<SaveChoice|undefined> {
    const dialog = modal(copy ? 'Save as copy' : 'Save project')
    const form = el('form'), label = el('label',tr('Project name')), input = el('input')
    input.name='projectName';input.required=true;input.maxLength=120;input.value=suggestion
    label.append(input)
    const target=el('label',tr('Save location')), select=el('select')
    const options = [['device','Device library'],['cloud','Your account'],['file','Choose a file on this computer…']] as const
    for (const [id,text] of options) select.add(new Option(tr(text),id))
    const cloudOption=select.options[1]
    cloudOption.disabled=true; select.value=preferred==='file'?'file':'device'
    target.append(select)
    const detail=el('small'),submit=el('button',tr('Save'));submit.className='ft-project-primary'
    form.append(label,target,detail,submit);dialog.append(form)
    let accountId:string|undefined, touched=false
    select.onchange=()=>{touched=true}
    void account.then(status=>{
        if (!dialog.open) return
        if (status.kind==='online') {
            accountId=status.library.accountId;cloudOption.disabled=false
            if (!touched && (!preferred || preferred==='cloud')) select.value='cloud'
        } else detail.textContent=tr(status.kind==='guest'?'Sign in to sync projects':'Cloud unavailable · Device projects are available.')
    })
    return new Promise(resolve=>{
        let chosen:SaveChoice|undefined
        form.onsubmit=async event=>{
            event.preventDefault()
            const name=input.value.trim()
            if (!name || submit.disabled) return
            if (select.value==='file') {
                submit.disabled=true
                try {
                    const destination=await chooseFileDestination(name+'.flowtu',{
                        id:'flowtu-project',...(previousFile ? {startIn:previousFile} : {}),
                        types:[{description:'Flowtu Studio',accept:{'application/octet-stream':['.flowtu']}}]
                    })
                    if (destination && dialog.open) chosen={name,location:'file',destination}
                } catch(error) {
                    detail.textContent=error instanceof Error?error.message:String(error)
                    return
                } finally {submit.disabled=false}
            } else if (select.value==='cloud') {
                if (!accountId) return
                chosen={name,location:'cloud',account:accountId}
            } else chosen={name,location:'device'}
            if (dialog.open) dialog.close()
        }
        dialog.onclose=()=>{dialog.remove();resolve(chosen)}
        dialog.showModal();input.focus();input.select()
    })
}
export function chooseConflictCopy(savedOnDevice: boolean): Promise<boolean> {
    const dialog = modal('Project revision conflict')
    const detail = el('p', tr(savedOnDevice ?
        'Your edits are saved in Device drafts. A newer version is in your account.' :
        'Another tab saved this project first. Your edits are still open in this tab.'))
    const footer = el('footer'), keep = el('button', tr('Keep editing')), copy = el('button',tr('Save as copy'))
    keep.onclick = () => dialog.close()
    copy.onclick = () => dialog.close('copy')
    footer.append(keep,copy); dialog.append(detail,footer)
    return new Promise(resolve => {
        dialog.onclose = () => {dialog.remove(); resolve(dialog.returnValue === 'copy')}
        dialog.showModal(); copy.focus()
    })
}
export function confirmCloudDelete(name: string): Promise<boolean> {
    const dialog = modal('Delete cloud project')
    const detail = el('p', tr('Delete this project from your account? The device copy is removed too. This cannot be undone.') + ' “' + name + '”')
    const footer = el('footer'), keep = el('button', tr('Keep project')), remove = el('button', tr('Delete'))
    keep.onclick = () => dialog.close()
    remove.onclick = () => dialog.close('delete')
    footer.append(keep,remove); dialog.append(detail,footer)
    return new Promise(resolve => {
        dialog.onclose = () => {dialog.remove(); resolve(dialog.returnValue === 'delete')}
        dialog.showModal(); keep.focus()
    })
}
// First successful cloud generation in a batch: name the project before it is linked to the songs.
export function requestGenerationProjectName(suggestion: string): Promise<string | undefined> {
    const dialog = modal('Name this project')
    const form = el('form'), label = el('label', tr('Project name')), input = el('input')
    input.name = 'projectName'; input.required = true; input.maxLength = 120
    input.value = suggestion.trim().slice(0, 120)
    label.append(input)
    const detail = el('small', tr('Saving to your account links the generated songs to this project.'))
    const submit = el('button', tr('Save')); submit.className = 'ft-project-primary'
    form.append(label, detail, submit); dialog.append(form)
    return new Promise(resolve => {
        let name: string | undefined
        form.onsubmit = event => {
            event.preventDefault()
            const value = input.value.trim()
            if (!value) return
            name = value; dialog.close()
        }
        dialog.onclose = () => {dialog.remove(); resolve(name)}
        dialog.showModal(); input.focus(); input.select()
    })
}
type SavedChoice = Exclude<LibraryChoice,{kind:'import'}>
function recentKey(choice: SavedChoice) {
    if (choice.kind === 'legacy') return 'flowtu.project.opened.legacy.' + choice.item.uuid
    const owner = choice.kind === 'local' ? choice.entry.owner : choice.owner
    const id = choice.kind === 'local' ? choice.entry.id : choice.remote.id
    return 'flowtu.project.opened.' + owner + '.' + id
}
export function rememberOpenedProject(choice: SavedChoice) {
    try {localStorage.setItem(recentKey(choice),String(Date.now()))} catch { /* Optional browser preference. */ }
}
export function createSavedProjectList(select: (choice:LibraryChoice)=>void, sortByRecent = false) {
    function projectButton(entry: {name: string; updatedAt: string; size?: number}, label: string, choice: SavedChoice,
        onDelete?: (name: string) => Promise<void>) {
        const button = el('button')
        button.type = 'button'; button.className = 'ft-project-item'
        const detail = [label, new Date(entry.updatedAt).toLocaleString()]
        if (entry.size !== undefined) detail.push((entry.size / 1048576).toFixed(1) + ' MB')
        button.append(el('strong', entry.name), el('small', detail.join(' · ')))
        let recent = Date.parse(entry.updatedAt) || 0
        if (sortByRecent) {
            try {recent = Math.max(recent, Number(localStorage.getItem(recentKey(choice))) || 0)} catch { /* Keep last save order. */ }
        }
        button.onclick = () => select(choice)
        if (!onDelete) {button.dataset.recent = String(recent); return button}
        // A sibling wrapper keeps the delete control out of the opening button (no nested interactives).
        const row = el('div'); row.className = 'ft-project-row'
        row.dataset.recent = String(recent)
        const remove = el('button', tr('Delete'))
        remove.type = 'button'; remove.className = 'ft-project-delete'
        remove.setAttribute('aria-label', tr('Delete') + ' ' + entry.name)
        remove.onclick = () => {void onDelete(entry.name)}
        row.append(button, remove)
        return row
    }
    const removeCloud = async (owner: string, remote: CloudProject) => {
        if (!await confirmCloudDelete(remote.name)) return
        status.textContent = tr('Deleting project…'); refresh.disabled = true
        try {
            await deleteCloudProject(owner, remote.id, remote.revision)
            // The cloud copy is authoritative. A leftover cache entry is harmless and removed best-effort.
            await removeDeviceProject(owner, remote.id).catch(() => undefined)
            status.textContent = tr('Project deleted.')
            await render()
        } catch (error) {
            status.textContent = tr('Delete failed') + ' · ' + (error instanceof Error ? error.message : String(error))
            refresh.disabled = false
        }
    }
    const element = el('section'); element.className='ft-saved-projects'
    const listing = el('div'); listing.className = 'ft-project-list'
    const status = el('p'); status.setAttribute('role','status')
    const login = el('a', tr('Sign in to sync projects'))
    login.href = '/signin-with-chatgpt?return_to=' + encodeURIComponent(location.pathname + location.search + location.hash)
    login.target = '_top'; login.hidden = true
    const footer = el('footer'), refresh = el('button', tr('Refresh')), importButton = el('button', tr('Import project file…'))
    footer.append(login, refresh, importButton); element.append(status, listing, footer)
    const section = (title: string, rows: HTMLElement[]) => {
        if (rows.length) {
            if (!sortByRecent) listing.append(el('h3',tr(title)))
            listing.append(...rows)
        }
    }
    const sorted = <T extends {updatedAt: string}>(items: T[]) => items.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))
    let requestId = 0
    const render = async () => {
        const id = ++requestId
        listing.replaceChildren(); login.hidden = true
        refresh.disabled = true; status.textContent = tr('Loading projects…')
        try {
            const [local, cloud, legacy] = await Promise.all([listDeviceProjects(guestOwner), cloudLibrary(),
                ProjectStorage.listProjects({includeCover:false, includeProject:false}).catch(() => [])])
            if (id !== requestId || !element.isConnected) return
            if (cloud.kind === 'online') {
                const owner = accountOwner(cloud.library.accountId), cached = await listDeviceProjects(owner)
                if (id !== requestId || !element.isConnected) return
                const entries = new Map(cached.map(entry => [entry.id,entry]))
                const rows = sorted(cloud.library.projects).map(remote => {
                    const entry = entries.get(remote.id)
                    const drop = () => removeCloud(owner, remote)
                    if (entry && !entry.pending && entry.revision === remote.revision) {
                        entries.delete(remote.id)
                        return projectButton(remote,tr('Synced'), {kind:'local', entry}, drop)
                    }
                    if (entry && !entry.pending) entries.delete(remote.id)
                    // A divergent device draft remains independently available.
                    return projectButton(remote,tr('Cloud version'), {kind:'cloud', owner, remote, cached:entry}, drop)
                })
                section('Your account', rows)
                section('Device drafts', sorted([...entries.values()]).map(entry =>
                    projectButton(entry,tr('On this device'), {kind:'local', entry})))
            }
            section('On this device', sorted(local).map(entry =>
                projectButton(entry,tr('Local project'), {kind:'local',entry})))
            section('Earlier projects on this device', legacy.map(item => projectButton({
                name: item.meta.name, updatedAt: item.meta.modified
            }, tr('Local project'), {kind:'legacy', item})))
            if (sortByRecent) listing.append(...Array.from(listing.children as HTMLCollectionOf<HTMLElement>)
                .sort((a,b) => Number(b.dataset.recent) - Number(a.dataset.recent)))
            login.hidden = cloud.kind !== 'guest'
            status.textContent = cloud.kind === 'offline' ? tr('Cloud unavailable · Device projects are available.') :
                listing.children.length ? '' : tr('No saved projects yet.')
        } catch (error) {if (id === requestId) status.textContent = String(error)}
        finally {if (id === requestId) refresh.disabled = false}
    }
    refresh.onclick = () => {void render()}
    importButton.onclick = () => select({kind:'import'})
    return {element, render}
}
export function chooseSavedProject(): Promise<LibraryChoice | undefined> {
    const dialog = modal('Open project')
    let choice: LibraryChoice | undefined
    const list = createSavedProjectList(item => {choice = item; dialog.close()})
    dialog.append(list.element)
    return new Promise(resolve => {
        dialog.onclose = () => {dialog.remove(); resolve(choice)}
        dialog.showModal(); void list.render()
    })
}
