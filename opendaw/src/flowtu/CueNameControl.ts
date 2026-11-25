import type {Project} from '@opendaw/studio-core'
import {editFilmCue} from './film-cue-edits'
import {cueLabel, readScoring} from './scoring-model'
import {tr} from './studio-language'
import './cue-name-control.css'

/** The title edits the existing cue. Its neighbouring time button still selects and seeks. */
export function createCueNameControl(row:HTMLElement,id:string,current:()=>Project|undefined,
                                     select:()=>void,afterEdit:()=>void,onError:(error:unknown)=>void) {
    const title=document.createElement('button'),field=document.createElement('input')
    row.dataset.cueRename=''
    title.type='button';title.className='ft-cue-title-edit';title.dataset.noI18n=''
    field.type='text';field.maxLength=64;field.autocomplete='off';field.className='ft-cue-title-input';field.hidden=true
    let owner:Project|undefined,original=''
    function start() {
        const project=current()
        if(!project || !row.isConnected)return
        const state=readScoring(project),cue=state.cues.find(item=>item.id===id)
        if(!cue)return
        select();owner=project;original=cueLabel(state,cue)
        field.value=original;field.setAttribute('aria-label',tr('Cue name'))
        field.hidden=false;title.hidden=true;field.focus({preventScroll:true});field.select()
    }
    function finish(save:boolean,focus:boolean) {
        if(!owner)return
        const project=owner,name=field.value.trim()
        owner=undefined;field.hidden=true;title.hidden=false
        if(save && name && name!==original && row.isConnected && current()===project) {
            try {editFilmCue(project,id,{name});afterEdit()} catch(error){onError(error)}
        }
        if(focus && title.isConnected)title.focus({preventScroll:true})
    }
    title.onclick=start
    field.onblur=()=>finish(true,false)
    field.onkeydown=event=>{
        event.stopPropagation()
        if(event.isComposing || event.keyCode===229)return
        if(event.key==='Escape' || event.key==='Enter') {
            event.preventDefault();finish(event.key==='Enter',true)
        }
    }
    row.addEventListener('contextmenu',event=>{
        if(event.target===field)return
        event.preventDefault();event.stopPropagation()
        const menu=document.createElement('div'),rename=document.createElement('button')
        menu.className='ft-cue-name-menu';menu.popover='auto';menu.setAttribute('role','menu')
        rename.type='button';rename.setAttribute('role','menuitem');rename.textContent=tr('Rename…')
        rename.onclick=()=>{menu.hidePopover();start()}
        menu.addEventListener('toggle',()=>{if(!menu.matches(':popover-open'))menu.remove()})
        menu.append(rename);row.append(menu);menu.showPopover()
        const anchor=title.getBoundingClientRect()
        menu.style.left=Math.max(0,Math.min(event.clientX || anchor.left,innerWidth-menu.offsetWidth))+'px'
        menu.style.top=Math.max(0,Math.min(event.clientY || anchor.bottom,innerHeight-menu.offsetHeight))+'px'
        rename.focus({preventScroll:true})
    })
    return {title,field,update(name:string) {
        if(owner && current()!==owner)finish(false,false)
        title.textContent=name;title.title=tr('Rename')+' · '+name
    }}
}
