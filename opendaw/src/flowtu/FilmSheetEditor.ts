import {openComposerWorkspace, closeComposerWorkspace} from './composer-workspaces'
import type {StudioService} from '../service/StudioService'
import type {Project} from '@opendaw/studio-core'
import {MetaData} from '@opendaw/studio-adapters'
import {Terminator} from '@opendaw/lib-std'
import {readFilmBook,selectFilmSheet,watchFilmBook} from './film-sheets'
import {editFilmCue,mergeFilmCue,orderedCues,reorderFilmCue,splitFilmCue} from './film-cue-edits'
import {cueLabel,readScoring,scoringOrigin} from './scoring-model'
import {createCueNameControl} from './CueNameControl'
import {getSelectedScoringCue,requestScoringCue} from './scoring-selection'
import {tr,watchStudioLanguage} from './studio-language'
import {timelinePosition} from './timeline-seek'
import './film-sheet.css'

const stamp=(sec:number)=>new Date(Math.round(sec*1000)).toISOString().slice(11,23)
const el=<K extends keyof HTMLElementTagNameMap>(tag:K)=>document.createElement(tag)
function button(caption:string) {
    const b=el('button');b.type='button';b.textContent=tr(caption);return b
}
export function installFilmSheetControls(service:StudioService,ground:Element) {
    const triggers=[...ground.querySelectorAll('.ft-score-collection .ft-score-section-title,.ft-lite-inspector > header')].map(host=>{
        const b=button('Cue sheets');b.className='ft-sheets-open';b.onclick=open;host.append(b);return b
    })
    const modal=el('dialog'), head=el('header'), heading=el('h2'), close=button('Close'), sheets=el('select')
    const content=el('div'),list=el('ol'),editor=el('section'),name=el('input'), notes=el('textarea')
    const times=el('div'), start=el('input'),end=el('input'), cut=el('input'), tools=el('footer')
    const split=button('Split cue'),merge=button('Merge with next'),up=button('Move up'),down=button('Move down'),status=el('output')
    modal.className='ft-film-book';content.className='ft-film-book-body';times.className='ft-film-times'
    modal.setAttribute('aria-labelledby','ft-film-book-heading');heading.id='ft-film-book-heading';status.setAttribute('role','status')
    head.append(heading,close);content.append(list,editor);tools.append(split,merge,up,down)
    modal.append(head,sheets,content,status);document.body.append(modal);close.onclick=()=>closeComposerWorkspace(modal)
    const labels:Array<[HTMLSpanElement,string]>=[]
    const field=(caption:string,input:HTMLElement)=>{
        const label=el('label'),text=el('span');labels.push([text,caption]);label.append(text,input);return label
    }
    for (const input of [start,end,cut]) {input.type='number';input.step='0.01';input.min='0'}
    notes.rows=6;notes.maxLength=12000;name.maxLength=64
    times.append(field('Start (s)',start),field('End (s)',end),field('Split at (s)',cut))
    editor.append(field('Cue name',name),times,field('Scene notes · Markdown',notes),tools)
    let project:Project|undefined,selected:string|undefined,lastFilm:string|null=null,pending=0
    const rows=new Map<string,ReturnType<typeof createRow>>()
    const life=new Terminator()
    function localize(){
        heading.textContent=tr('Cue sheets');close.textContent=tr('Close');sheets.ariaLabel=tr('Cue sheets')
        triggers.forEach(b=>b.textContent=tr('Cue sheets'));labels.forEach(([label,key])=>label.textContent=tr(key))
        ;[split,merge,up,down].forEach((b,i)=>b.textContent=tr(['Split cue','Merge with next','Move up','Move down'][i]))
    }
    function run(action:()=>void) {
        try {status.textContent='';action()} catch (cause) {status.textContent=cause instanceof Error ? cause.message : String(cause)}
    }
    function createRow(id:string) {
        const row=el('li'),handle=button('⠿'),body=el('div'),pick=el('button'),time=el('small')
        body.className='ft-film-cue-body'
        handle.className='ft-film-drag';pick.type='button';row.dataset.cueId=id
        const nameControl=createCueNameControl(row,id,()=>project,()=>{selected=id;render()},render,
            error=>{status.textContent=error instanceof Error?error.message:String(error)})
        pick.append(time);body.append(nameControl.title,nameControl.field,pick);row.append(handle,body)
        pick.onclick=()=>{selected=id;requestScoringCue(project!,id);render()}
        let target:string|undefined
        handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();handle.setPointerCapture(e.pointerId);target=id}
        handle.onpointermove=e=>{
            if (!handle.hasPointerCapture(e.pointerId)) return
            const candidate=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLLIElement>('li[data-cue-id]')
            target=candidate && list.contains(candidate) ? candidate.dataset.cueId : undefined
            list.querySelectorAll<HTMLElement>('li').forEach(r=>r.classList.toggle('drop',r.dataset.cueId===target && target!==id))
        }
        handle.onpointerup=e=>{
            if (!handle.hasPointerCapture(e.pointerId)) return
            if (target && project) run(()=>{reorderFilmCue(project!,id,target!);selected=id})
            render()
        }
        handle.onpointercancel=()=>render()
        return {row,handle,nameControl,pick,time}
    }
    function render() {
        if (!project || !modal.open) return
        const book=readFilmBook(project), state=readScoring(project), cues=orderedCues(state)
        if (book.active!==lastFilm || !cues.some(c=>c.id===selected)) selected=cues[0]?.id
        lastFilm=book.active
        const selectFilm = (id:string|null)=>{if(project) selectFilmSheet(project,id)}
        sheets.replaceChildren()
        if (!book.active) sheets.add(new Option(tr('Current session'),'')) 
        book.sheets.forEach((sheet,index)=>sheets.add(new Option(`${index+1} · ${sheet.name}`,sheet.id)))
        sheets.value=book.active ?? '';sheets.onchange=()=>run(()=>selectFilm(sheets.value || null))
        const visible=new Set(cues.map(c=>c.id))
        for(const [id,{row}] of rows)if(!visible.has(id)){row.remove();rows.delete(id)}
        list.querySelector('[data-empty]')?.remove()
        cues.forEach((cue,index)=>{
            let item=rows.get(cue.id)
            if(!item){item=createRow(cue.id);rows.set(cue.id,item)}
            const {row,handle,nameControl,time,pick}=item,label=cueLabel(state,cue)
            row.dataset.selected=String(cue.id===selected);row.classList.remove('drop')
            nameControl.update(label);handle.title=handle.ariaLabel=tr('Drag to reorder cues')
            time.textContent=stamp(cue.start)+' – '+stamp(cue.end);pick.ariaLabel=label+' · '+time.textContent
            if(list.children[index]!==row)list.insertBefore(row,list.children.item(index))
        })
        const idx=cues.findIndex(c=>c.id===selected),cue=cues[idx]
        editor.hidden=!cue
        if (!cue) {const empty=el('li');empty.dataset.empty='';empty.textContent=tr('No cues yet');list.append(empty);return}
        name.value=cue.name ?? '';notes.value=cue.markdown ?? cue.prompt;notes.maxLength=Math.max(12000,notes.value.length)
        start.value=String(cue.start);end.value=String(cue.end)
        const playhead=project.tempoMap.ppqnToSeconds(timelinePosition(project))
        cut.value=String(Math.round((playhead>cue.start && playhead<cue.end ? playhead : (cue.start+cue.end)/2)*1000)/1000)
        name.onchange=()=>run(()=>editFilmCue(project!,cue.id,{name:name.value}))
        notes.onchange=()=>run(()=>editFilmCue(project!,cue.id,{markdown:notes.value}))
        start.onchange=end.onchange=()=>run(()=>editFilmCue(project!,cue.id,{start:start.valueAsNumber,end:end.valueAsNumber}))
        split.onclick=()=>run(()=>{selected=splitFilmCue(project!,cue.id,cut.valueAsNumber);render()})
        merge.disabled=down.disabled=idx+1===cues.length;up.disabled=idx===0
        merge.onclick=()=>run(()=>{mergeFilmCue(project!,cue.id);render()})
        up.onclick=()=>run(()=>{reorderFilmCue(project!,cue.id,cues[idx-1].id);render()})
        down.onclick=()=>run(()=>{reorderFilmCue(project!,cue.id,cues[idx+1].id);render()})
    }
    function schedule(){if (!pending)pending=requestAnimationFrame(()=>{pending=0;render()})}
    function open() {
        if (!service.hasProfile || modal.open) return
        project=service.project;lastFilm=readFilmBook(project).active;selected=getSelectedScoringCue(project)
        status.textContent='';localize();openComposerWorkspace(modal);render()
        life.ownAll(watchFilmBook(project,schedule),MetaData.catchupAndSubscribe(project.rootBox,scoringOrigin,schedule))
    }
    const invoke=(e:Event)=>{if(service.hasProfile && (e as CustomEvent).detail===service.project)open()}
    document.addEventListener('ft-open-film-sheets',invoke)
    modal.oncancel=event=>{event.preventDefault();closeComposerWorkspace(modal)}
    modal.onclose=()=>{life.terminate();project=undefined;rows.clear();list.replaceChildren();cancelAnimationFrame(pending);pending=0}
    const profile=service.projectProfileService.subscribe(()=>{if(modal.open)closeComposerWorkspace(modal)})
    const unlang=watchStudioLanguage(()=>{localize();render()})
    localize()
    return ()=>{unlang();profile.terminate();life.terminate();cancelAnimationFrame(pending);document.removeEventListener('ft-open-film-sheets',invoke);if(modal.open)closeComposerWorkspace(modal);modal.remove();triggers.forEach(b=>b.remove())}
}
