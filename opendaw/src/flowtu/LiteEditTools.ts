import type {StudioService} from '../service/StudioService'
import type {EditingTool} from './editing-state'
import {getExplicitTimelineSelection} from './timeline-selection'
import {toolKeyLabel, splitKeyLabel, keyProfile, onKeyProfileChange} from './tool-shortcuts'
import {createToolbarMenu} from './ToolbarMenu'
import {tr, watchStudioLanguage} from './studio-language'
import './lite-edit-tools.css'

const paths = {
    more:'M12 5v14M5 12h14',
    select:'M5 3l14 10-7 1-4 7z',
    undo:'M9 5 4 10l5 5M5 10h9a6 6 0 0 1 6 6v2',
    redo:'m15 5 5 5-5 5m4-5h-9a6 6 0 0 0-6 6v2',
    split:'M7 5h-3v14h3m10-14h3v14h-3m-5-16v5m0 3v2m0 3v5',
    range:'M7 5H4v14h3M17 5h3v14h-3M9 12h6',
    trim:'M7 4v16M4 4h6M4 20h6m3-8h8m-3-3 3 3-3 3',
    delete:'M4 6h16M9 6V3h6v3M6 6l1 14h10l1-14m-8 4v6m4-6v6',
    volume:'M3 16h4l5-9h5l4 5M5 14h4v4H5zm8-9h4v4h-4z',
    snap:'M5 4v9a7 7 0 0 0 14 0V4h-4v9a3 3 0 0 1-6 0V4Zm0 4h4m6 0h4',
    audio:'M3 11v2m4-6v10m4-14v18m4-14v10m4-6v2',
    mark:'M6 21V4h12l-3 4 3 4H6',
    cut:'m9 8 11 12M9 16 20 4M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm0 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    fade:'M3 5v14h18M5 17C12 17 9 6 20 5',
    copy:'M8 8h12v12H8zM16 5V3H3v13h2',
    paste:'M8 5H5v16h14V5h-3M9 3h6v4H9z',
    duplicate:'M8 8h13v13H8zM16 5V3H3v13h2m9-5v6m-3-3h6',
    pan:'M3 12h18M7 8v8m10-11v14',
    inspect:'M4 7h16M4 17h16M8 4v6m8 4v6',
    all:'M3 4h18v16H3zm0 5h18M7 13h3m3 0h4'
} as const

type Icon = keyof typeof paths
type Tool = {
    icon:Icon
    label:string
    target?:()=>HTMLButtonElement|null
    shortcut?:()=>string
    action?:()=>void
    pressed?:()=>boolean
}
const glyph = (key:Icon) => '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="'+paths[key]+'"/></svg>'

/** The compact command strip uses the very same buttons and validation as the Pro timeline. */
export function mountLiteEditTools(service:StudioService, slot:HTMLElement, native:HTMLElement) {
    const lite=slot.closest<HTMLElement>('.ft-lite')!
    const menu=createToolbarMenu('Actions')
    const plus=menu.trigger
    const selection=()=>service.hasProfile&&!!getExplicitTimelineSelection(service.project)
    const command=(name:string)=>native.querySelector<HTMLButtonElement>('[data-edit-action="'+name+'"]')
    const automation=(name:string)=>native.querySelector<HTMLButtonElement>('.flowtu-envelope-tools [data-kind="'+name+'"]')
    const mac=/Mac|iPhone|iPad/.test(navigator.platform)
    const mod=mac?'⌘':'Ctrl+'
    const mode=(id:EditingTool & Icon,label:string):Tool=>({icon:id,label,shortcut:()=>toolKeyLabel(id),
        target:()=>native.querySelector<HTMLButtonElement>('[data-tool="'+id+'"]')})
    const splitLabel=()=>selection()?'Split Range':'Split at Cursor'
    const advanced=()=>lite.hasAttribute('data-expanded-edit-tools')
    const split:Tool={icon:'split',label:'Split',target:()=>command(splitLabel()),
        shortcut:()=>selection()&&keyProfile()==='flowtu'?'B':splitKeyLabel().replace('Cmd/Ctrl+',mod).replace('Alt/Opt+',mac?'⌥':'Alt+')}
    const visible:Tool[]=[
        mode('select','Smart / select'),
        {icon:'undo',label:'Undo',shortcut:()=>mod+'Z',target:()=>command('Undo')},
        {icon:'redo',label:'Redo',shortcut:()=>mod+(mac?'⇧':'Shift+')+'Z',target:()=>command('Redo')},
        split,mode('range','Range selection'),mode('trim','Trim'),
        {icon:'delete',label:'Delete',shortcut:()=>mac?'⌫':'Delete',target:()=>command(selection()?'Delete Range':'Delete')},
        {icon:'volume',label:'Volume Env',target:()=>automation('volume')},
        {icon:'snap',label:'Snap',shortcut:()=>'N',target:()=>native.querySelector('.edit-magnet > button')}
    ]
    const extras:Tool[]=[
        {icon:'audio',label:'Import audio or MIDI',target:()=>lite.querySelector('.ft-lite-import-clip')},
        {icon:'mark',label:'Mark cue',shortcut:()=>'M',target:()=>lite.querySelector('.ft-lite-mark')},
        mode('cut','Blade'),mode('fade','Fade'),
        {icon:'copy',label:'Copy',shortcut:()=>mod+'C',target:()=>command('Copy')},
        {icon:'paste',label:'Paste',shortcut:()=>mod+'V',target:()=>command('Paste')},
        {icon:'duplicate',label:'Duplicate',target:()=>command('Duplicate')},
        {icon:'pan',label:'Pan Env',target:()=>automation('panning')},
        {icon:'inspect',label:'Clip Inspector',target:()=>native.querySelector('[data-action="audio-tools"]')},
        {icon:'all',label:'Editing tools',pressed:advanced,action:()=>lite.toggleAttribute('data-expanded-edit-tools')}
    ]
    slot.classList.add('ft-lite-edit-tools')
    slot.setAttribute('role','toolbar')
    menu.element.classList.add('ft-edit-add');menu.panel.classList.add('ft-lite-more-tools')
    plus.replaceChildren();plus.innerHTML=glyph('more');plus.dataset.liteEdit='more'
    slot.append(menu.element)
    const bindings=new Map<HTMLButtonElement,Tool>()
    for(const [items,container] of [[visible,slot],[extras,menu.panel]] as const) {
        for(const tool of items) {
            const b=document.createElement('button')
            b.type='button';b.dataset.liteEdit=tool.icon;b.innerHTML=glyph(tool.icon)
            b.onclick=e=>{
                if(b.getAttribute('aria-disabled')==='true')return
                const target=tool.target?.()
                if(target)target.click()
                else tool.action?.()
                if(e.detail && container===slot) lite.querySelector<HTMLElement>('.ft-lite-native [data-scope="regions"]')?.focus({preventScroll:true})
                const message=native.querySelector<HTMLOutputElement>('.edit-selection[data-error="true"]')
                if(command('Undo')?.parentElement===target?.parentElement && message?.value) showHint(b,message.value)
                refresh()
            }
            bindings.set(b,tool);container.append(b)
        }
    }
    const hint=document.createElement('span')
    hint.className='ft-lite-command-hint';hint.hidden=true;hint.setAttribute('role','tooltip')
    function showHint(b:HTMLButtonElement, text=b.title){
        if(!text || !b.isConnected)return
        if(!hint.isConnected)document.body.append(hint)
        hint.textContent=text;hint.hidden=false
        const rect=b.getBoundingClientRect(),width=hint.offsetWidth
        hint.style.left=Math.max(6,Math.min(window.innerWidth-width-6,rect.left+(rect.width-width)/2))+'px'
        hint.style.top=Math.max(4,rect.top-hint.offsetHeight-6)+'px'
    }
    const hideHint=()=>{hint.hidden=true}
    for(const b of [...bindings.keys(),plus]){
        b.addEventListener('pointerenter',()=>showHint(b))
        b.addEventListener('focus',()=>showHint(b))
        b.addEventListener('pointerleave',hideHint);b.addEventListener('blur',hideHint)
    }
    function refresh() {
        slot.ariaLabel=tr('Editing tools');plus.ariaLabel=plus.title=tr('Add and more tools')
        menu.panel.ariaLabel=plus.ariaLabel
        for(const [b,tool] of bindings){
            const target=tool.target?.()
            const label=tr(tool===split?splitLabel():tool.label)
            const key=tool.shortcut?.()
            const description=key?label+' · '+key:label
            if(b.title!==description){b.ariaLabel=b.title=description}
            if(key){
                const binding=key.replace('⌘','Meta+').replace('⌥','Alt+').replace('⇧','Shift+').replace('⌫','Backspace').replace('Ctrl+','Control+')
                if(b.getAttribute('aria-keyshortcuts')!==binding)b.setAttribute('aria-keyshortcuts',binding)
            } else if(b.hasAttribute('aria-keyshortcuts'))b.removeAttribute('aria-keyshortcuts')
            const disabled=!!tool.target&&(!target||target.disabled)
            if(b.getAttribute('aria-disabled')!==String(disabled))b.setAttribute('aria-disabled',String(disabled))
            const pressed=tool.pressed?String(tool.pressed()):target?.getAttribute('aria-pressed')
            if(pressed!=null && b.getAttribute('aria-pressed')!==pressed)b.setAttribute('aria-pressed',pressed)
        }
    }
    lite.classList.add('ft-using-timeline-tools')
    const observe=new MutationObserver(records=>{
        if(records.some(r=>r.target instanceof Element && r.target.getAttribute(r.attributeName!)!==r.oldValue))refresh()
    })
    observe.observe(native,{subtree:true,attributes:true,attributeOldValue:true,attributeFilter:['disabled','aria-pressed']})
    // Range actions can change target even when the two native controls are both enabled.
    const selectionOutput=native.querySelector('.edit-selection')!
    const rangeUpdates=new MutationObserver(refresh)
    rangeUpdates.observe(selectionOutput,{childList:true,subtree:true,characterData:true})
    const unlang=watchStudioLanguage(refresh),unkeys=onKeyProfileChange(refresh)
    refresh()
    return ()=>{
        unlang();unkeys();observe.disconnect();rangeUpdates.disconnect();menu.dispose()
        lite.classList.remove('ft-using-timeline-tools');lite.removeAttribute('data-expanded-edit-tools')
        hint.remove();slot.replaceChildren()
    }
}
