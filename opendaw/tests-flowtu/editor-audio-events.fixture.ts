import assert from 'node:assert/strict'
Reflect.set(globalThis,'AudioWorkletNode',class {})
const {Option,Terminable,UUID}=await import('@opendaw/lib-std')
const {PPQN}=await import('@opendaw/lib-dsp')
const {ProjectSkeleton,InstrumentFactories,AudioRegionBoxAdapter,AudioClipBoxAdapter,TrackBoxAdapter}=await import('@opendaw/studio-adapters')
const {AudioFileBox}=await import('@opendaw/studio-boxes')
const {Project,AudioContentFactory}=await import('@opendaw/studio-core')
const env={audioContext:{currentTime:0,sampleRate:48000,createGain:()=>({connect(){},disconnect(){},gain:{value:1}}),createStereoPanner:()=>({connect(){},disconnect(){},pan:{value:0}})},audioWorklets:undefined,sampleManager:{getOrCreate:(uuid:unknown)=>({get data(){return Option.None},get peaks(){return Option.None},get uuid(){return uuid},get state(){return {type:'idle'}},invalidate(){},subscribe:()=>Terminable.Empty}),record(){},invalidate(){},remove(){},register:()=>Terminable.Empty},soundfontManager:undefined,sampleService:undefined,soundfontService:undefined} as never
const project=Project.fromSkeleton(env,ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}))
const Q=PPQN.Quarter
const {track,a,b,clip}=project.editing.modify(()=>{
 const {trackBox}=project.api.createInstrument(InstrumentFactories.Tape)
 const file=AudioFileBox.create(project.boxGraph,UUID.generate(),box=>{box.fileName.setValue('Editor events');box.startInSeconds.setValue(0);box.endInSeconds.setValue(8)})
 const props={boxGraph:project.boxGraph,targetTrack:trackBox,audioFileBox:file,sample:{name:'Audio',duration:4,bpm:0} as never}
 const create=(position:number)=>project.boxAdapters.adapterFor(AudioContentFactory.createNotStretchedRegion({...props,position}),AudioRegionBoxAdapter)
 const clip=project.boxAdapters.adapterFor(AudioContentFactory.createNotStretchedClip({...props,index:0}),AudioClipBoxAdapter)
 return {track:project.boxAdapters.adapterFor(trackBox,TrackBoxAdapter),a:create(0),b:create(10*Q),clip}
},true).unwrap()

// Event-contract fixture only. It invokes the real helper against its minimal DOM surface;
// actual mutations, region selection and undo remain the native project graph.
type Callback=(event:Record<string,unknown>)=>void
class TargetFixture {
 listeners=new Map<string,Set<Callback>>()
 addEventListener(type:string,callback:Callback){const set=this.listeners.get(type)??new Set();set.add(callback);this.listeners.set(type,set)}
 removeEventListener(type:string,callback:Callback){this.listeners.get(type)?.delete(callback)}
 emit(type:string,overrides:Record<string,unknown>={}){
  const event={target:this,key:'',code:'',metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,isComposing:false,defaultPrevented:false,stopped:false,button:0,pointerId:1,clientX:0,clientY:80,
   preventDefault(){this.defaultPrevented=true},stopImmediatePropagation(){this.stopped=true},stopPropagation(){this.stopped=true},...overrides}
  for(const listener of this.listeners.get(type)??[])listener(event)
  return event
 }
}
class ElementFixture extends TargetFixture {
 parentElement:ElementFixture|null=null
 children:ElementFixture[]=[]
 dataset:Record<string,string>={}
 style:Record<string,string>={}
 attributes:Record<string,string>={}
 className='';hidden=false;textContent='';title=''
 classes=new Set<string>()
 classList={add:(...values:string[])=>values.forEach(value=>this.classes.add(value)),remove:(...values:string[])=>values.forEach(value=>this.classes.delete(value))}
 captures=new Set<number>()
 constructor(readonly tag:string){super()}
 append(...children:ElementFixture[]){children.forEach(child=>{child.parentElement=this;this.children.push(child)})}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null}
 setAttribute(key:string,value:string){this.attributes[key]=value}
 closest(selector:string):ElementFixture|null{
  if(selector==='[data-scope=content-editor]'&&this.dataset.scope==='content-editor')return this
  if(selector.startsWith('.')&&this.classes.has(selector.slice(1)))return this
  if(selector.split(',').includes(this.tag))return this
  if(selector.includes('[role=slider]')&&this.attributes.role==='slider')return this
  return this.parentElement?.closest(selector)??null
 }
 focus(){documentFixture.activeElement=this}
 getBoundingClientRect(){return {left:0,top:0,width:1000,height:180}}
 setPointerCapture(id:number){this.captures.add(id)}
 hasPointerCapture(id:number){return this.captures.has(id)}
 releasePointerCapture(id:number){this.captures.delete(id);this.emit('lostpointercapture',{pointerId:id})}
}
let dialogOpen=false, videoMode=false
const documentFixture={documentElement:{classList:{contains:(value:string)=>value==='ft-video-mode' && videoMode}},activeElement:undefined as ElementFixture|undefined,createElement:(tag:string)=>new ElementFixture(tag),querySelector:(selector:string)=>selector==='dialog[open]'&&dialogOpen?new ElementFixture('dialog'):null}
const windowFixture=new TargetFixture()
Object.assign(globalThis,{Element:ElementFixture,HTMLElement:ElementFixture,window:windowFixture,document:documentFixture})
const {installAudioEditorTools}=await import('../src/flowtu/editor-audio')
const {editingTool}=await import('../src/flowtu/editing-state')
const {getAudioRange,clearAudioRange,installRangeSelection}=await import('../src/flowtu/RangeSelection')
const panel=new ElementFixture('section');panel.dataset.scope='content-editor'
const wrapper=new ElementFixture('div'),canvas=new ElementFixture('canvas'),marker=new ElementFixture('canvas'),text=new ElementFixture('input')
wrapper.append(canvas);panel.append(wrapper,marker,text)
const range={unitMax:20*Q,unitsPerPixel:10,unitToX:(value:number)=>value/10,xToUnit:(value:number)=>value*10,subscribe:()=>Terminable.Empty} as never
const {Snapping}=await import('../src/ui/timeline/Snapping')
const snapping=new Snapping(range);snapping.enabled=false
const helper=installAudioEditorTools(canvas as never,project,range,snapping,{audioContent:a} as never)
const count=()=>track.regions.collection.asArray().length
const baselineOther=[b.position,b.duration,b.loopOffset]
project.editing.modify(()=>{project.regionSelection.deselectAll();project.regionSelection.select(b);project.timelineFocus.focusRegion(b)},true)
editingTool.setValue('select')
for(const [target,key,modifiers] of [
 [marker,'b',{}],[marker,'Delete',{}],[marker,'b',{metaKey:true}],
 [marker,'c',{metaKey:true}],[marker,'a',{metaKey:true}],[marker,'d',{ctrlKey:true}],[text,'b',{}],[text,'Delete',{}],[text,'a',{metaKey:true}],[text,'d',{ctrlKey:true}]
] as const){
 const event=panel.emit('keydown',{target,key,...modifiers})
 assert.equal(event.defaultPrevented,false);assert.equal(event.stopped,false)
 assert.equal(editingTool.getValue(),'select');assert.equal(count(),2)
}
// Native playback, undo, redo and arrow handlers must still receive these keys.
for(const [key,modifiers] of [[' ',{}],['ArrowLeft',{}],['ArrowUp',{}],['z',{metaKey:true}],['z',{metaKey:true,shiftKey:true}]] as const){
 assert.equal(panel.emit('keydown',{target:canvas,key,...modifiers}).defaultPrevented,false)
}
dialogOpen=true
assert.equal(panel.emit('keydown',{target:canvas,key:'b'}).defaultPrevented,false)
dialogOpen=false
assert.equal(panel.emit('keydown',{target:canvas,key:'b',isComposing:true}).defaultPrevented,false)
assert.equal(editingTool.getValue(),'select')

// Clip references and edit ranges share a timeline, with destructive audio operations kept lane-scoped.
const {getTimelineSelection, setTimelineSelection, rememberTimelineSelection, loopTimelineSelection} = await import('../src/flowtu/timeline-selection')
project.regionSelection.select(a)
assert.deepEqual(getTimelineSelection(project), {start:a.position,end:b.complete})
assert.equal(getAudioRange(project), undefined)
setTimelineSelection(project, {start:2*Q,end:3*Q}, track)
const restoreSelection = rememberTimelineSelection(project)
setTimelineSelection(project, {start:Q,end:2*Q})
assert.equal(getAudioRange(project), undefined)
const seekBeforeLoop = project.engine.setPosition
let loopSeek = -1
project.engine.setPosition = pulse => {loopSeek = pulse}
assert.equal(loopTimelineSelection(project), true)
const loop = project.timelineBox.loopArea
assert.deepEqual([loop.from.getValue(),loop.to.getValue(),loop.enabled.getValue(),loopSeek], [Q,2*Q,true,Q])
project.engine.setPosition = seekBeforeLoop
restoreSelection()
assert.equal(getAudioRange(project)?.track, track)
assert.equal(getTimelineSelection(project)?.end, 3*Q)
clearAudioRange(project)
assert.equal(getTimelineSelection(project), undefined)
assert.equal(loopTimelineSelection(project), false)
project.regionSelection.deselect(a)
assert.deepEqual(getTimelineSelection(project), {start:b.position,end:b.complete})
project.editing.modify(()=>{b.position += Q},true)
assert.deepEqual(getTimelineSelection(project), {start:b.position,end:b.complete})
project.editing.undo()

// Both waveform surfaces locate the first selected frame only upon committing a stopped video edit.
const {displayTrack, playbackLanes} = await import('../src/flowtu/playback-lanes')
const arrangement = new ElementFixture('div')
const arrangementResources:{terminate():void}[]=[]
const manager = {displayTrack, playbackLanes, localToIndex:()=>0,
 tracks: () => [{trackBoxAdapter:track,audioUnitBoxAdapter:Option.None,position:0,size:150}],
 scrollableContainer:Object.assign(new TargetFixture(),{scrollTop:0,scrollHeight:360})}
const {RegionCapturing} = await import('../src/ui/timeline/tracks/audio-unit/regions/RegionCapturing')
const capturing = RegionCapturing.create(arrangement as never, manager as never, range, project.audioUnitFreeze)
const partAt = (x:number, y:number) => {
 const result = capturing.captureLocalPoint(x,y)
 return result?.type === "region" ? result.part : result?.type
}
const middleX = Q/10
assert.equal(partAt(middleX,15),'position')
assert.equal(partAt(middleX,35),'position') // remain in move strip through small hand jitter
assert.equal(partAt(middleX,41),'range')
assert.equal(partAt(middleX,33),'range')
assert.equal(partAt(2,65),'start')
assert.equal(partAt(8*Q/10-2,65),'complete')
assert.equal(partAt(9*Q/10,65),'track')
installRangeSelection(arrangement as never,{project,timeline:{snapping}} as never,capturing,range,manager as never,
 {own:(resource:{terminate():void})=>{arrangementResources.push(resource)}} as never)
const locations:number[]=[]
const originalSeek = project.engine.setPosition
project.engine.setPosition = pulse => { locations.push(pulse) }
const playing = project.engine.isPlaying as unknown as {setValue(value:boolean):void}
editingTool.setValue('range')
for (const waveform of [arrangement, canvas]) {
 for (const [video, playback, cancel, expected] of [
  [true,false,false,[Q]], [true,true,false,[]], [false,false,false,[]], [true,false,true,[]]
 ] as const) {
  locations.length=0; videoMode=video; playing.setValue(playback)
  waveform.emit('pointerdown',{clientX:3*Q/10})
  windowFixture.emit('pointermove',{clientX:Q/10})
  assert.deepEqual(locations,[])
  windowFixture.emit(cancel?'pointercancel':'pointerup',{clientX:Q/10})
  assert.deepEqual(locations,expected)
 }
}
playing.setValue(false); videoMode=false
project.engine.setPosition=originalSeek
arrangementResources.forEach(resource=>resource.terminate())
// Both split shortcuts operate on the drawn interval while keeping the current tool and focused editor.
for (const modifiers of [{}, {metaKey: true}]) {
    editingTool.setValue('range')
    canvas.emit('pointerdown', {clientX: 5*Q/10})
    windowFixture.emit('pointermove', {clientX: 2*Q/10})
    windowFixture.emit('pointerup', {clientX: 2*Q/10})
    assert.equal(getAudioRange(project)?.track, track)
    assert.equal(panel.emit('keydown', {key:'b', target:text, ...modifiers}).defaultPrevented, false)
    assert.equal(count(), 2)

    const key = panel.emit('keydown', {key:'b', target:canvas, ...modifiers})
    assert.equal(key.defaultPrevented, true)
    const regions = track.regions.collection.asArray()
    assert.deepEqual(regions.map(r => [r.position/Q, r.complete/Q]), [[0,2], [2,5], [5,8], [10,18]])
    const middle = regions[1]
    assert.deepEqual(project.regionSelection.selected(), [middle])
    assert.equal(project.userEditingManager.timeline.get().unwrap().box, middle.box)
    assert.deepEqual(getTimelineSelection(project), {start:2*Q, end:5*Q})
    assert.equal(editingTool.getValue(), 'range')
    panel.emit('keydown', {key:'b', target:canvas, repeat:true})
    assert.equal(editingTool.getValue(), 'range')
    assert.equal(count(), 4)
    project.editing.undo()
    assert.deepEqual(track.regions.collection.asArray().map(r => [r.position/Q,r.complete/Q]), [[0,8],[10,18]])
}

// The same control point is draggable in the lower waveform. Only the chosen edge changes.
project.editing.modify(()=>{a.fading.inField.setValue(2*Q); a.fading.outField.setValue(2*Q)},true)
for (const [side, x, tool] of [['in',Q/10,'select'],['out',7*Q/10,'fade']] as const) {
    editingTool.setValue(tool)
    const snapshot = () => [a.fading.in, a.fading.out, a.fading.inSlope, a.fading.outSlope]
    const before = snapshot()
    const down = () => canvas.emit('pointerdown',{clientX:x, clientY:45})
    down()
    windowFixture.emit('pointermove',{clientX:x, clientY:90})
    assert.deepEqual(snapshot(),[2*Q,2*Q,side === 'in' ? .5 : .75,side === 'out' ? .5 : .25])
    windowFixture.emit('pointercancel',{clientX:x,clientY:90})
    assert.deepEqual(snapshot(),before)
    down()
    windowFixture.emit('pointerup',{clientX:x,clientY:90})
    assert.equal(side === 'in' ? a.fading.inSlope : a.fading.outSlope,.5)
    project.editing.undo()
    assert.deepEqual(snapshot(),before)
}
project.editing.undo()
editingTool.setValue('range')

// A freeze between drawing the range and invoking B must preserve both the audio and the range.
setTimelineSelection(project, {start:2*Q,end:5*Q}, track)
const originalIsFrozen = project.audioUnitFreeze.isFrozen
try {
    project.audioUnitFreeze.isFrozen = () => true
    assert.equal(panel.emit('keydown', {key:'b', target:canvas}).defaultPrevented, true)
    assert.equal(count(), 2)
    assert.equal(getAudioRange(project)?.start, 2*Q)
    assert.match(wrapper.children.at(-1)!.textContent, /unfreeze/i)
} finally {
    project.audioUnitFreeze.isFrozen = originalIsFrozen
}
editingTool.setValue('select')
clearAudioRange(project)
for(const modifiers of [{metaKey:true},{ctrlKey:true}]){
 const selectAll=panel.emit('keydown',{target:canvas,key:'a',...modifiers})
 assert.equal(selectAll.defaultPrevented,true)
 assert.deepEqual([getAudioRange(project)?.start,getAudioRange(project)?.end],[a.position,a.complete])
 assert.equal(getAudioRange(project)?.track,track)
 assert.deepEqual(project.regionSelection.selected(),[a])
 clearAudioRange(project)
}
for(const modifiers of [{metaKey:true,shiftKey:true},{ctrlKey:true,altKey:true},{}]){
 assert.equal(panel.emit('keydown',{target:canvas,key:'d',...modifiers}).defaultPrevented,false)
 assert.equal(count(),2)
}
project.editing.modify(()=>{project.regionSelection.deselectAll();project.regionSelection.select(b);project.timelineFocus.focusRegion(b)},true)
const duplicateEvent=panel.emit('keydown',{target:canvas,key:'d',ctrlKey:true})
assert.equal(duplicateEvent.defaultPrevented,true);assert.equal(count(),3)
const duplicate=project.regionSelection.selected()[0]
assert.equal(duplicate.position,b.complete);assert.equal(duplicate.duration,a.duration)
assert.equal(project.userEditingManager.timeline.get().unwrap().box,duplicate.box)
assert.deepEqual([b.position,b.duration,b.loopOffset],baselineOther)
project.editing.undo();assert.equal(count(),2)
const blade=panel.emit('keydown',{target:canvas,key:'b'})
assert.equal(blade.defaultPrevented,true);assert.equal(blade.stopped,true);assert.equal(editingTool.getValue(),'cut')

// B has real waveform behavior: the click splits current editor A, not selected arrangement B.
const bladeClick=canvas.emit('pointerdown',{clientX:4*Q/10})
assert.equal(bladeClick.defaultPrevented,true);assert.equal(count(),3)
assert.deepEqual(track.regions.collection.asArray().map(r=>[r.position/Q,r.complete/Q]),[[0,4],[4,8],[10,18]])
assert.deepEqual([b.position,b.duration,b.loopOffset],baselineOther)
project.editing.undo();assert.equal(count(),2)
project.editing.modify(()=>{project.regionSelection.deselectAll();project.regionSelection.select(b);project.timelineFocus.focusRegion(b)},true)
;(project.engine.position as unknown as {setValue(value:number):void}).setValue(3*Q)
const split=panel.emit('keydown',{target:canvas,key:'b',metaKey:true})
assert.equal(split.defaultPrevented,true);assert.equal(count(),3)
assert.deepEqual(track.regions.collection.asArray().map(r=>[r.position/Q,r.complete/Q]),[[0,3],[3,8],[10,18]])
assert.deepEqual([b.position,b.duration,b.loopOffset],baselineOther)
project.editing.undo();assert.equal(count(),2)
project.editing.modify(()=>{project.regionSelection.deselectAll();project.regionSelection.select(b);project.timelineFocus.focusRegion(b)},true)
const remove=panel.emit('keydown',{target:canvas,key:'Delete'})
assert.equal(remove.defaultPrevented,true);assert.equal(a.box.isAttached(),false)
assert.equal(b.box.isAttached(),true);assert.deepEqual([b.position,b.duration,b.loopOffset],baselineOther)
project.editing.undo();assert.equal(count(),2)
helper.terminate()
assert.equal(panel.listeners.get('keydown')?.size,0)
assert.equal(canvas.listeners.get('pointerdown')?.size,0)
assert.equal(wrapper.children.length,1)
// Launcher audio clips are deliberately left to their existing source editor.
const nativeClip=installAudioEditorTools(canvas as never,project,range,snapping,{audioContent:clip} as never)
assert.equal(panel.listeners.get('keydown')?.size,0)
assert.equal(wrapper.children.length,1)
nativeClip.terminate()
console.log('EDITOR_AUDIO_EVENTS_OK: focus routing, text/dialog guards, native key passthrough, blade click, split, delete and native clip exclusion')
