import {videoSourceDescription} from './video-source'
import {Terminator} from '@opendaw/lib-std'
import {MetaData} from '@opendaw/studio-adapters'
import type {Project} from '@opendaw/studio-core'
import type {StudioService} from '../service/StudioService'
import {installAssetDrag} from './asset-drag'
import {readFilmBook, selectFilmSheet} from './film-sheets'
import {pictureReportOrigin} from './lite-model'
import {drawMediaThumbnail} from './media-thumbnail'
import {projectAssets} from './scoring-assets'
import {mediaRemoveButton} from './media-removal'
import {takeRegion} from './scoring-model'
import {importMedia} from './media-import'
import {createTakeAudition} from './take-audition'
import {tr,watchStudioLanguage} from './studio-language'
import {createSavedProjectList, type LibraryChoice} from './ProjectLibraryDialog'
import './lite-media-drawer.css'

type Options={importVideo():void; fileForFilm?(id:string):File|undefined; openSavedProject(choice:LibraryChoice):void; toolbar?:HTMLElement}
type LibraryTab='media'|'projects'
const make=<K extends keyof HTMLElementTagNameMap>(tag:K)=>document.createElement(tag)
const clock=(s:number)=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0')
function videoThumbnail(canvas:HTMLCanvasElement,file:File,life:Terminator) {
    const video=make('video'),url=URL.createObjectURL(file)
    video.muted=true;video.playsInline=true;video.preload='auto'
    let released=false
    const release=()=>{
        if(released)return
        released=true;video.onloadeddata=video.onloadedmetadata=video.onseeked=video.onerror=null
        video.removeAttribute('src');video.load();URL.revokeObjectURL(url)
    }
    const capture=()=>{
        if(!video.videoWidth || video.seeking || video.readyState<2)return
        canvas.width=160;canvas.height=90
        const scale=Math.max(canvas.width/video.videoWidth,canvas.height/video.videoHeight)
        const w=video.videoWidth*scale,h=video.videoHeight*scale
        canvas.getContext('2d')?.drawImage(video,(canvas.width-w)/2,(canvas.height-h)/2,w,h)
        release()
    }
    life.own({terminate:release})
    video.onloadedmetadata=()=>video.currentTime=Math.min(.5,video.duration/2)
    video.onloadeddata=video.onseeked=capture;video.onerror=release;video.src=url
}

export function installLiteMediaDrawer(root:HTMLElement, viewer:HTMLElement,service:StudioService,options:Options) {
    const drawer=make('aside'),open=make('button'),recent=make('button'),close=make('button'),header=make('header')
    const launchers=make('div'),tabs=make('div'),mediaTab=make('button'),projectTab=make('button'),media=make('section')
    const search=make('input'),list=make('div'),footer=make('footer'),addAudio=make('button'),addFilm=make('button'),file=make('input'),status=make('output')
    const owner=new Terminator(), rows=new Terminator(), watch=new Terminator(),audition=createTakeAudition(service)
    drawer.className='ft-lite-media-drawer';drawer.id='ft-lite-media-drawer'
    drawer.setAttribute('role','dialog')
    if(typeof drawer.showPopover==='function') drawer.popover='manual'
    launchers.className='ft-lite-library-launchers';open.className='ft-lite-media-open';recent.className='ft-lite-recent-open'
    tabs.setAttribute('role','tablist');media.className='ft-lite-media-pane'
    for(const button of [open,recent,mediaTab,projectTab,close,addAudio,addFilm])button.type='button'
    for(const button of [open,recent]) {
        button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls',drawer.id);button.setAttribute('aria-expanded','false')
    }
    close.className='ft-lite-media-close';close.textContent='×';list.className='ft-lite-media-list'
    file.type='file';file.multiple=true;file.accept='audio/*,.aif,.aiff,.wav,.flac,.m4a,.mid,.midi,.smf,.kar';file.hidden=true
    search.type='search';status.setAttribute('role','status')
    let activeTab:LibraryTab='media',opener=open
    const projectPane=make('section')
    for(const [tab,pane,id] of [[mediaTab,media,'media'],[projectTab,projectPane,'projects']] as const) {
        tab.id='ft-library-tab-'+id;pane.id='ft-library-pane-'+id
        tab.setAttribute('role','tab');tab.setAttribute('aria-controls',pane.id)
        pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',tab.id)
    }
    tabs.append(mediaTab,projectTab);header.append(tabs,close);footer.append(addFilm,addAudio)
    media.append(search,list,status,footer,file);drawer.append(header,media,projectPane)
    viewer.classList.add('ft-lite-media-host')
    launchers.append(open,recent);(options.toolbar??viewer).append(launchers)
    root.append(drawer);drawer.hidden=true
    let project:Project|undefined,show=false,frame=0,dragFilm:{project:Project;id:string}|undefined,playingButton:HTMLButtonElement|undefined
    const buttons=new Map<string,HTMLButtonElement>()
    function localize() {
        open.textContent=open.title=mediaTab.textContent=tr('Media library')
        recent.textContent=recent.title=projectTab.textContent=tr('Recent projects')
        tabs.ariaLabel=drawer.ariaLabel=tr('Media library')+' / '+tr('Recent projects')
        close.ariaLabel=tr('Close')
        search.placeholder=search.ariaLabel=tr('Search media')
        addFilm.textContent=tr('Import picture');addAudio.textContent=tr('Add audio / MIDI')
    }
    function selectTab(tab:LibraryTab, focus=false) {
        activeTab=tab
        const showMedia=tab==='media'
        media.hidden=!showMedia;projectPane.hidden=showMedia
        for(const [button,selected] of [[mediaTab,showMedia],[projectTab,!showMedia]] as const) {
            button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1
        }
        open.setAttribute('aria-expanded',String(showMedia));recent.setAttribute('aria-expanded',String(!showMedia))
        if(showMedia) {projectPane.replaceChildren();refresh();render()}
        else {
            audition.stop();rows.terminate();buttons.clear();list.replaceChildren()
            const projects=createSavedProjectList(choice=>{setOpen(false,true);options.openSavedProject(choice)},true)
            projectPane.replaceChildren(projects.element);void projects.render()
        }
        if(focus) (showMedia?mediaTab:projectTab).focus({preventScroll:true})
    }
    function setOpen(value:boolean,focus=false,tab:LibraryTab=activeTab) {
        show=value
        if(value){
            drawer.hidden=false
            if(drawer.popover && !drawer.matches(':popover-open'))drawer.showPopover()
            positionPopup()
            selectTab(tab)
            if(focus) (tab==='media'?search:projectTab).focus({preventScroll:true})
        } else {
            if(drawer.popover && drawer.matches(':popover-open'))drawer.hidePopover()
            drawer.hidden=true;open.setAttribute('aria-expanded','false');recent.setAttribute('aria-expanded','false')
            audition.stop();rows.terminate();buttons.clear();list.replaceChildren();projectPane.replaceChildren()
            if(focus && !root.hidden)opener.focus({preventScroll:true})
        }
    }
    function positionPopup() {
        if (!show || window.innerWidth < 900) {drawer.style.removeProperty('top');drawer.style.removeProperty('right');return}
        const anchor=launchers.getBoundingClientRect()
        drawer.style.top=Math.max(8,Math.min(anchor.bottom+6,window.innerHeight-drawer.offsetHeight-12))+'px'
        drawer.style.right=Math.max(12,window.innerWidth-anchor.right)+'px'
    }
    const report=(error:unknown)=>{status.textContent=error instanceof Error?error.message:String(error)}
    function schedule(){if(show && !frame)frame=requestAnimationFrame(()=>{frame=0;render()})}
    function refresh(){
        const next=service.hasProfile?service.project:undefined
        addAudio.disabled=!next;addFilm.disabled=!next
        if(project!==next){
            watch.terminate();project=next;status.textContent=''
            if(next)watch.own(next.editing.subscribe(schedule))
            schedule()
        }
    }
    function mediaRow(id:string,name:string,kind:string,seconds:number) {
        const row=make('div'),thumb=make('div'),text=make('div'),title=make('strong'),meta=make('small'),play=make('button')
        row.className='ft-lite-media-item';row.dataset.mediaId=id;row.dataset.kind=kind
        thumb.className='ft-lite-media-thumb';text.className='ft-lite-media-info'
        title.dataset.noI18n='';title.textContent=name;title.title=name;meta.textContent=tr(kind)+' · '+clock(seconds)
        text.append(title,meta);play.type='button';play.className='ft-lite-media-use'
        row.append(thumb,text,play);list.append(row)
        return {row,thumb,play,meta}
    }
    function render(){
        if(!show || activeTab!=='media' || root.hidden)return
        rows.terminate();list.replaceChildren();buttons.clear();playingButton=undefined
        const p=project
        if(!p){status.textContent=tr('No project open');return}
        const filter=search.value.trim().toLocaleLowerCase(),match=(name:string)=>name.toLocaleLowerCase().includes(filter)
        const films=readFilmBook(p)
        for(const movie of films.sheets.filter(f=>f.hasVideo && match(f.name))) {
            const {row,thumb,play,meta}=mediaRow(movie.id,movie.name,'Video',movie.duration)
            if(movie.source) {
                meta.textContent=clock(movie.duration)+' · '+videoSourceDescription(movie.source)
                row.title=movie.name+' · '+meta.textContent
            }
            play.textContent=movie.id===films.active?'✓':'↗';play.ariaLabel=movie.name
            play.setAttribute('aria-pressed',String(movie.id===films.active))
            const choose=()=>{if(service.hasProfile && service.project===p)try{selectFilmSheet(p,movie.id)}catch(error){report(error)}}
            play.onclick=choose;row.ondblclick=e=>{if (!(e.target instanceof Element && e.target.closest('button'))) choose()}
            row.append(mediaRemoveButton(service,{...movie,kind:'Video'},schedule,report,true))
            const key=movie.id===films.active?pictureReportOrigin:pictureReportOrigin+'/'+movie.id
            const data=MetaData.read(p.rootBox,key) as {scenes?:{thumbnail?:string}[]}|null
            const poster=data?.scenes?.[0]?.thumbnail
            if(typeof poster==='string' && poster.startsWith('data:image/jpeg;base64,')) {
                const img=make('img');img.alt='';img.src=poster;thumb.append(img)
            }else{
                const src=options.fileForFilm?.(movie.id),canvas=make('canvas');thumb.append(canvas)
                if(src)videoThumbnail(canvas,src,rows)
            }
            row.draggable=true
            row.ondragstart=e=>{if(!e.dataTransfer)return;dragFilm={project:p,id:movie.id};e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('application/x-flowtu-reference',movie.id)}
            row.ondragend=()=>{dragFilm=undefined;viewer.classList.remove('ft-lite-film-drop')}
        }
        for(const asset of projectAssets(p).filter(a=>match(a.name))) {
            const {row,thumb,play}=mediaRow(asset.id,asset.name,asset.kind,asset.seconds), region=takeRegion(p,asset.id)
            if(region){const canvas=make('canvas');thumb.append(canvas);drawMediaThumbnail(canvas,region,rows)}
            play.ariaLabel=tr('Preview')+' · '+asset.name;play.textContent='▷';buttons.set(asset.id,play)
            play.onclick=()=>{void audition.play(asset.id).then(updatePreview,report);updatePreview()}
            row.append(mediaRemoveButton(service,asset,()=>{
                if (audition.current()===asset.id) audition.stop()
                schedule()
            },report,true))
            rows.own(installAssetDrag(row,p,asset.id))
        }
        if(!list.childElementCount){const hint=make('p');hint.textContent=tr('No matching media.');list.append(hint)}
        updatePreview()
    }
    function updatePreview(){
        if(!show)return
        const current=buttons.get(audition.current()??'')
        if(playingButton!==current && playingButton)playingButton.textContent='▷'
        if(current)current.textContent=audition.loading()?'…':'■'
        playingButton=current
    }
    function target(e:DragEvent){
        return e.dataTransfer?.types.includes('application/x-flowtu-reference') &&
            e.target instanceof Element && !drawer.contains(e.target) &&
            (viewer.contains(e.target)||!!e.target.closest('.ft-film-strip,.ft-lite-cue-lane,.ft-lite-analysis'))
    }
    function dragover(e:DragEvent){
        if(!dragFilm || !target(e) || !e.dataTransfer)return
        e.preventDefault();e.dataTransfer.dropEffect='copy';viewer.classList.add('ft-lite-film-drop')
    }
    function drop(e:DragEvent){
        const film=dragFilm;dragFilm=undefined;viewer.classList.remove('ft-lite-film-drop')
        if(!film || !target(e) || !service.hasProfile || film.project!==service.project)return
        e.preventDefault();selectFilmSheet(film.project,film.id)
    }
    root.addEventListener('dragover',dragover);root.addEventListener('drop',drop)
    for(const [launcher,tab] of [[open,'media'],[recent,'projects']] as const) {
        launcher.onclick=()=>{opener=launcher;setOpen(!(show && activeTab===tab),true,tab)}
    }
    mediaTab.onclick=()=>selectTab('media',true);projectTab.onclick=()=>selectTab('projects',true)
    tabs.onkeydown=e=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return
        e.preventDefault();e.stopPropagation()
        selectTab(e.key==='Home'?'media':e.key==='End'?'projects':activeTab==='media'?'projects':'media',true)
    }
    close.onclick=()=>setOpen(false,true);search.oninput=schedule
    drawer.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false,true)}}
    addFilm.onclick=options.importVideo;addAudio.onclick=()=>file.click()
    file.onchange=async()=>{
        const files=Array.from(file.files??[]);file.value='';const p=project
        if(!p)return
        try{for(const source of files){
            if(!service.hasProfile || service.project!==p)return
            await importMedia(service,source,{kind:'assets'})
        }status.textContent='';schedule()}catch(error){report(error)}
    }
    const outside=(e:PointerEvent)=>{if (e.target instanceof Element && e.target.closest('dialog.ft-media-confirm')) return; if(show && e.target instanceof Node && !drawer.contains(e.target) && !launchers.contains(e.target))setOpen(false)}
    document.addEventListener('pointerdown',outside,true)
    window.addEventListener('resize',positionPopup)
    const visibility=new MutationObserver(()=>{if(root.hidden && show)setOpen(false)})
    visibility.observe(root,{attributes:true,attributeFilter:['hidden']})
    owner.own(service.projectProfileService.subscribe(refresh))
    const timer=window.setInterval(updatePreview,450),unlang=watchStudioLanguage(()=>{localize();if(show)selectTab(activeTab)})
    localize();refresh()
    return {refresh,dispose(){
        root.removeEventListener('dragover',dragover);root.removeEventListener('drop',drop)
        document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',positionPopup);cancelAnimationFrame(frame);clearInterval(timer)
        visibility.disconnect();unlang();watch.terminate();rows.terminate();owner.terminate();audition.dispose();drawer.remove();launchers.remove()
        viewer.classList.remove('ft-lite-media-host','ft-lite-media-visible','ft-lite-film-drop')
    }}
}
