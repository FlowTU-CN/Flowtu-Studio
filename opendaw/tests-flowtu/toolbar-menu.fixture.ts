import assert from 'node:assert/strict'

// Contract fixture for the real disclosure helper, not browser/layout automation.
class EventsFixture {
    listeners=new Map<string,Set<(event:any)=>void>>()
    options=new Map<string,unknown>()
    addEventListener(name:string,callback:(event:any)=>void,options?:unknown){const list=this.listeners.get(name)??new Set();list.add(callback);this.listeners.set(name,list);this.options.set(name,options)}
    removeEventListener(name:string,callback:(event:any)=>void){this.listeners.get(name)?.delete(callback)}
    emit(name:string,overrides:Record<string,unknown>={}){
        const event={target:this,key:'',detail:1,isComposing:false,defaultPrevented:false,stopped:false,
            preventDefault(){this.defaultPrevented=true},stopPropagation(){this.stopped=true},stopImmediatePropagation(){this.stopped=true},...overrides}
        for(const callback of this.listeners.get(name)??[])callback(event)
        return event
    }
}
class ElementFixture extends EventsFixture {
    children:ElementFixture[]=[];parent?:ElementFixture
    style:Record<string,string>={};attributes:Record<string,string>={};dataset:Record<string,string>={}
    hidden=false;disabled=false;tabIndex=-1;className='';textContent='';popoverOpen=false
    classList={add:(value:string)=>{if(!this.classList.contains(value))this.className=`${this.className} ${value}`.trim()},remove:(value:string)=>{this.className=this.className.split(' ').filter(part=>part!==value).join(' ')},contains:(value:string)=>this.className.split(' ').includes(value)}
    onclick?:()=>void
    rect={left:850,top:550,right:950,bottom:582,width:100,height:32}
    constructor(readonly tag:string){super()}
    get isConnected():boolean{return this===documentFixture.body||!!this.parent?.isConnected}
    append(...children:ElementFixture[]){for(const child of children){if(child.parent)child.parent.children=child.parent.children.filter(item=>item!==child);child.parent=this;this.children.push(child)}}
    contains(target:unknown):boolean{return target===this||this.children.some(child=>child.contains(target))}
    setAttribute(name:string,value:string){this.attributes[name]=value}
    removeAttribute(name:string){delete this.attributes[name]}
    getAttribute(name:string){return this.attributes[name]}
    matches(selector:string):boolean{
        return selector.split(',').some(part=>{
            if(part===':disabled')return this.disabled
            if(part==='[aria-disabled=true]')return this.attributes['aria-disabled']==='true'
            if(part==='[hidden]')return this.hidden
            if(part==='[inert]')return 'inert'in this.attributes
            if(part==='[data-menu-keep-open]')return this.dataset.menuKeepOpen!==undefined
            if(part.startsWith('[contenteditable]'))return this.attributes.contenteditable!==undefined&&this.attributes.contenteditable!=='false'
            if(part==='[role=textbox]')return this.attributes.role==='textbox'
            if(part==='[role=slider]')return this.attributes.role==='slider'
            if(part.startsWith('.'))return this.classList.contains(part.slice(1))
            return part==='a[href]'?this.tag==='a'&&!!this.attributes.href:part===this.tag
        })
    }
    closest(selector:string):ElementFixture|null{return this.matches(selector)?this:this.parent?.closest(selector)??null}
    querySelectorAll(_selector:string):ElementFixture[]{return this.children.flatMap(child=>[...(['button','a','input','select','textarea'].includes(child.tag)&&!child.disabled||child.tabIndex>=0?[child]:[]),...child.querySelectorAll(_selector)])}
    getClientRects(){return this.closest('[hidden]')?[]:[this.getBoundingClientRect()]}
    getBoundingClientRect(){return this.className==='flowtu-menu-panel'?{left:0,top:0,right:240,bottom:200,width:240,height:200}:this.rect}
    focus(){documentFixture.activeElement=this;documentFixture.emit('focusin',{target:this})}
    showPopover(){this.popoverOpen=true;this.emit('toggle',{newState:'open'})}
    hidePopover(){this.popoverOpen=false;this.emit('toggle',{newState:'closed'})}
}
const documentFixture=Object.assign(new EventsFixture(),{body:new ElementFixture('body'),activeElement:null as ElementFixture|null,createElement:(tag:string)=>new ElementFixture(tag)})
const windowFixture=Object.assign(new EventsFixture(),{innerWidth:1000,innerHeight:600})
let frameId=0
const frames=new Map<number,()=>void>()
Object.assign(globalThis,{document:documentFixture,window:windowFixture,Node:ElementFixture,Element:ElementFixture,HTMLElement:ElementFixture,
    requestAnimationFrame:(callback:()=>void)=>{frames.set(++frameId,callback);return frameId},cancelAnimationFrame:(id:number)=>frames.delete(id)})
const {createToolbarMenu}=await import('../src/flowtu/ToolbarMenu')
const menu=createToolbarMenu('Edit')
documentFixture.body.append(menu.element as any)
const trigger=menu.trigger as unknown as ElementFixture,panel=menu.panel as unknown as ElementFixture
const first=new ElementFixture('button'),disabled=new ElementFixture('button'),last=new ElementFixture('button'),select=new ElementFixture('select'),keep=new ElementFixture('button')
disabled.disabled=true;keep.dataset.menuKeepOpen='';let invoked=0;first.onclick=()=>invoked++
panel.append(first,disabled,last,select,keep)
trigger.focus();trigger.emit('click')
assert.equal(panel.hidden,false);assert.equal(panel.popoverOpen,true)
assert.equal(trigger.getAttribute('aria-expanded'),'true')
assert.equal(panel.parent,menu.element)
assert.ok(Number.parseFloat(panel.style.left)+240<=992)
assert.ok(Number.parseFloat(panel.style.top)+200<=592)
assert.equal(panel.getAttribute('role'),'group')
menu.setLabel('Clip actions');assert.equal(panel.getAttribute('aria-label'),'Clip actions')

const arrow=trigger.emit('keydown',{key:'ArrowDown'})
assert.equal(arrow.defaultPrevented,true);assert.equal(documentFixture.activeElement,first)
panel.emit('keydown',{target:first,key:'ArrowDown'});assert.equal(documentFixture.activeElement,last)
panel.emit('keydown',{target:last,key:'End'});assert.equal(documentFixture.activeElement,keep)
const space=panel.emit('keydown',{target:keep,key:' '});assert.equal(space.stopped,true);assert.equal(space.defaultPrevented,false)
const enter=trigger.emit('keydown',{key:'Enter'});assert.equal(enter.stopped,true);assert.equal(enter.defaultPrevented,false)
for(const command of [{metaKey:true},{ctrlKey:true},{metaKey:true,shiftKey:true}]){
    assert.equal(trigger.emit('keydown',{key:'z',...command}).stopped,false)
    assert.equal(panel.emit('keydown',{target:first,key:'z',...command}).stopped,false)
}
assert.equal(panel.emit('keydown',{target:select,key:'z',metaKey:true}).stopped,true)
const selectArrow=panel.emit('keydown',{target:select,key:'ArrowDown'});assert.equal(selectArrow.defaultPrevented,false)
panel.emit('click',{target:select});assert.equal(panel.hidden,false)
panel.emit('click',{target:keep});assert.equal(panel.hidden,false)

first.focus();first.onclick!();panel.emit('click',{target:first})
assert.equal(invoked,1);assert.equal(panel.hidden,true);assert.equal(documentFixture.activeElement,trigger)
trigger.emit('keydown',{key:'ArrowUp'});assert.equal(documentFixture.activeElement,keep)
const escape=documentFixture.emit('keydown',{target:keep,key:'Escape'})
assert.equal(escape.defaultPrevented,true);assert.equal(escape.stopped,true);assert.equal(panel.hidden,true)
assert.equal(documentFixture.activeElement,trigger)
assert.equal(documentFixture.options.get('keydown'),true)

trigger.emit('click',{detail:0});assert.equal(documentFixture.activeElement,first)
const outside=new ElementFixture('button');documentFixture.body.append(outside)
outside.focus();assert.equal(panel.hidden,true);assert.equal(documentFixture.activeElement,outside)
trigger.emit('click');documentFixture.emit('pointerdown',{target:outside});assert.equal(panel.hidden,true)
// Capture-phase Escape must allow a time field to cancel its draft before blur/change.
const input=new ElementFixture('input');panel.append(input)
let draft='12.500',committed='10.000'
trigger.emit('click');input.focus()
input.addEventListener('keydown',event=>{if(event.key==='Escape'){draft=committed;documentFixture.activeElement=documentFixture.body;input.emit('change')}})
input.addEventListener('change',()=>{committed=draft})
const fieldEscape=documentFixture.emit('keydown',{target:input,key:'Escape'})
assert.equal(fieldEscape.stopped,false);assert.equal(panel.hidden,false)
input.emit('keydown',{key:'Escape'})
await Promise.resolve()
assert.equal(committed,'10.000');assert.equal(panel.hidden,true);assert.equal(documentFixture.activeElement,trigger)
trigger.emit('click');const second=createToolbarMenu('Import');documentFixture.body.append(second.element as any)
;(second.trigger as unknown as ElementFixture).emit('click');assert.equal(panel.hidden,true);assert.equal(second.panel.hidden,false)
second.dispose();assert.equal(second.panel.hidden,true)

// An action opening a dialog keeps the focus chosen by that action.
trigger.emit('click');first.focus();documentFixture.activeElement=outside
panel.emit('click',{target:first});assert.equal(documentFixture.activeElement,outside)
trigger.emit('click');windowFixture.emit('resize');assert.equal(frames.size,1)
menu.dispose();assert.equal(panel.hidden,true);assert.equal(frames.size,0)
trigger.emit('click');assert.equal(panel.hidden,true)

// Browsers without Popover retain the same disclosure behavior and DOM position.
const originalShow=ElementFixture.prototype.showPopover
ElementFixture.prototype.showPopover=undefined as any
const host=new ElementFixture('div');host.className='flowtu-bar';documentFixture.body.append(host)
const fallback=createToolbarMenu('File');host.append(fallback.element as any)
;(fallback.trigger as unknown as ElementFixture).emit('click')
assert.equal(fallback.panel.dataset.placement,'fallback');assert.equal(fallback.panel.hidden,false)
assert.equal(host.classList.contains('flowtu-menu-fallback-open'),true)
fallback.close();assert.equal(host.classList.contains('flowtu-menu-fallback-open'),false)
;(fallback.trigger as unknown as ElementFixture).emit('click')
assert.equal(host.classList.contains('flowtu-menu-fallback-open'),true)
fallback.dispose();assert.equal(host.classList.contains('flowtu-menu-fallback-open'),false)
ElementFixture.prototype.showPopover=originalShow
console.log('TOOLBAR_MENU_OK: retained actions, popover, viewport clamp, focus, keyboard, fields, outside, exclusivity, disposal, fallback')
