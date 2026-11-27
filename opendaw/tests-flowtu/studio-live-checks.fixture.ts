// Opt-in live dev checks. Run only on a blank http://localhost:5199/@vite/client tab
// whose same-origin login has explicitly been authorized for dev Studio requests.
import JSZip from 'jszip'
import {Project, ProjectBundle, ProjectMeta, ProjectProfile} from '@opendaw/studio-core'
import {ProjectSkeleton} from '@opendaw/studio-adapters'
import {Option, Progress, UUID, Terminable} from '@opendaw/lib-std'
import {encodeProjectArchive, decodeProjectArchive} from '../src/flowtu/project-archive'
import {cloudLibrary, accountOwner, saveDeviceProject, readDeviceProject, syncProject, readCloudProject, deleteCloudProject, removeDeviceProject, type ProjectEntry} from '../src/flowtu/project-library'
import {fetchStudioModels, submitGeneration, fetchGeneration, listProjectGenerations, forgetGeneration} from '../src/flowtu/studio-generations'
import {studioAuthHeaders} from '../src/flowtu/studio-auth'

let entry: ProjectEntry | undefined, blob: Blob, generationKey: string | undefined, clientRequestId: string | undefined
let generationAttempted = false
let restoreFetch: (() => void) | undefined
const requests: {method: string; path: string; status: number}[] = []
const check = (value: unknown, message: string) => {if (!value) throw new Error(message)}
export function connectDevProxy() {
    check(location.origin === 'http://localhost:5199' && location.pathname === '/@vite/client', 'Use a blank authorized login-origin tab')
    if (restoreFetch) return
    const original = globalThis.fetch.bind(globalThis)
    globalThis.fetch = async (input, init) => {
        const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (!path.startsWith('/api/e/')) return original(input, init)
        const response = await original('http://127.0.0.1:4173' + path, init)
        requests.push({method: init?.method ?? 'GET', path, status: response.status})
        return response
    }
    restoreFetch = () => {globalThis.fetch = original}
}
export async function prepareLiveProject() {
    connectDevProxy()
    const models = await fetchStudioModels(), library = await cloudLibrary()
    check(library.kind === 'online', 'Dev login must resolve an account')
    if (library.kind !== 'online') throw new Error('No dev account')
    const env = {audioContext:{currentTime:0,sampleRate:48000,createGain:()=>({connect(){},disconnect(){},gain:{value:1}}),createStereoPanner:()=>({connect(){},disconnect(){},pan:{value:0}})},
        sampleManager:{getOrCreate:(uuid:unknown)=>({uuid,data:Option.None,peaks:Option.None,state:{type:'idle'},subscribe:()=>Terminable.Empty})}} as never
    const project = Project.fromSkeleton(env, ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}))
    const profile = new ProjectProfile(UUID.generate(), project, ProjectMeta.init('Studio integration smoke'), Option.None)
    const odb = await ProjectBundle.encode(profile, Progress.Empty)
    blob = await encodeProjectArchive(odb, 0, {display:'time',fps:'25'}, [])
    const restored = await decodeProjectArchive(blob)
    const reopened = await ProjectBundle.decode(env, restored.odb)
    reopened.project.terminate(); project.terminate()
    const local = await saveDeviceProject(accountOwner(library.library.accountId), '[联调临时] Studio protocol ' + new Date().toISOString(), blob)
    entry = local // Keep cleanup possible even when publication fails.
    entry = await syncProject(local, blob)
    const initial = entry
    const downloaded = await readCloudProject(entry.owner, {...entry, revision: entry.revision!})
    const actual=new Uint8Array(await downloaded.arrayBuffer()), expected=new Uint8Array(await blob.arrayBuffer())
    check(actual.length===expected.length && actual.every((byte,index)=>byte===expected[index]), 'Downloaded bytes differ from uploaded ZIP')
    const changed = await saveDeviceProject(entry.owner, entry.name + ' updated', blob, entry)
    entry = await syncProject(changed, blob)
    check(entry.revision !== initial.revision, 'Updating must advance revision')
    const stale = await fetch('/api/e/studio/projects/' + entry.id, {method: 'PUT', credentials: 'same-origin',
        headers: studioAuthHeaders({'Content-Type':'application/octet-stream', 'X-Project-Account':library.library.accountId, 'If-Match':'"' + initial.revision + '"'}), body:blob})
    check(stale.status === 412, 'Stale revision must return 412')
    return {projectId:entry.id, models, checks: requests.slice(), zipBytes:blob.size}
}
export async function startLiveGeneration() {
    check(!!entry?.revision && !generationAttempted, 'Prepare a project; submit at most one paid request')
    generationAttempted = true
    const models = await fetchStudioModels()
    const model = models.find(item => item.model === 'mureka-9.5')!
    const result = await submitGeneration({prompt:'温柔的钢琴独奏，缓慢，温暖', contentType:'instrumental', model:model.model,
        count:1, inSec:0, outSec:10, projectId:entry!.id}, model, {context:{accountId:entry!.owner.slice('account:'.length), projectScope:entry!.id}})
    generationKey = result.generationKey; clientRequestId = result.clientRequestId
    return result
}
export async function inspectLiveGeneration() {
    check(!!generationKey, 'No generation submitted')
    const result = await fetchGeneration(generationKey!)
    if (result.status !== 'running' && clientRequestId) forgetGeneration(clientRequestId)
    return result
}
export async function checkLiveHistoryAndAudio() {
    const state = await inspectLiveGeneration()
    check(state.status === 'succeeded', 'Generation must succeed before media checks')
    const history = await listProjectGenerations(entry!.id)
    check(history.some(item => item.generationKey === generationKey && item.input?.prompt), 'History must contain generation and input snapshot')
    const song = state.songs?.find(song => song.playUrl)!
    check(!!song, 'No playable song')
    const response = await fetch(song.playUrl!, {headers:studioAuthHeaders(), credentials:'same-origin'})
    const audio = await response.blob()
    check(response.ok && audio.size > 0 && audio.type.startsWith('audio/'), 'Audio fetch must return nonempty audio')
    const player = document.createElement('audio'); player.preload='metadata'
    const url = URL.createObjectURL(audio); player.src=url
    const duration = await new Promise<number>((resolve,reject) => {
        const timer=setTimeout(()=>reject(new Error('Audio metadata timeout')),10000)
        player.onloadedmetadata=()=>{clearTimeout(timer);resolve(player.duration)}
        player.onerror=()=>{clearTimeout(timer);reject(new Error('Browser audio decode failed'))}
    }).finally(()=>{player.removeAttribute('src');player.load();URL.revokeObjectURL(url)})
    return {generationKey, historyCount:history.length, snapshotProjectId:history.find(item=>item.generationKey===generationKey)?.input?.projectId,
        audio:{bytes:audio.size,type:audio.type,durationSeconds:duration}, requests:requests.slice()}
}
export async function checkLiveChunks() {
    check(!!entry, 'Prepare a project')
    const zip=await JSZip.loadAsync(await blob.arrayBuffer());zip.file('integration-padding.bin',new Uint8Array(17*1024*1024))
    const large=await zip.generateAsync({type:'blob',compression:'STORE'})
    const draft=await saveDeviceProject(entry!.owner,entry!.name,large,entry)
    entry=draft;entry=await syncProject(draft,large)
    const download=await readCloudProject(entry.owner,{...entry,revision:entry.revision!})
    check(download.size===large.size,'Chunk download size mismatch')
    return {bytes:large.size,parts:requests.filter(item=>item.path.includes('/uploads/')),revision:entry.revision}
}
export async function checkLiveGuards(projectId?: string) {
    if (!entry && projectId) {
        const library=await cloudLibrary()
        if (library.kind!=='online') throw new Error('No dev account')
        const saved=await readDeviceProject(accountOwner(library.library.accountId),projectId)
        check(saved.entry.name.startsWith('[联调临时] Studio protocol '), 'Only fixture projects may be used')
        entry=saved.entry;blob=saved.blob
    }
    check(!!entry?.revision, 'Prepare a project')
    const owner=entry!.owner.slice('account:'.length), path='/api/e/studio/projects/'+entry!.id
    const stale='"studio-integration-stale"'
    const guest=await fetch('/api/e/studio/projects',{credentials:'omit'})
    check(guest.status===401,'Unauthenticated list must return 401')
    const download=await fetch(path,{headers:studioAuthHeaders({'X-Project-Account':owner,'If-Match':stale})})
    check(download.status===412,'Stale download must return 412')
    const deletion=await fetch(path,{method:'DELETE',headers:studioAuthHeaders({'X-Project-Account':owner,'If-Match':stale})})
    check(deletion.status===412,'Stale deletion must return 412')
    const mismatch=await fetch(path,{method:'PUT',headers:studioAuthHeaders({'X-Project-Account':'studio-integration-wrong-account','If-Match':'"'+entry!.revision+'"','Content-Type':'application/octet-stream'}),body:blob})
    check(mismatch.status===409,'Wrong account guard must return 409')
    const uploadId=crypto.randomUUID(), half=Math.ceil(blob.size/2)
    const part=await fetch(path+'/uploads/'+uploadId+'/0',{method:'PUT',headers:studioAuthHeaders({'X-Project-Account':owner}),body:blob.slice(0,half)})
    check(part.status===204,'First chunk must return 204')
    const incomplete=await fetch(path,{method:'PUT',headers:studioAuthHeaders({'X-Project-Account':owner,'If-Match':'"'+entry!.revision+'"','X-Project-Upload':uploadId,'X-Project-Parts':'2','X-Project-Size':String(blob.size)})})
    check(incomplete.status===409,'Missing chunk finalization must return 409')
    const library=await cloudLibrary()
    check(library.kind==='online'&&library.library.projects.some(p=>p.id===entry!.id&&p.revision===entry!.revision),'Guard failures must preserve current project')
    return {guest:guest.status,staleDownload:download.status,staleDelete:deletion.status,accountMismatch:mismatch.status,missingPart:incomplete.status}
}
export async function cleanupLiveProject() {
    if (!entry) return {deleted:false}
    await deleteCloudProject(entry.owner,entry.id,entry.revision)
    await deleteCloudProject(entry.owner,entry.id,entry.revision)
    await removeDeviceProject(entry.owner,entry.id)
    const library=await cloudLibrary()
    check(library.kind==='online'&&!library.library.projects.some(p=>p.id===entry!.id),'Deleted project still listed')
    const result={deleted:true,projectId:entry.id,requests:requests.slice()}
    entry=undefined;restoreFetch?.();restoreFetch=undefined
    return result
}
