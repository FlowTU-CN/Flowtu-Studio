import type {StudioService} from '../service/StudioService'
import {createLiteScorePanel} from './LiteScorePanel'
import {installLiteAnalysis} from './LitePictureAnalysis'
import {installLitePictureSplit} from './LitePictureSplit'
import {installLiteDesktop} from './LiteDesktop'
import {installScoreZoom} from './ScoreZoom'
import {installLiteMediaDrawer} from './LiteMediaDrawer'
import type {LibraryChoice} from './ProjectLibraryDialog'
import {tr, watchStudioLanguage} from './studio-language'
import './lite-studio.css'
import './lite-picture.css'
import './lite-desktop.css'

type LiteAPI = {
    service: StudioService
    setProComposerActive(on:boolean):void
    picture(): {file?:File; ready:boolean; offset:number; duration:number}
    importVideo():void
    dropVideo(file:File):void
    fileForFilm?(id:string):File|undefined
    importClip():void
    openSavedProject(choice:LibraryChoice):void
    example():Promise<void>
    exportMix():void
    markCue():boolean
}
/** Both views retain the very same monitor, scoring state, project and audio worklet. */
export function installLiteStudio(bar: HTMLElement, api: LiteAPI) {
    const {service}=api
    const native = bar.parentElement!.querySelector<HTMLElement>('.ft-score')!
    const monitor = native.querySelector<HTMLElement>('.ft-score-monitor')!
    const stage = monitor.querySelector<HTMLElement>('.ft-score-stage')!
    const anchor=document.createComment('Studio reference monitor'); monitor.before(anchor)
    const switcher=document.createElement('nav')
    switcher.className='ft-lite-switch'; switcher.setAttribute('aria-label',tr('Studio view'))
    switcher.innerHTML='<button type="button" data-mode="lite" data-i18n>Score Lite</button><button type="button" data-mode="pro" data-i18n>Pro Studio</button>'
    bar.querySelector('.flowtu-brand')!.after(switcher)
    const root=document.createElement('section')
    root.hidden=true;root.className='ft-lite'
    root.innerHTML=`<header class="ft-lite-topline"><div><h1></h1></div><div class="ft-lite-top-actions"><button type="button" data-lite="import" data-i18n>Import picture</button><button type="button" data-lite="export" data-i18n>Export WAV</button></div></header>
        <div class="ft-lite-layout"><section class="ft-lite-viewer"><header><h2 data-i18n>Reference picture</h2><span class="ft-lite-filename"></span></header></section></div>`
    bar.after(root)
    const layout=root.querySelector<HTMLElement>('.ft-lite-layout')!, viewer=layout.querySelector<HTMLElement>('.ft-lite-viewer')!
    const split = installLitePictureSplit(layout,viewer,monitor)
    const empty = document.createElement('div');empty.className='ft-lite-empty';empty.hidden=true
    empty.innerHTML=`<strong data-i18n>Choose a film to score</strong><button type="button" data-lite="choose" data-i18n>Import picture</button><button type="button" data-lite="demo" data-i18n>Try the example film</button><output role="status"></output>`
    stage.append(empty)
    // Use the same picture / original soundtrack choice for Finder drops as for the file picker.
    stage.addEventListener('dragover',videoDrag)
    stage.addEventListener('dragleave',videoLeave)
    stage.addEventListener('drop',videoDrop)
    function videoDrag(event: DragEvent) {
        if (!active || !event.dataTransfer || ![...event.dataTransfer.items].some(item=>item.kind==='file' && (!item.type || item.type.startsWith('video/')))) return
        event.preventDefault();event.dataTransfer.dropEffect='copy';stage.classList.add('ft-lite-video-over')
    }
    function videoLeave(event: DragEvent) {
        if (!(event.relatedTarget instanceof Node && stage.contains(event.relatedTarget))) stage.classList.remove('ft-lite-video-over')
    }
    function videoDrop(event: DragEvent) {
        stage.classList.remove('ft-lite-video-over')
        const film=[...event.dataTransfer?.files??[]].find(file=>file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.name))
        if (!active || !film) return
        event.preventDefault();event.stopPropagation();api.dropVideo(film)
    }
    const choose=root.querySelector<HTMLButtonElement>('[data-lite=import]')!
    const wav=root.querySelector<HTMLButtonElement>('[data-lite=export]')!
    const demo=empty.querySelector<HTMLButtonElement>('[data-lite=demo]')!
    choose.onclick=api.importVideo;empty.querySelector<HTMLButtonElement>('[data-lite=choose]')!.onclick=api.importVideo
    wav.onclick=api.exportMix
    const loadExample=async () => {
        demo.disabled=true
        try {await api.example()} catch(e) {empty.querySelector('output')!.textContent=e instanceof Error?e.message:String(e)}
        finally {demo.disabled=false;refresh()}
    }
    demo.onclick=()=>void loadExample()
    const panel=createLiteScorePanel(service,{getVideo:api.picture,markCue:api.markCue,beforeGenerate:()=>analysis.beforeGenerate()})
    layout.append(panel.inspector,panel.timeline,panel.dock)
    const importClip=document.createElement('button')
    importClip.type='button';importClip.className='ft-lite-import-clip';importClip.dataset.lite='audio';importClip.dataset.i18n=''
    importClip.textContent='Add audio / MIDI';importClip.onclick=api.importClip
    panel.timeline.querySelector('header')!.append(importClip)
    const analysis=installLiteAnalysis(service,panel.timeline,api.picture)
    const heading=root.querySelector('h1')!
    const desktopViewport=matchMedia('(min-width: 900px)')
    const zoom=installScoreZoom(service,panel.timeline.querySelector('header')!)
    const desktop=installLiteDesktop(root,bar,panel.inspector,panel.timeline,service)
    const drawer=installLiteMediaDrawer(root,viewer,service,api)
    let active=false, previouslyCollapsed=false
    const syncDesktop=()=>{
        zoom.setActive(active && desktopViewport.matches)
        api.setProComposerActive(!active && desktopViewport.matches)
    }
    desktopViewport.addEventListener('change',syncDesktop)
    syncDesktop()
    const text=(el:Element,value:string)=>{if(el.textContent!==value)el.textContent=value}
    function refresh() {
        if (!active) return
        const {file}=api.picture()
        split.sync(file)
        empty.hidden=!!file
        text(heading, service.hasProfile ? service.profile.meta.name : tr('No project open'))
        text(root.querySelector('.ft-lite-filename')!,file?.name ?? '')
        text(choose,tr(file ? 'Replace picture' : 'Import picture'))
        wav.disabled=!service.hasProfile
        panel.refresh()
        drawer.refresh()
    }
    function activate(on:boolean) {
        if (active===on) return
        active=on
        document.documentElement.classList.toggle('ft-lite-open',on)
        root.hidden=!on
        switcher.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(on===(b.dataset.mode==='lite'))))
        if (on) {
            previouslyCollapsed=native.classList.contains('collapsed')
            if (previouslyCollapsed) native.querySelector<HTMLButtonElement>('[data-action=collapse]')!.click()
            viewer.append(monitor);stage.classList.add('ft-lite-stage')
        } else {
            anchor.after(monitor);stage.classList.remove('ft-lite-stage');empty.hidden=true
            if (previouslyCollapsed && !native.classList.contains('collapsed')) native.querySelector<HTMLButtonElement>('[data-action=collapse]')!.click()
        }
        desktop.activate(on);syncDesktop();panel.setActive(on);refresh()
    }
    switcher.querySelectorAll('button').forEach(b=>{
        b.setAttribute('aria-pressed',String(b.dataset.mode==='pro'))
        b.onclick=()=>activate(b.dataset.mode==='lite')
    })
    const unlang=watchStudioLanguage(()=>{switcher.ariaLabel=tr('Studio view');refresh()})
    const statusObserver=new MutationObserver(refresh)
    statusObserver.observe(stage,{attributes:true,attributeFilter:['data-monitor-state']})
    const profileSub=service.projectProfileService.subscribe(refresh)
    return {activate,refresh,analysis,loadExample,dispose() {
        activate(false);desktopViewport.removeEventListener('change',syncDesktop);api.setProComposerActive(false);zoom.dispose();desktop.dispose();drawer.dispose();analysis.dispose();panel.dispose();statusObserver.disconnect();profileSub.terminate();unlang()
        stage.removeEventListener('dragover',videoDrag);stage.removeEventListener('dragleave',videoLeave);stage.removeEventListener('drop',videoDrop)
        split.dispose();anchor.remove();empty.remove();switcher.remove();root.remove()
    }}
}
