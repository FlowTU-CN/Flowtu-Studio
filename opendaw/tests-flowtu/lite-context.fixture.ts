import assert from 'node:assert/strict'
Reflect.set(globalThis,'AudioWorkletNode',class {})
const {Option,Terminable,UUID}=await import('@opendaw/lib-std')
const {PPQN, AudioData}=await import('@opendaw/lib-dsp')
const {ProjectSkeleton,InstrumentFactories,NoteRegionBoxAdapter}=await import('@opendaw/studio-adapters')
const {AudioFileBox}=await import('@opendaw/studio-boxes')
const {Project, AudioContentFactory}=await import('@opendaw/studio-core')
const {readLiteMusicContext,shapeLiteTransition}=await import('../src/flowtu/lite-music-context')
const rate=12000, data=AudioData.create(rate,rate*3,1), Q=PPQN.Quarter
// The source has 1s of silence before 2s of concert A. The clip's source trim skips the silence.
for(let i=rate;i<rate*3;i++) data.frames[0][i]=.5*Math.sin(2*Math.PI*i*440/rate)
let decoded=true
const env={audioContext:{currentTime:0,sampleRate:48000,createGain:()=>({connect(){},disconnect(){},gain:{value:1}}),createStereoPanner:()=>({connect(){},disconnect(){},pan:{value:0}})},audioWorklets:undefined,sampleManager:{getOrCreate:(uuid:unknown)=>({get data(){return decoded ? Option.wrap(data) : Option.None},get peaks(){return Option.None},get uuid(){return uuid},get state(){return {type:'loaded'}},invalidate(){},subscribe:()=>Terminable.Empty}),register:()=>Terminable.Empty},soundfontManager:undefined,sampleService:undefined,soundfontService:undefined} as never
const project=Project.fromSkeleton(env,ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}))
const {generated,rightUnit,leftTrack,clip}=project.editing.modify(()=>{
    project.api.setBpm(120)
    const keys=project.api.createInstrument(InstrumentFactories.Tubular,{name:'Left electric piano'}), pad=project.api.createInstrument(InstrumentFactories.Vaporisateur,{name:'Right pad'})
    const left=project.api.createNoteRegion({trackBox:keys.trackBox,position:0,duration:4*Q,name:'Looped phrase'});left.loopDuration.setValue(2*Q)
    for(const pitch of [60,64,67]) project.api.createNoteEvent({owner:left,position:Q,duration:Q,pitch,velocity:.35})
    const right=project.api.createNoteRegion({trackBox:pad.trackBox,position:8*Q,duration:4*Q,name:'D minor'})
    for(const pitch of [62,65,69]) project.api.createNoteEvent({owner:right,position:0,duration:Q,pitch,velocity:.9})
    const generated=project.api.createNoteRegion({trackBox:keys.trackBox,position:4*Q,duration:4*Q,name:'Bridge'})
    for(let i=0;i<4;i++)project.api.createNoteEvent({owner:generated,position:Q*i,duration:Q,pitch:66,velocity:.6})
    const ignored=project.api.createNoteRegion({trackBox:keys.trackBox,position:0,duration:4*Q,name:'Muted'});ignored.mute.setValue(true)
    project.api.createNoteEvent({owner:ignored,position:0,duration:4*Q,pitch:55,velocity:.8})
    const tape=project.api.createInstrument(InstrumentFactories.Tape,{name:'Recorded tone'})
    const file=AudioFileBox.create(project.boxGraph,UUID.generate(),box=>{box.fileName.setValue('test');box.endInSeconds.setValue(3)})
    const clip=AudioContentFactory.createNotStretchedRegion({boxGraph:project.boxGraph,targetTrack:tape.trackBox,position:0,audioFileBox:file,sample:{name:'A',duration:2} as never,waveformOffset:1})
    return {generated,rightUnit:pad.audioUnitBox,leftTrack:keys.trackBox,clip}
}).unwrap()
let context=readLiteMusicContext(project,2,4)
assert.deepEqual(context.before.boundaryPitches,[60,64,67]);assert.deepEqual(context.after.boundaryPitches,[62,65,69]);assert.equal(context.before.chord,'C');assert.equal(context.after.chord,'Dm')
assert.equal(context.before.notes.length,6);assert.ok(context.before.notes.some(n=>n.start===1.5 && n.end===2));assert.ok(context.before.notes.every(n=>n.pitch!==55 && n.instrument && n.track));assert.equal(context.bpm,120)
const recorded=context.before.audio[0];assert.equal(recorded.status,'pcm');assert.equal(recorded.estimatedPitch,69);assert.ok(recorded.rmsDb! > -10 && recorded.rmsDb! < -8);assert.equal(recorded.onsetsPerSecond,0)
project.editing.modify(()=>shapeLiteTransition(project,UUID.toString(generated.address.uuid),context))
const rendered=project.boxAdapters.adapterFor(generated,NoteRegionBoxAdapter).optCollection.unwrap().events.asArray()
assert.equal(rendered[0].pitch,67);assert.equal(rendered[3].pitch,65);assert.equal(rendered[1].pitch,66);assert.equal(rendered[2].pitch,66);assert.ok(rendered[0].velocity<.6 && rendered[3].velocity>.6)
project.editing.undo();assert.deepEqual(rendered.map(n=>n.pitch),[66,66,66,66]);
project.editing.modify(()=>{leftTrack.enabled.setValue(false);rightUnit.mute.setValue(true)})
context=readLiteMusicContext(project,2,4);assert.deepEqual(context.before.boundaryPitches,[69]);assert.equal(context.before.chord,null);assert.equal(context.after.notes.length,0)
decoded=false;const missing=readLiteMusicContext(project,2,4).before;assert.equal(missing.audio[0].status,'not-decoded');assert.deepEqual(missing.boundaryPitches,[]);assert.equal(missing.chord,null)
project.editing.modify(()=>clip.mute.setValue(true));assert.equal(readLiteMusicContext(project,2,4).before.audio.length,0)
assert.deepEqual(readLiteMusicContext(project,24,28).before.notes,[])
console.log('LITE_CONTEXT_OK')
