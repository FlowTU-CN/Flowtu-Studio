import assert from 'node:assert/strict'

// An isolated event-contract fixture, not browser automation or a layout/visual test.
// It exercises the real helper against only the DOM surface that helper consumes.
type Callback = (event: Record<string, unknown>) => void
class EventTargetFixture {
    listeners = new Map<string, Set<Callback>>()
    addEventListener(name: string, callback: Callback) {const entries=this.listeners.get(name)??new Set();entries.add(callback);this.listeners.set(name,entries)}
    removeEventListener(name: string, callback: Callback) {this.listeners.get(name)?.delete(callback)}
    emit(name: string, overrides: Record<string, unknown> = {}) {
        const event = {target:this,button:0,isPrimary:true,pointerId:7,clientX:100,clientY:100,shiftKey:false,defaultPrevented:false,stopped:false,
            preventDefault(){this.defaultPrevented=true},stopPropagation(){this.stopped=true},...overrides}
        for (const callback of this.listeners.get(name)??[]) callback(event)
        return event
    }
}
const windowFixture = Object.assign(new EventTargetFixture(), {innerWidth:1280,innerHeight:900})
class ElementFixture extends EventTargetFixture {
    children:ElementFixture[]=[]
    parent?:ElementFixture
    style:Record<string,string>={}
    hidden=false
    attributes:Record<string,string>={}
    classes=new Set<string>()
    classList={add:(...values:string[])=>values.forEach(value=>this.classes.add(value)),remove:(...values:string[])=>values.forEach(value=>this.classes.delete(value)),contains:(value:string)=>this.classes.has(value)}
    captures=new Set<number>()
    onclick?:()=>void
    currentTime=23.5
    playbackRate=1.015
    paused=false
    src='blob:reference-video'
    constructor(readonly tag:string){super()}
    set className(value:string){this.classes=new Set(value.split(' '))}
    get className(){return Array.from(this.classes).join(' ')}
    append(...children:ElementFixture[]){children.forEach(child=>{child.parent=this;this.children.push(child)})}
    prepend(child:ElementFixture){child.parent=this;this.children.unshift(child)}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=undefined}
    setAttribute(name:string,value:string){this.attributes[name]=value}
    querySelector(selector:string):ElementFixture|undefined{
        for(const child of this.children){if(selector.startsWith('.')?child.classes.has(selector.slice(1)):child.tag===selector)return child;const nested=child.querySelector(selector);if(nested)return nested}
    }
    closest(selector:string):ElementFixture|undefined{
        if(selector.split(',').includes(this.tag))return this
        return this.parent?.closest(selector)
    }
    focus(){documentFixture.activeElement=this}
    setPointerCapture(id:number){this.captures.add(id)}
    hasPointerCapture(id:number){return this.captures.has(id)}
    releasePointerCapture(id:number){this.captures.delete(id);this.emit('lostpointercapture',{pointerId:id})}

}
const documentFixture={activeElement:undefined as ElementFixture|undefined,createElement:(tag:string)=>new ElementFixture(tag)}
const values=new Map<string,string>()
let denyStorage=false
const storage={getItem:(key:string)=>{if(denyStorage)throw new Error('Storage disabled');return values.get(key)??null},setItem:(key:string,value:string)=>{if(denyStorage)throw new Error('Storage disabled');values.set(key,value)}}
Object.assign(globalThis,{window:windowFixture,document:documentFixture,Element:ElementFixture,HTMLElement:ElementFixture,localStorage:storage})
const {installFloatingVideo}=await import('../src/flowtu/FloatingVideo')
const layoutKey='flowtu.referenceVideo.layout.v1'
storage.setItem(layoutKey,JSON.stringify({x:80,y:90,width:400}))
const createPanel=()=>{
    const panel=new ElementFixture('aside'),header=new ElementFixture('header'),title=new ElementFixture('strong'),close=new ElementFixture('button'),video=new ElementFixture('video')
    header.append(title,close);panel.append(header,video);panel.hidden=true
    return {panel,header,title,close,video}
}
const coordinates=(panel:ElementFixture)=>({x:Number.parseFloat(panel.style.left),y:Number.parseFloat(panel.style.top),width:Number.parseFloat(panel.style.width),height:Number.parseFloat(panel.style.height)})
const {panel,header,title,close,video}=createPanel()
const helper=installFloatingVideo(panel as unknown as HTMLElement)
helper.reveal()
assert.equal(panel.hidden,false)
assert.deepEqual(coordinates(panel),{x:80,y:90,width:400,height:379})
const media={currentTime:video.currentTime,playbackRate:video.playbackRate,paused:video.paused,src:video.src}

const down=header.emit('pointerdown',{target:title})
assert.equal(down.defaultPrevented,true);assert.equal(header.hasPointerCapture(7),true)
assert.equal(panel.classList.contains('is-dragging'),true)
header.emit('pointermove',{clientX:260,clientY:220})
assert.deepEqual(coordinates(panel),{x:240,y:210,width:400,height:379})
header.emit('pointerup',{clientX:260,clientY:220})
assert.equal(header.hasPointerCapture(7),false)
assert.equal(panel.classList.contains('is-dragging'),false)
assert.deepEqual(JSON.parse(storage.getItem(layoutKey)!),coordinates(panel))

// The close control must remain clickable, never start a titlebar drag.
const beforeControl=coordinates(panel)
header.emit('pointerdown',{target:close});header.emit('pointermove',{clientX:800,clientY:600});header.emit('pointerup')
assert.deepEqual(coordinates(panel),beforeControl)
assert.equal(header.hasPointerCapture(7),false)

// Cancelled pointer gestures restore the original layout and clear capture.
header.emit('pointerdown',{target:title});header.emit('pointermove',{clientX:40,clientY:50})
assert.notDeepEqual(coordinates(panel),beforeControl)
header.emit('pointercancel')
assert.deepEqual(coordinates(panel),beforeControl);assert.equal(header.hasPointerCapture(7),false)

const resize=panel.querySelector('.floating-video-resize')!
resize.emit('pointerdown');resize.emit('pointermove',{clientX:260,clientY:190});resize.emit('pointerup')
assert.equal(coordinates(panel).width,560)
assert.equal(panel.classList.contains('is-resizing'),false)
panel.emit('keydown',{target:header,key:'ArrowLeft'})
assert.equal(coordinates(panel).x,230)
panel.emit('keydown',{target:header,key:'ArrowRight',shiftKey:true})
assert.equal(coordinates(panel).x,270)
panel.emit('keydown',{target:resize,key:'ArrowUp'})
assert.equal(coordinates(panel).width,560)
assert.equal(coordinates(panel).height,459)
assert.equal(panel.querySelector('video'),video)
assert.deepEqual({currentTime:video.currentTime,playbackRate:video.playbackRate,paused:video.paused,src:video.src},media)

const persisted=coordinates(panel)
helper.dispose()
assert.equal(panel.querySelector('.floating-video-resize'),undefined)
const restored=createPanel(),restoredHelper=installFloatingVideo(restored.panel as unknown as HTMLElement)
restoredHelper.reveal()
assert.deepEqual(coordinates(restored.panel),persisted)
windowFixture.innerWidth=340;windowFixture.innerHeight=500;windowFixture.emit('resize')
assert.ok(coordinates(restored.panel).width<=320)
assert.ok(coordinates(restored.panel).x+coordinates(restored.panel).width<=330)
assert.ok(coordinates(restored.panel).y>=10)
const afterResize=coordinates(restored.panel)
restoredHelper.dispose();windowFixture.innerWidth=900;windowFixture.emit('resize')
assert.deepEqual(coordinates(restored.panel),afterResize)

// Embedded/private sessions may reject storage; moving is still functional.
denyStorage=true
const privatePanel=createPanel(),privateHelper=installFloatingVideo(privatePanel.panel as unknown as HTMLElement)
privateHelper.reveal();privatePanel.header.emit('pointerdown',{target:privatePanel.title});privatePanel.header.emit('pointermove',{clientX:20,clientY:20});privatePanel.header.emit('pointerup')
privateHelper.reset();privateHelper.dispose()
console.log('FLOATING_VIDEO_EVENTS_OK: capture, drag, controls, cancel, resize, keyboard, persistence, viewport, disposal, media identity')
