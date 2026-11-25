export type CloudProject = {id: string; name: string; revision: string; updatedAt: string; size: number}
export type ProjectEntry = Omit<CloudProject, 'revision'> & {
    owner: string; version: string; revision?: string; pending: boolean
}
export type CloudLibrary = {accountId: string; projects: CloudProject[]}
export type LibraryStatus = {kind: 'online'; library: CloudLibrary} | {kind: 'guest' | 'offline'}

type LocalRecord = {entry: ProjectEntry; blob: Blob}
const dbName = 'flowtu.project-library.v1'
const entries = 'projects', contents = 'archives'
export const guestOwner = 'device'
export const accountOwner = (id: string) => 'account:' + id
export class ProjectConflict extends Error {
    constructor() {super('A newer project revision exists.')}
}
const conflict = () => new ProjectConflict()
let database: Promise<IDBDatabase> | undefined
function db(): Promise<IDBDatabase> {
    if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1)
        request.onupgradeneeded = () => {
            const store = request.result.createObjectStore(entries, {keyPath: ['owner', 'id']})
            store.createIndex('owner', 'owner')
            request.result.createObjectStore(contents)
        }
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
            const result = request.result
            result.onversionchange = () => {result.close(); database = undefined}
            resolve(result)
        }
    }).catch(error => {database = undefined; throw error})
    return database
}
function read<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}
export async function listDeviceProjects(owner: string): Promise<ProjectEntry[]> {
    const tx = (await db()).transaction(entries)
    return read(tx.objectStore(entries).index('owner').getAll(owner))
}
export async function readDeviceProject(owner: string, id: string): Promise<LocalRecord> {
    const tx = (await db()).transaction([entries, contents])
    const key = [owner, id]
    const [entry, blob] = await Promise.all([read<ProjectEntry>(tx.objectStore(entries).get(key)), read<Blob>(tx.objectStore(contents).get(key))])
    if (!entry || !blob) throw new Error('This project is no longer available on this device.')
    return {entry, blob}
}
// Both metadata and media commit together. A stale editor cannot replace a newer tab's save.
async function write(entry: ProjectEntry, version: string | undefined, blob?: Blob): Promise<void> {
    const tx = (await db()).transaction(blob ? [entries, contents] : entries, 'readwrite')
    return new Promise((resolve, reject) => {
        let reason: Error | undefined
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(reason ?? tx.error ?? new Error('Project storage unavailable.'))
        const store = tx.objectStore(entries), key = [entry.owner, entry.id]
        const request = store.get(key)
        request.onsuccess = () => {
            const current = request.result as ProjectEntry | undefined
            if (current?.version !== version) {reason = conflict(); tx.abort(); return}
            store.put(entry)
            if (blob) tx.objectStore(contents).put(blob, key)
        }
    })
}
export async function saveDeviceProject(owner: string, name: string, blob: Blob, base?: ProjectEntry): Promise<ProjectEntry> {
    const entry = {owner, id: base?.id ?? crypto.randomUUID(), name, size: blob.size, updatedAt: new Date().toISOString(),
        version: crypto.randomUUID(), revision: base?.revision, pending: true}
    await write(entry, base?.version, blob)
    return entry
}
export async function cacheCloudProject(owner: string, remote: CloudProject, blob: Blob, previous?: ProjectEntry): Promise<ProjectEntry> {
    const entry = {...remote, owner, pending: false, version: crypto.randomUUID()}
    await write(entry, previous?.version, blob)
    return entry
}
export async function cloudLibrary(): Promise<LibraryStatus> {
    try {
        const response = await fetch('/api/projects', {credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(12000)})
        if (response.status === 401) return {kind: 'guest'}
        if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
            const library = await response.json() as CloudLibrary
            if (typeof library.accountId === 'string' && library.accountId && Array.isArray(library.projects)) return {kind: 'online', library}
        }
    } catch { /* The device library is independent of the network. */ }
    return {kind: 'offline'}
}
const projectUrl = (id: string) => '/api/projects/' + encodeURIComponent(id)
async function requireSuccess(response: Response) {
    if (response.ok) return
    if (response.status === 412) throw conflict()
    if (response.status === 409) {
        const detail = await response.json().catch(() => ({}))
        throw new Error(detail.error || 'The cloud project could not be committed.')
    }
    if (response.status === 401) throw new Error('Sign in again to sync this project.')
    throw new Error('Cloud storage returned HTTP ' + response.status + '.')
}
export async function readCloudProject(owner: string, remote: CloudProject) {
    const response = await fetch(projectUrl(remote.id), {credentials: 'same-origin', cache: 'no-store', headers: {'X-Project-Account': owner.slice('account:'.length), 'If-Match': '"' + remote.revision + '"'}})
    await requireSuccess(response)
    const revision = response.headers.get('ETag')?.replace(/^"|"$/g, '')
    if (revision !== remote.revision) throw conflict()
    const blob = await response.blob()
    if (blob.size !== remote.size) throw new Error('The cloud download was incomplete. Open the project again.')
    return blob
}
export async function syncProject(entry: ProjectEntry, blob: Blob): Promise<ProjectEntry> {
    const headers: Record<string,string> = {'X-Project-Name': encodeURIComponent(entry.name), 'Content-Type': 'application/octet-stream'}
    if (entry.revision) headers['If-Match'] = '"' + entry.revision + '"'
    else headers['If-None-Match'] = '*'
    // The server checks the authenticated account again at publication time.
    headers['X-Project-Account'] = entry.owner.slice('account:'.length)
    const url = projectUrl(entry.id)
    let body: Blob | undefined = blob
    if (blob.size > 16 * 1024 * 1024) {
        const upload = crypto.randomUUID(), partSize = 12 * 1024 * 1024, count = Math.ceil(blob.size / partSize)
        for (let i = 0; i < count; i++) {
            const response = await fetch(url + '/uploads/' + upload + '/' + i, {
                method: 'PUT', credentials: 'same-origin', headers: {'X-Project-Account': headers['X-Project-Account']},
                body: blob.slice(i * partSize, (i + 1) * partSize)
            })
            await requireSuccess(response)
        }
        Object.assign(headers, {'X-Project-Upload': upload, 'X-Project-Parts': String(count), 'X-Project-Size': String(blob.size)})
        body = undefined
    }
    const response = await fetch(url, {method: 'PUT', credentials: 'same-origin', headers, body})
    await requireSuccess(response)
    const remote = await response.json() as CloudProject
    if (remote.id !== entry.id || !remote.revision) throw new Error('The cloud did not confirm this save.')
    const saved = {...entry, revision: remote.revision, pending: false}
    await write(saved, entry.version)
    return saved
}
