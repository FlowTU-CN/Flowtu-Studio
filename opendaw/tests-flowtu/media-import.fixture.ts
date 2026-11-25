import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve, basename} from 'node:path'
Reflect.set(globalThis,'AudioWorkletNode',class {})
const {Option,Terminable,UUID} = await import('@opendaw/lib-std')
const {PPQN} = await import('@opendaw/lib-dsp')
const {MetaData,ProjectSkeleton,NoteRegionBoxAdapter,AudioRegionBoxAdapter} = await import('@opendaw/studio-adapters')
const {Project} = await import('@opendaw/studio-core')
const {importMedia,importTargets,mediaKind,assetOnlyUnitOrigin} = await import('../src/flowtu/media-import')
const {takeRegion,deleteScoringRegion} = await import('../src/flowtu/scoring-model')
const {projectAssets,deleteProjectAsset,placeAssetParts} = await import('../src/flowtu/scoring-assets')
const {saveDeckVersion} = await import('../src/flowtu/flowdeck-model')
const env={audioContext:{currentTime:0,sampleRate:48000,createGain:()=>({connect(){},disconnect(){},gain:{value:1}}),createStereoPanner:()=>({connect(){},disconnect(){},pan:{value:0}})},audioWorklets:undefined,sampleManager:{getOrCreate:(uuid:unknown)=>({get data(){return Option.None},get peaks(){return Option.None},get uuid(){return uuid},get state(){return {type:'idle'}},invalidate(){},subscribe:()=>Terminable.Empty}),record(){},invalidate(){},remove(){},register:()=>Terminable.Empty},soundfontManager:{getOrCreate:()=>({soundfont:Option.None, subscribe:()=>Terminable.Empty})},sampleService:undefined,soundfontService:undefined} as never

const project = Project.fromSkeleton(env, ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}))
const sample = {name:'Test tone',uuid:UUID.toString(UUID.generate()),duration:.5,bpm:0}
const service = {hasProfile:true, project,engine:{position:{getValue:()=>0}},sampleService:{importFile: async()=>sample},sampleManager:{getAudioData:async()=>{}}} as never
function midiFile(tracks:number[][],division=96){
    const h=[77,84,104,100,0,0,0,6,0,tracks.length>1?1:0,0,tracks.length,division>>8,division&255]
    for(const events of tracks){const t=[...events,0,255,47,0];h.push(77,84,114,107,0,0,0,t.length,...t)}
    return new File([new Uint8Array(h)],'Session.mid')
}
const track1=[0,144,60,100,96,144,60,0], track2=[48,145,64,55,96,129,64,0]
const song=midiFile([track1,track2]), audio=new File(['mock-decoded-PCM'],'Tone.wav')
assert.equal(mediaKind(song),'midi');assert.equal(mediaKind(audio),'audio');assert.equal(mediaKind(new File([],'movie.mp4',{type:'video/mp4'})),undefined)
await assert.rejects(importMedia(service,midiFile([[]]),{kind:'new'}),/no playable notes/)
await assert.rejects(importMedia(service,midiFile([track1],0xe728),{kind:'new'}),/SMPTE/)
assert.deepEqual(importTargets(project,'midi'),[])
const stored=await importMedia(service,song,{kind:'assets'})
assert.deepEqual(importTargets(project,'midi'),[])
const source=takeRegion(project,stored);assert.ok(source instanceof NoteRegionBoxAdapter)
const storage=source.trackBoxAdapter.unwrap()
assert.equal(storage.enabled.getValue(),false)
assert.equal(MetaData.read(storage.audioUnit, assetOnlyUnitOrigin),true)
assert.deepEqual(project.regionSelection.selected(),[])
assert.deepEqual(projectAssets(project).map(a=>[a.id,a.stored]),[[stored,true]])
const Q=PPQN.Quarter
assert.deepEqual(source.optCollection.unwrap().events.asArray().map(n=>[n.box.pitch.getValue(),n.position,n.duration]),[[60,0,Q],[64,Q/2,Q]])
assert.equal(source.duration,Q*1.5)
const version=saveDeckVersion(project,stored,{kind:'midi',transpose:2,velocity:90})
assert.ok(takeRegion(project,version))
const active=await importMedia(service,song,{kind:'new'},Q*8)
const options=importTargets(project,'midi');assert.equal(options.length,1)
assert.equal(takeRegion(project,active)!.position,Q*8)
assert.equal(UUID.toString(project.regionSelection.selected()[0].uuid),active)
const dest={kind:'existing',trackId:options[0].id} as const
const early=await importMedia(service,song,dest,Q);assert.equal(takeRegion(project,early)!.position,Q)
const collision=await importMedia(service,song,dest,Q*8);assert.equal(takeRegion(project,collision)!.position,Q*9.5)
const end=await importMedia(service,song,dest);assert.equal(takeRegion(project,end)!.position,Q*11)
project.editing.undo();assert.equal(takeRegion(project,end),undefined);project.editing.redo();assert.ok(takeRegion(project,end))
await assert.rejects(importMedia(service,audio,dest),/destination track/)
const audioAsset=await importMedia(service,audio,{kind:'assets'})
const wave=takeRegion(project,audioAsset);assert.ok(wave instanceof AudioRegionBoxAdapter)
assert.equal(wave.trackBoxAdapter.unwrap().enabled.getValue(),false)
assert.equal(importTargets(project,'audio').length,0)
const waveId=await importMedia(service,audio,{kind:'new'},Q*2)
const audioTrack=importTargets(project,'audio')[0]
assert.equal(takeRegion(project,waveId)!.position,Q*2)
const moreAudio=await importMedia(service,audio,{kind:'existing',trackId:audioTrack.id},Q*2)
assert.equal(takeRegion(project,moreAudio)!.position,Math.ceil(takeRegion(project,waveId)!.complete))
const reopened=Project.load(env,project.toArrayBuffer() as ArrayBuffer)
assert.deepEqual(projectAssets(reopened).map(a=>[a.id,a.stored]).sort(),projectAssets(project).map(a=>[a.id,a.stored]).sort())
// Deleting the channel keeps every clip, including multiple regions backed by the same sample.
const {deleteTracksWithMedia} = await import('../src/flowtu/track-delete')
deleteTracksWithMedia(reopened,[takeRegion(reopened,waveId)!.trackBoxAdapter.unwrap()])
const restoredMedia=Project.load(env,reopened.toArrayBuffer() as ArrayBuffer)
for(const id of [waveId,moreAudio]) {
    const retained=takeRegion(restoredMedia,id)
    assert.ok(retained instanceof AudioRegionBoxAdapter)
    assert.equal(retained.trackBoxAdapter.unwrap().enabled.getValue(),false)
    assert.equal(UUID.toString(retained.box.file.targetAddress.unwrap().uuid),sample.uuid)
}
assert.deepEqual(importTargets(restoredMedia,'audio'),[])
assert.ok(deleteProjectAsset(restoredMedia,waveId))
assert.equal(takeRegion(restoredMedia,waveId),undefined)
assert.ok(takeRegion(restoredMedia,moreAudio))
assert.ok(takeRegion(restoredMedia,audioAsset))
restoredMedia.editing.undo()
assert.ok(takeRegion(restoredMedia,waveId))
// Erasing a timeline-only clip keeps its media. Erasing its new placement reuses that entry.
const scene=Project.load(env,project.toArrayBuffer() as ArrayBuffer)
const original=takeRegion(scene,waveId)!
const destination=original.trackBoxAdapter.unwrap()
const beforeDelete=new Set(projectAssets(scene).map(item=>item.id))
scene.editing.modify(()=>deleteScoringRegion(scene,original),true)
const saved=projectAssets(scene).find(item=>!beforeDelete.has(item.id))
assert.ok(saved?.stored)
assert.equal(takeRegion(scene,waveId),undefined)
const count=projectAssets(scene).length
assert.equal(placeAssetParts(scene,[saved.id],destination,0),true)
const placement=scene.regionSelection.selected()[0]
scene.editing.modify(()=>deleteScoringRegion(scene,placement),true)
assert.equal(projectAssets(scene).length,count)
assert.ok(takeRegion(scene,saved.id))
scene.editing.undo()
assert.ok(takeRegion(scene,UUID.toString(placement.uuid)))
// A previously imported MIDI keeps its unit, clips, timings, routing and effects across sound changes.
const {midiTrackName,setMidiTrackName} = await import('../src/flowtu/track-name')
const {setUnitTone, setUnitDx7Voice, setUnitSoundfont} = await import('../src/flowtu/track-sound')
const {Dx7Sysex, TubularPreset} = await import('@opendaw/studio-adapters')
const {TubularDeviceBox, SoundfontDeviceBox} = await import('@opendaw/studio-boxes')
const {EffectFactories} = await import('@opendaw/studio-core')
const importedTrack = takeRegion(project,active)!.trackBoxAdapter.unwrap()
const unit = importedTrack.audioUnit
assert.equal(midiTrackName(unit), 'Session')
project.editing.modify(() => setMidiTrackName(unit,'Opening motif'), true)
const unchanged = () => ({
    clips: importedTrack.regions.collection.asArray().map(r => [UUID.toString(r.uuid), r.position, r.duration,
        (r as InstanceType<typeof NoteRegionBoxAdapter>).optCollection.unwrap().events.asArray().map(n => [n.position,n.duration,n.box.pitch.getValue()])]),
    trackName: midiTrackName(unit), output: unit.output.targetAddress.unwrap().toString(), fader: unit.volume.getValue(),
    effects: unit.audioEffects.pointerHub.incoming().map(p => UUID.toString(p.box.address.uuid)),
    units: project.rootBoxAdapter.audioUnits.adapters().map(u => UUID.toString(u.uuid))
})
project.editing.modify(() => {project.api.insertEffect(unit.audioEffects, EffectFactories.Reverb); unit.volume.setValue(-8)}, true)
const snapshot = unchanged(), originalSound = unit.input.pointerHub.incoming()[0].box
project.editing.modify(() => setUnitTone(project, unit, 'keys'), true)
const tubular = unit.input.pointerHub.incoming()[0].box
assert.ok(tubular instanceof TubularDeviceBox)
const electricPiano = TubularPreset.read(tubular)
assert.deepEqual(unchanged(),snapshot)
const fixturePath = resolve(basename(process.cwd()) === 'opendaw' ? '.' : 'opendaw', 'public/tubular/cartridges/Tubular_Classics.syx')
const voices = Dx7Sysex.decode(readFileSync(fixturePath))
const voice = voices.find(v => v.name === 'Rhodes')!
project.editing.modify(() => setUnitDx7Voice(project, unit, voice), true)
assert.deepEqual(TubularPreset.read(tubular),voice.data)
assert.deepEqual(unchanged(),snapshot)
const font = {uuid:UUID.toString(UUID.generate()),name:'Local Piano',size:42,origin:'import',url:'unknown',license:'test'} as const
project.editing.modify(() => setUnitSoundfont(project,unit,font), true)
const sampler = unit.input.pointerHub.incoming()[0].box
assert.ok(sampler instanceof SoundfontDeviceBox)
assert.equal(UUID.toString(sampler.file.targetAddress.unwrap().uuid), font.uuid)
assert.deepEqual(unchanged(),snapshot)
project.editing.undo()
assert.deepEqual(TubularPreset.read(unit.input.pointerHub.incoming()[0].box as InstanceType<typeof TubularDeviceBox>),voice.data)
project.editing.undo()
assert.equal((unit.input.pointerHub.incoming()[0].box as InstanceType<typeof TubularDeviceBox>).label.getValue(), 'Electric Piano')
project.editing.undo()
assert.ok(UUID.equals(unit.input.pointerHub.incoming()[0].box.address.uuid, originalSound.address.uuid))
assert.deepEqual(unchanged(),snapshot)
project.editing.redo()
project.editing.redo()
project.editing.redo()
assert.equal(UUID.toString((unit.input.pointerHub.incoming()[0].box as InstanceType<typeof SoundfontDeviceBox>).file.targetAddress.unwrap().uuid),font.uuid)
project.editing.undo()
project.editing.modify(() => setUnitTone(project, unit, 'keys'), true)
assert.deepEqual(TubularPreset.read(unit.input.pointerHub.incoming()[0].box as InstanceType<typeof TubularDeviceBox>),electricPiano)
assert.deepEqual(unchanged(),snapshot)
const {checkRetainedPresetArchive} = await import('./retained-preset-archive.fixture')
await checkRetainedPresetArchive(env)
console.log('MEDIA_IMPORT_OK')
