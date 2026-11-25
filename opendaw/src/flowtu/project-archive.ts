import JSZip from 'jszip'
import type {TimeSettings} from './time-settings'

type VideoAsset = {id: string; file: File}
type VideoInfo = {id: string; name: string; type: string; lastModified: number}
export type SavedProjectTitle = {name:string; modified:string}
type ProjectManifest = {title?:SavedProjectTitle; version: number; offset: number; timeSettings: Partial<TimeSettings>; videoName?: string; videoType?: string;
    activeVideoId?: string; videos?: VideoInfo[]}

export async function encodeProjectArchive(odb: ArrayBufferLike, offset: number, timeSettings: TimeSettings,
    assets: readonly VideoAsset[], activeId?: string, activeFile?: File, title?: SavedProjectTitle): Promise<Blob> {
    const zip = new JSZip()
    zip.file('project.odb', new Uint8Array(odb))
    const videos = assets.slice()
    if (activeFile && !videos.some(item => item.id === activeId && item.file === activeFile)) {
        const match = videos.find(item => item.file === activeFile)
        activeId = match?.id ?? crypto.randomUUID()
        if (!match) videos.push({id: activeId, file: activeFile})
    }
    const meta: ProjectManifest = {version: 2, title, offset, timeSettings, activeVideoId: activeFile ? activeId : undefined,
        videos: videos.map(({id,file}) => ({id, name: file.name, type: file.type, lastModified: file.lastModified}))}
    zip.file('flowtu.json', JSON.stringify(meta))
    for (const [index,{file}] of videos.entries()) zip.file('media/video-' + index, file)
    return zip.generateAsync({type: 'blob', compression: 'STORE'})
}
export async function decodeProjectArchive(file: Blob, native = false) {
    let title:SavedProjectTitle|undefined
    let odb = await file.arrayBuffer(), nextVideo: File | undefined, offset = 0
    let timeSettings: Partial<TimeSettings> = {display: 'time', fps: '25'}
    const videos = new Map<string,File>()
    if (!native) {
        const zip = await JSZip.loadAsync(odb)
        const project = zip.file('project.odb'), manifest = zip.file('flowtu.json')
        if (!project || !manifest) throw new Error('Choose a .flowtu, .flowtu.zip or .odb project.')
        const meta = JSON.parse(await manifest.async('string')) as ProjectManifest
        if (typeof meta.title?.name==='string' && meta.title.name && typeof meta.title.modified==='string' && Number.isFinite(Date.parse(meta.title.modified))) title=meta.title
        if (meta.version !== 1 && meta.version !== 2) throw new Error('Unsupported project version.')
        odb = await project.async('arraybuffer')
        if (Number.isFinite(meta.offset)) offset = meta.offset
        if (meta.timeSettings) timeSettings = {...timeSettings,...meta.timeSettings}
        if (meta.version === 1) {
            const clip = zip.file('reference-video')
            if (clip) nextVideo = new File([await clip.async('blob')], meta.videoName || 'Reference.mp4', {type: meta.videoType || 'video/mp4'})
        } else {
            for (const [index,info] of (meta.videos ?? []).entries()) {
                const asset = zip.file('media/video-' + index)
                if (!asset || !info.id || videos.has(info.id)) throw new Error('The project is missing a video asset.')
                videos.set(info.id, new File([await asset.async('blob')], info.name, {type: info.type, lastModified: info.lastModified}))
            }
            if (meta.activeVideoId) {
                nextVideo = videos.get(meta.activeVideoId)
                if (!nextVideo) throw new Error('The active reference video is missing.')
            }
        }
    }
    return {odb, title, offset, timeSettings, videos, nextVideo}
}
