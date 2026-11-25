import assert from 'node:assert/strict'
import {installVideoWindow} from '../src/flowtu/VideoWindow'

// Event and rendering adapters only. The production controller owns the media node,
// popup lifecycle, callbacks and synchronization scheduling exercised below.
class Target {
    listeners = new Map<string, Set<(event: any) => void>>()
    addEventListener(name: string, fn: (event: any) => void) {const set=this.listeners.get(name)??new Set();set.add(fn);this.listeners.set(name,set)}
    removeEventListener(name: string, fn: (event: any) => void) {this.listeners.get(name)?.delete(fn)}
    emit(name: string, args: Record<string, unknown> = {}) {
        const event = {target:this,key:'',code:'',defaultPrevented:false,isComposing:false,altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,repeat:false,stopped:false,
            composedPath(){return [this.target]},preventDefault(){this.defaultPrevented=true},stopImmediatePropagation(){this.stopped=true},...args}
        for(const fn of [...this.listeners.get(name)??[]])fn(event)
        return event
    }
}
class ElementFixture extends Target {
    parentElement: ElementFixture|null=null
    children: ElementFixture[]=[]
    classes=new Set<string>()
    classList={contains:(name:string)=>this.classes.has(name)}
    attributes:Record<string,string>={}
    dataset:Record<string,string>={}
    textContent='';type='';onclick?:()=>void
    constructor(readonly tagName:string,public ownerDocument: DocumentFixture){super()}
    setAttribute(name:string,value:string){this.attributes[name]=value}
    adopt(doc:DocumentFixture){this.ownerDocument=doc;this.children.forEach(child=>child.adopt(doc))}
    append(...children:ElementFixture[]){for(const child of children){if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(value=>value!==child);child.parentElement=this;child.adopt(this.ownerDocument);this.children.push(child)}}
    replaceChildren(...children:ElementFixture[]){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children)}
    closest(selector:string):ElementFixture|null{return selector.split(',').includes(this.tagName)?this:this.parentElement?.closest(selector)??null}
    async requestFullscreen(){this.ownerDocument.fullscreenElement=this}
}
class VideoFixture extends ElementFixture {
    src='';currentTime=0;paused=true;muted=false;playsInline=false;preload='';loads=0
    pause(){this.paused=true}
    load(){this.loads++}
    removeAttribute(name:string){if(name==='src')this.src=''}
}
class DocumentFixture extends Target {
    head=new ElementFixture('head',this);body=new ElementFixture('body',this)
    title='';hidden=false;fullscreenElement:ElementFixture|null=null
    constructor(readonly defaultView:WindowFixture){super()}
    querySelector(){return null}
    createElement(tag:string){return tag==='video'?new VideoFixture(tag,this):new ElementFixture(tag,this)}
    async exitFullscreen(){this.fullscreenElement=null}
}
class WindowFixture extends Target {
    document=new DocumentFixture(this)
    screen={availWidth:1440,availHeight:875,availLeft:20,availTop:25}
    screenX=45;screenY=90;outerWidth=680;outerHeight=470
    resizeTo(width:number,height:number){this.outerWidth=width;this.outerHeight=height}
    moveTo(x:number,y:number){this.screenX=x;this.screenY=y}
    intervals=new Map<number,()=>void>();sequence=0
    closed=false;focuses=0;closeCalls=0
    opens:WindowFixture[]=[];blocked=false;denyDocument=false
    open(_url:string,_target:string,features:string){assert.match(features,/popup/);if(this.blocked)return null;const win=new WindowFixture();if(this.denyDocument)Object.defineProperty(win,'document',{get(){throw new Error('No popup DOM access')}});this.opens.push(win);return win}
    focus(){this.focuses++}
    close(){this.closeCalls++;this.emit('beforeunload');this.closed=true;this.emit('pagehide')}
    setInterval(fn:()=>void){const id=++this.sequence;this.intervals.set(id,fn);return id}
    clearInterval(id:number){this.intervals.delete(id)}
    advancePoll(){for(const fn of this.intervals.values())fn()}
}
const parent=new WindowFixture(),home=new ElementFixture('section',parent.document),otherHome=new ElementFixture('section',parent.document)
parent.document.body.append(home,otherHome)
const video=Object.assign(new VideoFixture('video',parent.document),{src:'blob:local-reference',currentTime:12.5,paused:false,muted:true})
home.append(video)
let restoreHost=home,restores=0,plays=0,stops=0,marks=0,starts=0
const messages:string[]=[],changes:boolean[]=[]
const frameOwners:Array<WindowFixture|null>=[]
let mounted=0,unmounted=0,returnFromMonitor:()=>void
const controller=installVideoWindow({video:video as never,
    attachTransport(doc, target, _full, dock) {
        assert.equal(target,doc.body);returnFromMonitor=dock;mounted++
        return {dispose(){unmounted++}}
    },
    restore(){restores++;restoreHost.append(video)},onChange(open){changes.push(open)},togglePlayback(){plays++},stopPlayback(){stops++},
    markCue(){marks++;return true},macOS:true,returnToStart(){starts++},
    tell(message){messages.push(message)},setFrameWindow:owner=>frameOwners.push(owner as unknown as WindowFixture|null)})
parent.blocked=true
assert.equal(controller.open(),false)
assert.equal(video.parentElement,home);assert.equal(restores,0);assert.deepEqual(changes,[])
assert.match(messages.at(-1)!,/Allow pop-up/)
parent.blocked=false
assert.equal(controller.open(),true)
const first=parent.opens[0],picture=controller.picture as unknown as VideoFixture,firstStage=picture.parentElement!
assert.equal(controller.isOpen(),true);assert.equal(picture.ownerDocument,first.document)
assert.equal(firstStage.tagName,'main');assert.equal(firstStage.children[0],picture)
assert.equal(video.parentElement,home);assert.equal(video.ownerDocument,parent.document)
assert.equal(video.currentTime,12.5);assert.equal(video.paused,true)
assert.equal(picture.src,video.src);assert.equal(picture.muted,true);assert.equal(picture.playsInline,true)
assert.deepEqual(changes,[true])
assert.equal(mounted,1)
assert.equal(frameOwners.at(-1),first)
parent.document.hidden=true;parent.document.emit('visibilitychange')
assert.equal(frameOwners.at(-1),first,'Hiding the studio must not move engine updates back to its suspended RAF')
first.document.hidden=true;first.document.emit('visibilitychange')
assert.equal(frameOwners.at(-1),null,'A hidden video window releases the shared frame driver')
first.document.hidden=false;first.document.emit('visibilitychange')
assert.equal(frameOwners.at(-1),first)
assert.equal(controller.open(),true);assert.equal(parent.opens.length,1);assert.equal(first.focuses,2)
controller.fullscreen();assert.equal(first.document.fullscreenElement,first.document.body)
assert.equal(first.emit('keydown',{key:'Escape'}).defaultPrevented,false)
controller.fullscreen();assert.equal(first.document.fullscreenElement,null)
first.document.body.requestFullscreen=async()=>{throw Error('not granted')}
await controller.fullscreen()
assert.deepEqual([first.screenX,first.screenY,first.outerWidth,first.outerHeight],[20,25,1440,875])
assert.equal(first.document.body.dataset.videoMaximized,'true')
await controller.fullscreen()
assert.deepEqual([first.screenX,first.screenY,first.outerWidth,first.outerHeight],[45,90,680,470])
assert.equal(first.document.body.dataset.videoMaximized,undefined)
assert.equal(first.emit('keydown',{key:' ',code:'Space'}).defaultPrevented,true);assert.equal(plays,1)
first.emit('keydown',{key:' ',code:'Space',repeat:true});assert.equal(plays,1)
for(const modifiers of [{metaKey:true},{ctrlKey:true},{altKey:true},{shiftKey:true},{isComposing:true}])assert.equal(first.emit('keydown',{key:' ',code:'Space',...modifiers}).defaultPrevented,false)
assert.equal(first.emit('keydown',{key:' ',code:'Space',target:new ElementFixture('input',first.document)}).defaultPrevented,false)
assert.equal(plays,1);first.emit('keydown',{key:'.'});assert.equal(stops,1)
first.emit('keydown',{key:'ArrowLeft',metaKey:true,target:new ElementFixture('input',first.document)})
assert.equal(starts,0)
assert.equal(first.emit('keydown',{key:'ArrowLeft',metaKey:true}).defaultPrevented,true)
assert.equal(starts,1)
assert.equal(first.emit('keydown',{key:'m',code:'KeyM'}).defaultPrevented,true)
assert.equal(first.emit('keydown',{key:'m',repeat:true}).defaultPrevented,true)
for(const flags of [{metaKey:true},{ctrlKey:true},{shiftKey:true},{altKey:true},{isComposing:true},{keyCode:229}]) {
    assert.equal(first.emit('keydown',{key:'m',...flags}).defaultPrevented,false)
}
first.emit('keydown',{key:'m',target:new ElementFixture('input',first.document)})
assert.equal(marks,1)
const seekField = new ElementFixture('input',first.document)
seekField.classes.add('ft-score-seek')
assert.equal(first.emit('keydown',{key:'m',target:seekField}).defaultPrevented,true)
assert.equal(marks,2)
// Returning follows the workspace's latest dock, not whichever host was active when opening.
restoreHost=otherHome
returnFromMonitor!()
assert.equal(unmounted,1)
assert.equal(controller.isOpen(),false);assert.equal(first.closed,true);assert.equal(first.closeCalls,1)
assert.equal(video.parentElement,otherHome);assert.equal(video.ownerDocument,parent.document)
assert.equal(picture.src,'');assert.equal(picture.loads,1);assert.equal(controller.picture,undefined)
assert.equal(restores,1);assert.deepEqual(changes,[true,false]);assert.equal(parent.intervals.size,0)
assert.equal(first.listeners.get('keydown')?.size,0)
assert.equal(frameOwners.at(-1),null)
assert.equal(first.document.listeners.get('visibilitychange')?.size,0)
assert.equal(parent.document.listeners.get('visibilitychange')?.size,0)
controller.dock();assert.equal(restores,1)
assert.equal(video.currentTime,12.5);assert.equal(video.src,'blob:local-reference');assert.equal(video.loads,0)

// Closing the native window returns the element, and polling covers missed unload events.
controller.open();const second=parent.opens[1]
second.close();assert.equal(restores,2);assert.equal(video.parentElement,otherHome);assert.equal(controller.isOpen(),false)
controller.open();const third=parent.opens[2]
third.closed=true;parent.advancePoll();assert.equal(restores,3);assert.equal(controller.isOpen(),false)
assert.equal(parent.intervals.size,0)
controller.open();const fourth=parent.opens[3]
controller.dispose();controller.dispose()
assert.equal(fourth.closed,true);assert.equal(controller.isOpen(),false);assert.equal(restores,3,'Unload disposal must not remount UI')
assert.equal(parent.intervals.size,0)
assert.equal(frameOwners.at(-1),null,'Disposal restores the regular engine frame owner too')
assert.equal(controller.open(),false)

// A window that exists but denies DOM access must be closed and leave local playback usable.
const failedParent=new WindowFixture();failedParent.denyDocument=true
const failedHome=new ElementFixture('section',failedParent.document),failedVideo=new ElementFixture('video',failedParent.document)
failedHome.append(failedVideo)
const failed=installVideoWindow({video:failedVideo as never,attachTransport(){throw Error("unreachable")},restore:()=>failedHome.append(failedVideo),onChange(){},togglePlayback(){},tell:message=>messages.push(message)})
assert.equal(failed.open(),false);assert.equal(failedParent.opens[0].closed,true);assert.equal(failedVideo.parentElement,failedHome)
assert.match(messages.at(-1)!,/desktop browser/)
console.log('VIDEO_WINDOW_OK')
