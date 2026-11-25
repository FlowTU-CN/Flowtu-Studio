import assert from 'node:assert/strict'

// This is a data-graph integration test, not an audio-device or browser simulation.
// CaptureAudio creates monitor nodes even when no audio worklet has been started.
Reflect.set(globalThis, 'AudioWorkletNode', class {})
const {Option, Terminable, UUID} = await import('@opendaw/lib-std')
const {ProjectSkeleton, InstrumentFactories, AudioUnitBoxAdapter} = await import('@opendaw/studio-adapters')
const {Project} = await import('@opendaw/studio-core')
const {ensureEnvelope, envelopeTrack, envelopeTarget} = await import('../src/flowtu/EnvelopeTools')

const env = {
    audioContext: {
        currentTime: 0, sampleRate: 48000,
        createGain: () => ({connect() {}, disconnect() {}, gain: {value: 1}}),
        createStereoPanner: () => ({connect() {}, disconnect() {}, pan: {value: 0}})
    },
    audioWorklets: undefined,
    sampleManager: {
        getOrCreate: (uuid: unknown) => ({
            get data() {return Option.None}, get peaks() {return Option.None}, get uuid() {return uuid},
            get state() {return {type: 'idle'}}, invalidate() {}, subscribe: () => Terminable.Empty
        }), record() {}, invalidate() {}, remove() {}, register: () => Terminable.Empty
    },
    soundfontManager: undefined, sampleService: undefined, soundfontService: undefined
} as never

const project = Project.fromSkeleton(env, ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false}))
const unit = project.editing.modify(() => {
    const {audioUnitBox} = project.api.createInstrument(InstrumentFactories.Tape)
    audioUnitBox.volume.setValue(-12)
    audioUnitBox.panning.setValue(-.5)
    return audioUnitBox
}, true).unwrap()
const result = project.editing.modify(() => ensureEnvelope(project, unit, 'volume'), true).unwrap()
assert.equal(result.created, true)
assert.equal(result.region.events.unwrap().length(), 2)
const nodes = result.region.events.unwrap().asArray()
assert.equal(nodes[0].position, 0)
assert.equal(nodes[1].position, result.region.duration - 1)
assert.equal(nodes[0].value, nodes[1].value)
assert.ok(Math.abs(AudioUnitBoxAdapter.VolumeMapper.y(nodes[0].value) + 12) < .001)
assert.ok(result.track.target.targetVertex.contains(unit.volume))

const again = project.editing.modify(() => ensureEnvelope(project, unit, 'volume'), true).unwrap()
assert.equal(again.created, false)
assert.equal(again.region, result.region)
assert.equal(again.region.events.unwrap().length(), 2)
project.editing.modify(() => nodes[1].box.value.setValue(.2), true)
assert.ok(Math.abs(nodes[1].value - .2) < 1e-6)
assert.ok(result.region.valueAt(result.region.duration / 2, 1) < nodes[0].value)
project.editing.undo()
assert.ok(Math.abs(nodes[1].value - nodes[0].value) < 1e-5)
project.editing.modify(() => {nodes[1].box.value.setValue(.2); result.track.enabled.setValue(false)}, true)
assert.equal(result.track.valueAt(100, .9), .9)

const pan = project.editing.modify(() => ensureEnvelope(project, unit, 'panning'), true).unwrap()
assert.notEqual(pan.track, result.track)
assert.ok(pan.track.target.targetVertex.contains(unit.panning))
const [left, right] = pan.region.events.unwrap().asArray()
assert.equal(left.value, .25, 'preserve the initial pan dial at 50% left')
assert.equal(right.value, .25)
assert.equal(pan.track.enabled.getValue(), true, 'volume bypass is independent')
project.editing.modify(() => {left.box.value.setValue(0); right.box.value.setValue(1)}, true)
assert.equal(pan.region.valueAt(0, .5), 0)
assert.ok(Math.abs(pan.region.valueAt((pan.region.duration - 1) / 2, .5) - .5) < .001)
assert.equal(pan.region.valueAt(pan.region.duration - 1, .5), 1)
project.editing.undo()
assert.equal(left.value, .25)
assert.equal(right.value, .25)
project.editing.redo()
assert.equal(project.editing.modify(() => ensureEnvelope(project, unit, 'panning'), true).unwrap().region, pan.region)
project.editing.modify(() => pan.track.enabled.toggle(), true)
assert.equal(pan.track.valueAt(0, .25), .25)
project.editing.undo()
assert.equal(pan.track.enabled.getValue(), true)

const restored = Project.load(env, project.toArrayBuffer() as ArrayBuffer)
const restoredUnit = restored.rootBox.audioUnits.pointerHub.incoming().map(p => p.box)
    .find(box => UUID.toString(box.address.uuid) === UUID.toString(unit.address.uuid))!
const restoredTrack = envelopeTrack(restored, restoredUnit as typeof unit, 'volume')!
assert.ok(restoredTrack.target.targetVertex.contains((restoredUnit as typeof unit).volume))
const restoredRegion = restoredTrack.regions.collection.asArray()[0]
assert.ok(restoredRegion.isValueRegion())
if (!restoredRegion.isValueRegion()) throw new Error('Missing restored envelope region')
assert.equal(restoredTrack.enabled.getValue(), false)
assert.equal(restoredRegion.events.unwrap().length(), 2)
assert.ok(Math.abs(restoredRegion.events.unwrap().asArray()[1].value - .2) < 1e-6)
assert.equal(restoredRegion.duration, result.region.duration)
const restoredPan = envelopeTrack(restored, restoredUnit as typeof unit, 'panning')!
assert.ok(restoredPan.target.targetVertex.contains((restoredUnit as typeof unit).panning))
assert.equal(restoredPan.enabled.getValue(), true)
const restoredPanRegion = restoredPan.regions.collection.asArray()[0]
if (!restoredPanRegion.isValueRegion()) throw new Error('Missing restored pan envelope')
assert.equal(restoredPanRegion.valueAt(0, .5), 0)
assert.equal(restoredPanRegion.valueAt(pan.region.duration - 1, .5), 1)
const pixels = {xToUnit:(x:number)=>x, unitToX:(tick:number)=>tick}
const hitAt = (x:number,y:number,retained=false) => envelopeTarget(restoredRegion,'volume',pixels,x,y,0,100,retained)
restored.editing.modify(()=>restoredRegion.events.unwrap().asArray()[1].box.value.setValue(restoredRegion.events.unwrap().asArray()[0].value),true)
const baseline = 100*(1-restoredRegion.events.unwrap().asArray()[0].value)
assert.equal(hitAt(1,baseline)?.node,restoredRegion.events.unwrap().asArray()[0])
assert.equal(hitAt(40,baseline)?.local,40)
assert.equal(hitAt(40,baseline+4),undefined)
assert.ok(hitAt(40,baseline+4,true),'retain the arrow through small pointer jitter')
assert.equal(hitAt(40,baseline+9,true),undefined,'the filled area uses the range tool')
restored.editing.modify(()=>restoredRegion.events.unwrap().asArray().slice().forEach(n=>n.box.delete()),true)
assert.equal(hitAt(40,baseline)?.local,40,'after deleting all points the visible idle line accepts the first point')
assert.equal(hitAt(40,baseline+12),undefined)
restored.editing.undo()

// Range edits must affect events only, including paired incoming/outgoing nodes at a step.
const {editEnvelopeRange,pasteEnvelopePoints} = await import('../src/flowtu/envelope-range')
const {setTimelineSelection,getEnvelopeRange,getTimelineSelection} = await import('../src/flowtu/timeline-selection')
const {Interpolation} = await import('@opendaw/lib-dsp')
const events = pan.region.optCollection.unwrap()
project.editing.modify(() => {
    events.createEvent({position:100,index:0,value:.25,interpolation:Interpolation.Curve(.75)})
    events.createEvent({position:100,index:1,value:.75,interpolation:Interpolation.None})
    events.createEvent({position:110,index:0,value:.5,interpolation:Interpolation.Linear})
},true)
setTimelineSelection(project,{start:95,end:110},pan.track)
editEnvelopeRange(project,'cut')
assert.equal(events.events.asArray().filter(n=>n.position===100).length,0)
assert.ok(events.events.asArray().some(n=>n.position===110), 'range excludes the end tick')
assert.equal(pan.track.regions.collection.asArray().length,1)
project.editing.undo()
assert.deepEqual(events.events.asArray().filter(n=>n.position===100).map(n=>n.index),[0,1])
const afterEnd=pan.region.complete+20
pasteEnvelopePoints(project,pan.track,afterEnd)
const newRegion=pan.track.regions.collection.asArray().at(-1)!
assert.ok(newRegion.isValueRegion())
if (!newRegion.isValueRegion()) throw new Error('Expected a pasted automation region')
assert.equal(newRegion.position,afterEnd+5)
assert.deepEqual(newRegion.events.unwrap().asArray().map(n=>[n.position,n.index,n.value,n.interpolation]),
    [[0,0,.25,Interpolation.Curve(.75)],[0,1,.75,Interpolation.None]])
project.editing.undo()
assert.equal(pan.track.regions.collection.asArray().length,1)
project.timelineFocus.focusTrack(pan.track)
setTimelineSelection(project,{start:95,end:110},pan.track)
project.timelineFocus.focusTrack(result.track)
assert.equal(getEnvelopeRange(project),undefined,'changing track focus forgets the point-edit target')
assert.deepEqual(getTimelineSelection(project),{start:95,end:110})

// A range dragged upwards owns both lanes; silence and the end tick are outside its edits.
const {bindTimelineTrackOrder}=await import('../src/flowtu/timeline-selection')
const trackOrder=bindTimelineTrackOrder(project,()=>[result.track,pan.track])
const volEvents=result.region.optCollection.unwrap()
project.editing.modify(()=>volEvents.createEvent({position:100,index:0,value:.375,interpolation:Interpolation.Linear}),true)
project.timelineFocus.focusTrack(pan.track)
const both=[result.track,pan.track]
setTimelineSelection(project,{start:95,end:110},pan.track,both)
const pointSnapshot=()=>both.map(track=>track.regions.collection.asArray().map(region=>{
    if (!region.isValueRegion()) throw new Error('Expected an automation region')
    return [UUID.toString(region.uuid),region.position,region.complete,region.events.unwrap().asArray().map(n=>[UUID.toString(n.uuid),n.position,n.index,n.value,n.interpolation])]
}))
const beforeMulti=pointSnapshot()
editEnvelopeRange(project,'cut')
assert.ok(!volEvents.events.asArray().some(n=>n.position===100))
assert.ok(!events.events.asArray().some(n=>n.position===100))
assert.ok(events.events.asArray().some(n=>n.position===110))
project.editing.undo()
assert.deepEqual(pointSnapshot(),beforeMulti)
assert.throws(()=>pasteEnvelopePoints(project,result.track,300),/same parameter order/)
assert.deepEqual(pointSnapshot(),beforeMulti)
pasteEnvelopePoints(project,pan.track,300)
assert.deepEqual(volEvents.events.asArray().filter(n=>n.position===305).map(n=>n.value),[.375])
assert.deepEqual(events.events.asArray().filter(n=>n.position===305).map(n=>n.value),[.25,.75])
project.editing.undo()
assert.deepEqual(pointSnapshot(),beforeMulti)
setTimelineSelection(project,{start:200,end:250},pan.track,both)
assert.throws(()=>editEnvelopeRange(project,'delete'),/No automation points/)
assert.deepEqual(pointSnapshot(),beforeMulti)
trackOrder.terminate()

const mirror = project.editing.modify(()=>pan.region.copyTo({position:pan.region.complete * 2}),true).unwrap()
assert.equal(mirror.isMirrowed,true)
setTimelineSelection(project,{start:95,end:110},pan.track)
editEnvelopeRange(project,'delete')
assert.equal(pan.region.events.unwrap().asArray().filter(n=>n.position===100).length,0)
assert.equal(mirror.events.unwrap().asArray().filter(n=>n.position===100).length,2)
project.editing.undo()
assert.equal(pan.region.isMirrowed,true)
const period=pan.region.loopDuration
project.editing.modify(()=>{pan.region.duration=period*2},true)
setTimelineSelection(project,{start:95,end:110},pan.track)
assert.throws(()=>editEnvelopeRange(project,'delete'),/repeats outside/)
editEnvelopeRange(project,'copy')
assert.throws(()=>pasteEnvelopePoints(project,pan.track,95),/repeats outside/)
assert.equal(pan.region.events.unwrap().asArray().filter(n=>n.position===100).length,2)
assert.equal(pan.region.isMirrowed,true)
console.log('ENVELOPE_GRAPH_OK: target, level, points, reuse, interpolation, undo, bypass, serialization')
