import {chooseFileDestination, saveCancelled} from './file-destination'
import {currentFilm} from './film-sheets'
import type {StudioService} from '../service/StudioService'
import {analyzeLitePicture, type LitePictureScene} from './lite-scene-detection'
import {buildLitePrompt, pictureGroups, pictureOverlap, type PictureGroup, readPictureReport, storeBackgroundPictureReport, storePictureReport, watchPictureReport, type SceneDescription, type PictureReport, type PictureScene} from './lite-model'
import {describeStudioFrames} from './lite-vision-client'
import {MetaData} from '@opendaw/studio-adapters'
import {readScoring, writeScoring, scoringOrigin, type ScoringCue} from './scoring-model'
import {getSelectedScoringCue, requestScoringCue, subscribeScoringSelection} from './scoring-selection'
import {seekTimeline, timelinePosition} from './timeline-seek'
import {studioLanguage, tr, watchStudioLanguage} from './studio-language'
import type {Project} from '@opendaw/studio-core'

function localDescription(scene: LitePictureScene, index: number): SceneDescription {
    const zh = studioLanguage() === 'zh-CN'
    const dark = scene.brightness < .32, active = scene.motion > .12
    return {
        title: zh ? `场景 ${index + 1}` : `Scene ${index + 1}`,
        observation: zh ? `${dark ? '低亮度' : '明亮度适中或较高'}，${active ? '画面变化较快' : '画面较稳定'}。` :
            `${dark ? 'Low light' : 'Moderate or bright light'} with ${active ? 'more visual movement' : 'limited visual movement'}.`,
        musicPrompt: zh ? `${active ? '用拨弦琶音带出律动' : '用稀疏的钢琴和弦给画面留白'}，${dark ? '控制力度，让低音温暖而克制' : '让旋律轻盈，并为下一段留下空间'}。` :
            `${active ? 'Generate a plucked rhythmic arpeggio' : 'Generate sparse piano chords'}. ${dark ? 'Keep the dynamics warm and restrained.' : 'Leave room for the next scene.'}`
    }
}
function windowOf(scene: LitePictureScene, offset: number) {
    return {start: Math.max(0, offset + scene.start), end: Math.max(0, offset + scene.end)}
}
function matchingCue(cues: ScoringCue[], start: number, end: number, preferred?:string) {
    const matches = cues.map(cue => ({cue, overlap:pictureOverlap(cue,{start,end})})).filter(item=>item.overlap>0)
    return matches.find(item=>item.cue.id===preferred)?.cue ?? matches.sort((a,b) => b.overlap-a.overlap)[0]?.cue
}
type CueExtent = Pick<ScoringCue,'start'|'end'>
function uncovered(start:number,end:number,existing:CueExtent[]) {
    const gaps: Array<{start:number;end:number}> = []
    let cursor=start
    for (const cue of existing) {
        if (cue.end<=cursor) continue
        if (cue.start>=end) break
        if (cue.start>cursor+.02) gaps.push({start:cursor,end:cue.start})
        cursor=Math.max(cursor,cue.end)
    }
    if (cursor+.02<end || (cursor===start && end>start && !existing.some(c=>pictureOverlap(c,{start,end})>0)))
        gaps.push({start:cursor,end})
    return gaps
}
export function applyPictureAnalysis(project: Project, report: PictureReport, maxSceneSeconds:number, initialTiming?:ReadonlyMap<string,CueExtent>, trigger:'manual'|'automatic'='manual') {
    if (report.sheetId && report.sheetId!==currentFilm(project)?.id) return
    const state = readScoring(project), prior=readPictureReport(project)
    // Regenerate only untouched suggestions for this reference. Once the user edits a cue
    // or attaches a take it becomes authored material, independent of later vision passes.
    const fingerprints=prior?.file===report.file && prior.size===report.size && Array.isArray(prior.generatedCues)
        ? new Map(prior.generatedCues.filter(entry=>entry && typeof entry.id==='string' && typeof entry.original==='string').map(entry=>[entry.id,entry.original]))
        : new Map<string,string>()
    const signature=(cue:ScoringCue)=>JSON.stringify([cue.name,cue.start,cue.end,cue.prompt,cue.tone,cue.direction,cue.referenceId,!!cue.autoEnd,...(cue.markdown!==undefined ? [cue.markdown] : []),...(cue.analysisSections ? [cue.analysisSections] : [])])
    const replaceable=state.cues.filter(cue=>!cue.takes?.length && fingerprints.get(cue.id)===signature(cue))
    const replaceIds=new Set(replaceable.map(c=>c.id))
    const existing=state.cues.filter(cue=>!replaceIds.has(cue.id)).sort((a,b)=>a.start-b.start)
    // An edit made while the video was being analyzed may deliberately leave a gap.
    // Reserve its previous span for this analysis run only.
    const coverage:CueExtent[]=[...existing]
    if (initialTiming) {
        const current=new Map(state.cues.map(cue=>[cue.id,cue]))
        for (const [id,previous] of initialTiming) {
            const cue=current.get(id)
            // A cue consumed by a merge has no surviving ID. Its old location is still
            // a deliberate edit if the resulting cue was trimmed or moved before analysis completed.
            if (!cue || (!replaceIds.has(id) && (previous.start!==cue.start || previous.end!==cue.end))) coverage.push(previous)
        }
    }
    coverage.sort((a,b)=>a.start-b.start)
    const cues=[...existing], names=new Set(cues.map(c => c.name?.toLowerCase())), generated:ScoringCue[]=[]
    const beats: PictureScene[][] = []
    for (const scene of report.scenes) {
        const last=beats.at(-1)
        if (last && scene.startsNewBeat===false && scene.boundary!=='duration' && scene.end-last[0].start<=maxSceneSeconds) last.push(scene)
        else beats.push([scene])
    }
    for (const beat of beats) {
        const scene=beat[0], {start}=windowOf(scene,report.offset), {end}=windowOf(beat[beat.length-1],report.offset)
        const active = scene.motion > .12
        const instructions=[...new Set(beat.map(shot=>shot.musicPrompt))]
        const prompt=(instructions.length>1 ? instructions[0]+' '+instructions.at(-1) : instructions[0]).slice(0,500)
        for (const gap of uncovered(start,end,coverage)) {
            let name = scene.title.slice(0,54), serial = 1
            while (names.has(name.toLowerCase())) name = `${scene.title.slice(0,54)} (${++serial})`
            names.add(name.toLowerCase())
            const reuse=replaceable.find(c=>replaceIds.has(c.id) && Math.abs(c.start-gap.start)<.02 && Math.abs(c.end-gap.end)<.02)
            if (reuse) replaceIds.delete(reuse.id)
            const cue:ScoringCue={id: reuse?.id ?? crypto.randomUUID(), name, ...gap, analysisVideoStart:gap.start-report.offset, prompt, markdown:beat.map(shot=>'## '+shot.title+'\n'+shot.observation+'\n\n'+shot.musicPrompt).join('\n\n').slice(0,12000), tone: active ? 'pluck' : 'keys',
                direction: {style: active ? 'cinematic' : 'ambient', melody: active ? 24 : -35, arrangement: -20,
                    emotion: Math.round(48*(scene.brightness-.5)), character: active ? 25 : -25}}
            generated.push(cue);cues.push(cue)
        }
    }
    if (cues.length>1000) throw new Error('The analysis exceeds the Studio limit of 1000 cues including existing edits.')
    const nextReport={...report, generatedCues:generated.map(c=>({id:c.id,original:signature(c)}))}
    const nextCues=cues.sort((a,b)=>a.start-b.start)
    const changesCues=(generated.length>0 || replaceable.length>0) && JSON.stringify(nextCues)!==JSON.stringify(state.cues)
    if (trigger==='automatic' && !changesCues) {
        storeBackgroundPictureReport(project,nextReport)
    } else project.editing.modify(() => {
        if (changesCues) writeScoring(project,{...state,cues:nextCues})
        storePictureReport(project,nextReport)
    },true)
}
const seconds = (n: number) => `${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}.${String(Math.floor(n*100)%100).padStart(2,'0')}`

export function installLiteAnalysis(service: StudioService, host: HTMLElement, picture: () => {file?:File; offset:number}) {
    const root = document.createElement('section')
    root.className = 'ft-lite-analysis'
    root.innerHTML = `<header><h3 data-i18n>Scene analysis</h3><output aria-live="polite"></output><button hidden class="ft-use-local" data-i18n>Use local frames</button><button class="ft-analyze" data-i18n>Analyze picture</button></header>
        <div class="ft-lite-scenes"></div><p class="ft-lite-observation"></p>
        <details><summary data-i18n>Model prompt</summary><pre></pre><button data-i18n>Download JSON</button></details>`
    host.append(root)
    const rows = root.querySelector<HTMLElement>('.ft-lite-scenes')!, info = root.querySelector('output')!
    const observation = root.querySelector('p')!, details = root.querySelector('details')!, pre = root.querySelector('pre')!
    const button = root.querySelector<HTMLButtonElement>('.ft-analyze')!
    const useLocal=root.querySelector<HTMLButtonElement>('.ft-use-local')!
    let job: AbortController | undefined, report: PictureReport | undefined, index = 0, error = '', progress = -1
    let provisional: {report:PictureReport; limit:number; project:Project; initialTiming:ReadonlyMap<string,CueExtent>} | undefined
    let releaseProject: (()=>void) | undefined, pickedFrame=false
    let groups:PictureGroup[]=[]
    function currentCue() {
        const group=groups[index]
        if (!service.hasProfile || !group) return
        const cues=readScoring(service.project).cues
        if (group.cueId) return cues.find(c=>c.id===group.cueId)
        const {start,end} = windowOf(group.shots[0],picture().offset)
        return matchingCue(cues,start,end,getSelectedScoringCue(service.project))
    }
    function json() {
        if (!report || !service.hasProfile) return ''
        const scene = groups[index]?.shots[0]
        if (!scene) return ''
        const range = currentCue() ?? {...windowOf(scene,picture().offset),prompt:scene.musicPrompt}
        return JSON.stringify(buildLitePrompt(service.project,range,{...report, offset:picture().offset}),null,2)
    }
    function selected() {
        const group=groups[index]
        Array.from(rows.children).forEach((row,i) => row.setAttribute('aria-pressed',String(i===index)))
        observation.textContent = group?.shots.map(scene=>[scene.observation,scene.mood].filter(Boolean).join(' · ')).join('\n') ?? ''
        observation.style.whiteSpace='pre-line'
        observation.hidden = !group; details.hidden = !group
        if (details.open) pre.textContent = json()
    }
    function label() {
        button.disabled = !picture().file || !!job
        useLocal.hidden=!provisional
        info.textContent = provisional ? tr('Reading scene content…') : progress >= 0 ? `${tr('Analyzing picture…')} ${Math.round(progress*100)}%` :
            [error,report?.model ?? (!picture().file ? tr('Reference video analysis is available after import.') : '')].filter(Boolean).join(' · ')
    }
    function paint() {
        rows.replaceChildren()
        const old=groups[index]
        groups=report ? pictureGroups(report,service.hasProfile ? readScoring(service.project).cues : []) : []
        const selectedId=service.hasProfile ? getSelectedScoringCue(service.project) : undefined
        const same=groups.findIndex(group=>selectedId ? group.cueId===selectedId : old && group.shots.includes(old.shots[0]))
        index=same>=0 ? same : Math.min(index,Math.max(0,groups.length-1))
        for (const [i,group] of groups.entries()) {
            const scene=group.shots[0]
            const item = document.createElement('button'), image = document.createElement('img'), name = document.createElement('strong'), time = document.createElement('small')
            item.type = 'button'; image.loading = 'lazy'; image.alt = ''; image.src = scene.thumbnail
            time.textContent = seconds(Math.max(0,group.start)); name.textContent = group.title; item.append(image,time,name)
            item.onclick = () => {
                if (!service.hasProfile) return
                index = i
                const cue = currentCue()
                if (cue) requestScoringCue(service.project,cue.id)
                seekTimeline(service.project,Math.round(service.project.tempoMap.secondsToPPQN(Math.max(0,picture().offset+group.start))))
                index = i; pickedFrame=true; selected()
            }
            rows.append(item)
        }
        label(); selected()
    }
    const cancel = () => {job?.abort(); job = undefined; progress = -1; provisional=undefined}
    function acceptLocal() {
        const draft=provisional
        if (!draft || !service.hasProfile || service.project!==draft.project) return
        if (draft.report.sheetId && draft.report.sheetId!==currentFilm(draft.project)?.id) {cancel();return}
        cancel();applyPictureAnalysis(draft.project,draft.report,draft.limit,draft.initialTiming);report=draft.report;paint()
    }
    useLocal.onclick=acceptLocal
    function restored() {
        cancel(); error = ''; index = 0; pickedFrame=false
        const {file} = picture(), stored = file && service.hasProfile ? readPictureReport(service.project) : undefined
        report = stored && stored.file===file?.name && stored.size===file.size ? stored : undefined
        paint()
    }
    async function analyze(trigger:'manual'|'automatic'='manual') {
        const {file} = picture()
        if (!file || !service.hasProfile) return
        cancel()
        const project = service.project, sheetId=currentFilm(project)?.id, controller = new AbortController()
        const initialTiming=new Map<string,CueExtent>()
        const rememberBounds=()=>{
            if (currentFilm(project)?.id!==sheetId) return
            for (const cue of readScoring(project).cues) {
                if (!initialTiming.has(cue.id)) initialTiming.set(cue.id,{start:cue.start,end:cue.end})
            }
        }
        rememberBounds()
        const watcher=project.editing.subscribe(rememberBounds)
        controller.signal.addEventListener('abort',()=>watcher.terminate(),{once:true})
        job = controller; progress = 0; error = ''; label()
        try {
            const maxSceneSeconds=Math.min(50,31*240/project.timelineBox.bpm.getValue())
            const measured = await analyzeLitePicture(file,{signal:controller.signal, maxSceneSeconds,
                onProgress(value) {progress = .75*value; label()}})
            controller.signal.throwIfAborted()
            if (service.project!==project || currentFilm(project)?.id!==sheetId || picture().file!==file) return
            const localModel = studioLanguage()==='zh-CN' ? '本地画面特征' : 'Local picture features'
            const localReport = {version:1 as const,sheetId,file:file.name,size:file.size,offset:picture().offset,duration:measured.duration,
                model:localModel,scenes:measured.scenes.map((s,i)=>({...s,...localDescription(s,i)}))}
            provisional={report:localReport,project,limit:maxSceneSeconds,initialTiming}
            report=localReport;index=0;pickedFrame=false;paint()
            let descriptions: SceneDescription[] | undefined, model = studioLanguage()==='zh-CN' ? '本地画面特征' : 'Local picture features'
            try {
                if (window.flowtuScoringModel?.describeScenes) {
                    descriptions = await window.flowtuScoringModel.describeScenes({file:file.name,...measured},{signal:controller.signal})
                    model = window.flowtuScoringModel.name || 'Custom vision model'
                } else {
                    const remote = await describeStudioFrames(measured.scenes,studioLanguage(),controller.signal)
                    if (remote) {model = remote.model; descriptions = remote.scenes}
                }
                if (descriptions && (descriptions.length!==measured.scenes.length || descriptions.some(d =>
                    [d?.title,d?.observation,d?.musicPrompt].some(v => typeof v!=='string' || !v.trim()))))
                    throw new Error('Invalid scene descriptions')
            } catch (cause) {
                controller.signal.throwIfAborted()
                descriptions = undefined; model = studioLanguage()==='zh-CN' ? '本地画面特征' : 'Local picture features'
                error = cause instanceof Error ? cause.message : 'Vision model unavailable'
            }
            if (controller.signal.aborted || !service.hasProfile || service.project!==project || currentFilm(project)?.id!==sheetId || picture().file!==file) return
            const scenes = measured.scenes.map((scene,i) => {
                const d = descriptions?.[i] ?? localDescription(scene,i)
                return {...scene,title:d.title.trim().slice(0,64),observation:d.observation.trim().slice(0,650),musicPrompt:d.musicPrompt.trim().slice(0,500),
                    ...(typeof d.mood==='string' && d.mood.trim() ? {mood:d.mood.trim().slice(0,100)} : {}),
                    ...(typeof d.startsNewBeat==='boolean' ? {startsNewBeat:d.startsNewBeat} : {})}
            })
            const next = {version:1 as const,sheetId,file:file.name,size:file.size,duration:measured.duration,offset:picture().offset,model,scenes}
            const chosenIndex=index, shouldFocus=pickedFrame
            applyPictureAnalysis(project,next,maxSceneSeconds,initialTiming,trigger); report=next; index=chosenIndex;paint()
            if (shouldFocus && !service.engine.isPlaying.getValue()) {
                const cue=currentCue()
                if (cue && getSelectedScoringCue(project)!==cue.id) {
                    const position=timelinePosition(project)
                    requestScoringCue(project,cue.id)
                    seekTimeline(project,position)
                }
                index=chosenIndex
            }
        } catch (cause) {
            if (!controller.signal.aborted) error = cause instanceof Error ? cause.message : tr('Analysis interrupted. Try again.')
        } finally {
            watcher.terminate()
            if (job===controller) {job=undefined;provisional=undefined;progress=-1;paint()}
        }
    }
    function bind() {
        releaseProject?.(); releaseProject = undefined; restored()
        if (!service.hasProfile) return
        const project = service.project
        const unselect = subscribeScoringSelection(project,() => {
            if (!report) return
            const cue = readScoring(project).cues.find(c => c.id===getSelectedScoringCue(project))
            if (!cue) return
            const merged=groups.findIndex(group=>group.cueId===cue.id)
            const next=merged>=0 ? merged : groups.findIndex(group=>!group.cueId && group.shots.some(s=>pictureOverlap(windowOf(s,picture().offset),cue)>0))
            if (next >= 0) {index=next; selected()}
        })
        const data = watchPictureReport(project,stored=>{
            const {file}=picture()
            report = stored && file && stored.file===file.name && stored.size===file.size ? stored : undefined
            index=Math.min(index,Math.max(0,(report?.scenes.length??0)-1));paint()
        })
        const scoring = MetaData.catchupAndSubscribe(project.rootBox,scoringOrigin,paint)
        const edit = project.editing.subscribe(() => {if (details.open && !root.hidden) pre.textContent=json()})
        releaseProject = () => {unselect();data.terminate();scoring.terminate();edit.terminate()}
    }
    button.onclick = () => void analyze()
    details.ontoggle = () => {if (details.open) pre.textContent=json()}
    details.querySelector('button')!.onclick = async () => {
        const blob = new Blob([json()],{type:'application/json'})
        try {
            const dest=await chooseFileDestination(`score-cue-${index+1}.json`)
            if (dest) await dest.write(blob)
        } catch (e) {if (!saveCancelled(e)) {error=e instanceof Error?e.message:String(e);paint()}}
    }
    const sub = service.projectProfileService.catchupAndSubscribe(bind), unlang = watchStudioLanguage(paint)
    return {analyze,restored,cancel,beforeGenerate() {
        if (!job || !service.hasProfile) return
        if (readScoring(service.project).cues.length && (!pickedFrame || currentCue())) return
        if (!provisional) throw new Error(tr('Finding keyframes. Please wait a moment.'))
        acceptLocal()
        const cue=currentCue()
        if (cue) requestScoringCue(service.project,cue.id)
    },dispose() {cancel();unlang();sub.terminate();releaseProject?.();root.remove()}}
}
