import assert from 'node:assert/strict'
Reflect.set(globalThis,'AudioWorkletNode',class {})
const {Option,Terminable,UUID}=await import('@opendaw/lib-std')
const {PPQN}=await import('@opendaw/lib-dsp')
const {ProjectSkeleton,InstrumentFactories,AudioRegionBoxAdapter,TrackBoxAdapter}=await import('@opendaw/studio-adapters')
const {AudioFileBox}=await import('@opendaw/studio-boxes')
const {Project,AudioContentFactory}=await import('@opendaw/studio-core')
const {assertAudioEditorRegion,splitAudioEditorRegion,changeAudioEditorRegion,duplicateAudioEditorRegion}=await import('../src/flowtu/editor-audio-actions')

// Use the native project graph, selection, editing history and audio adapters. No browser or audio playback is simulated.
const env={audioContext:{currentTime:0,sampleRate:48000,createGain:()=>({connect(){},disconnect(){},gain:{value:1}}),createStereoPanner:()=>({connect(){},disconnect(){},pan:{value:0}})},audioWorklets:undefined,sampleManager:{getOrCreate:(uuid:unknown)=>({get data(){return Option.None},get peaks(){return Option.None},get uuid(){return uuid},get state(){return {type:'idle'}},invalidate(){},subscribe:()=>Terminable.Empty}),record(){},invalidate(){},remove(){},register:()=>Terminable.Empty},soundfontManager:undefined,sampleService:undefined,soundfontService:undefined} as never
const project=Project.fromSkeleton(env,ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}))
const Q=PPQN.Quarter
const {track,a,b,file}=project.editing.modify(()=>{
 const first=project.api.createInstrument(InstrumentFactories.Tape,{name:'Edited audio'})
 const other=project.api.createInstrument(InstrumentFactories.Tape,{name:'Unrelated selected track'})
 const file=AudioFileBox.create(project.boxGraph,UUID.generate(),box=>{box.fileName.setValue('Editor audio fixture');box.startInSeconds.setValue(0);box.endInSeconds.setValue(8)})
 const sample={name:'Audio',duration:4,bpm:0} as never
 const create=(trackBox:typeof first.trackBox,position:number)=>project.boxAdapters.adapterFor(AudioContentFactory.createNotStretchedRegion({boxGraph:project.boxGraph,targetTrack:trackBox,audioFileBox:file,sample,position,waveformOffset:.75}),AudioRegionBoxAdapter)
 const a=create(first.trackBox,4*Q),b=create(other.trackBox,2*Q)
 a.loopOffset=Q
 return {track:project.boxAdapters.adapterFor(first.trackBox,TrackBoxAdapter),a,b,file}
},true).unwrap()
const snapshot=(region:InstanceType<typeof AudioRegionBoxAdapter>)=>({position:region.position,duration:region.duration,complete:region.complete,loopOffset:region.loopOffset,waveformOffset:region.waveformOffset.getValue(),file:UUID.toString(region.file.uuid),mute:region.mute,fadeIn:region.fading.in,fadeOut:region.fading.out})
// Verify both ends against a different audio track and a tempo change, using the native seconds-based region.
const {Snapping}=await import('../src/ui/timeline/Snapping')
const {clipDragSnap}=await import('../src/ui/timeline/AudioClipSnap')
const {setTempoPoint}=await import('../src/ui/timeline/tracks/primary/conductor-points')
const range={xToUnit:(x:number)=>x*4,unitsPerPixel:4} as never
const snap=new Snapping(range)
snap.registerTempoMap(project.tempoMap)
snap.index=snap.units.findIndex(unit=>unit.name==='1/4')
project.editing.modify(()=>{a.duration=2*Q; b.position+=97},true)
setTempoPoint(project,8*Q,60)
const mouseAt=(newStart:number)=>(newStart-a.position)/4
const drag=clipDragSnap(project,snap,[a],a,'move',0)
const after=b.complete
assert.equal(a.position+drag(mouseAt(after+20)),Math.ceil(after))
assert.equal(snap.guide.getValue(),after)
const tailStart=project.tempoMap.secondsToPPQN(project.tempoMap.ppqnToSeconds(after)-a.box.duration.getValue())
const alignedStart=a.position+drag(mouseAt(tailStart-16))
assert.ok(Math.abs(a.resolveComplete(alignedStart)-after)<1.01)
const grouped=clipDragSnap(project,snap,[a,b],a,'move',0)
snap.target='edges'
assert.equal(a.position+grouped(mouseAt(after+12)),Math.round(after+12))
assert.equal(a.position+grouped(mouseAt(after+12),false,true),Math.ceil(after))
snap.target='grid'
assert.equal(a.position+drag(mouseAt(after+19)),snap.round(after+19))
snap.enabled=false
assert.equal(a.position+drag(mouseAt(after+19)),Math.round(after+19))
assert.equal(snap.guide.getValue(),null)
snap.enabled=true;snap.target='both'
assert.equal(a.position+drag(mouseAt(after+19),true),Math.round(after+19))
const trim=clipDragSnap(project,snap,[a],a,'end',0)
assert.ok(Math.abs(a.complete+trim((after-a.complete-20)/4)-after)<1.01)
project.editing.undo();project.editing.undo();snap.terminate()
const baseline=snapshot(a),unrelated=snapshot(b)
const staleTopSelection=()=>project.editing.modify(()=>{
 project.regionSelection.deselectAll();project.regionSelection.select(b)
 project.timelineFocus.focusRegion(b)
 project.userEditingManager.timeline.edit(a.box)
},true)
const unchangedOther=()=>assert.deepEqual(snapshot(b),unrelated)
staleTopSelection()
const right=splitAudioEditorRegion(project,a,7*Q)
assert.deepEqual(track.regions.collection.asArray().map(r=>[r.position/Q,r.complete/Q]),[[4,7],[7,12]])
assert.equal(right.loopOffset,4*Q)
assert.equal(right.waveformOffset.getValue(),.75)
assert.equal(UUID.toString(right.file.uuid),UUID.toString(file.address.uuid))
assert.deepEqual(project.regionSelection.selected(),[right])
assert.equal(project.userEditingManager.timeline.get().unwrap().box,right.box)
unchangedOther()
project.editing.undo()
assert.deepEqual(snapshot(a),baseline)
assert.equal(track.regions.collection.asArray().length,1)
unchangedOther()

staleTopSelection()
const duplicate=duplicateAudioEditorRegion(project,a)
assert.equal(duplicate.position,baseline.complete)
assert.equal(duplicate.duration,baseline.duration)
assert.equal(duplicate.loopOffset,baseline.loopOffset)
assert.equal(duplicate.waveformOffset.getValue(),baseline.waveformOffset)
assert.equal(UUID.toString(duplicate.file.uuid),baseline.file)
assert.deepEqual(project.regionSelection.selected(),[duplicate])
assert.equal(project.userEditingManager.timeline.get().unwrap().box,duplicate.box)
assert.deepEqual(snapshot(a),baseline);unchangedOther()
project.editing.undo()
assert.equal(track.regions.collection.asArray().length,1)
assert.deepEqual(snapshot(a),baseline);unchangedOther()

for(const [action,value,check] of [
 ['trim-start',5*Q,()=>{assert.equal(a.position,5*Q);assert.equal(a.complete,12*Q);assert.equal(a.loopOffset,2*Q)}],
 ['trim-end',10*Q,()=>{assert.equal(a.position,4*Q);assert.equal(a.complete,10*Q);assert.equal(a.loopOffset,Q)}],
 ['move',3*Q,()=>{assert.equal(a.position,3*Q);assert.equal(a.complete,11*Q);assert.equal(a.loopOffset,Q)}],
 ['fade-in',2*Q,()=>assert.equal(a.fading.in,2*Q)],
 ['fade-out',3*Q,()=>assert.equal(a.fading.out,3*Q)],
 ['mute',0,()=>assert.equal(a.mute,true)]
] as const){
 staleTopSelection()
 changeAudioEditorRegion(project,a,action,value)
 check();unchangedOther()
 assert.equal(a.waveformOffset.getValue(),.75)
 assert.equal(UUID.toString(a.file.uuid),UUID.toString(file.address.uuid))
 project.editing.undo();assert.deepEqual(snapshot(a),baseline);unchangedOther()
}

staleTopSelection()
changeAudioEditorRegion(project,a,'fade-in',7*Q)
changeAudioEditorRegion(project,a,'fade-out',5*Q)
assert.ok(a.fading.in+a.fading.out<=a.duration)
assert.equal(a.fading.out,5*Q)
project.editing.undo();assert.equal(a.fading.in,7*Q);assert.equal(a.fading.out,0)
project.editing.undo();assert.deepEqual(snapshot(a),baseline)

for(const [action,value] of [['trim-start',10*Q],['trim-end',6*Q]] as const){
 changeAudioEditorRegion(project,a,'fade-in',5*Q)
 changeAudioEditorRegion(project,a,'fade-out',3*Q)
 changeAudioEditorRegion(project,a,action,value)
 assert.equal(a.duration,2*Q)
 assert.ok(a.fading.in+a.fading.out<=a.duration,'Trimming must keep both fades inside the remaining clip')
 unchangedOther()
 project.editing.undo()
 assert.equal(a.duration,8*Q);assert.equal(a.fading.in,5*Q);assert.equal(a.fading.out,3*Q)
 project.editing.undo();project.editing.undo();assert.deepEqual(snapshot(a),baseline)
}

for(const point of [a.position,a.complete,a.position-1,a.complete+1])assert.throws(()=>splitAudioEditorRegion(project,a,point),/inside the audio clip/)
assert.throws(()=>changeAudioEditorRegion(project,a,'move',Number.NaN),/valid audio position/)
assert.deepEqual(snapshot(a),baseline);unchangedOther()
changeAudioEditorRegion(project,a,'erase')
assert.equal(a.box.isAttached(),false)
assert.throws(()=>assertAudioEditorRegion(project,a),/no longer available/)
assert.throws(()=>splitAudioEditorRegion(project,a,7*Q),/no longer available/)
unchangedOther()
project.editing.undo()
const restored=track.regions.collection.asArray()[0] as InstanceType<typeof AudioRegionBoxAdapter>
assert.deepEqual(snapshot(restored),baseline);unchangedOther()
console.log('EDITOR_AUDIO_GRAPH_OK: current audio owner, split, trims, source continuity, fades, mute, erase, invalid targets and undo')
