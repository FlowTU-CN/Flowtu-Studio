import assert from 'node:assert/strict'
import {Worker} from 'node:worker_threads'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'

const [root, workerFile, wasmDist] = process.argv.slice(2)
Reflect.set(globalThis, 'AudioWorkletNode', class {})
// Run the same worker and WASM plugins used by the browser. Only Worker messaging and
// fetch are adapted to Node; the graph, transport, DSP, WAV and ZIP encoders are real.
Reflect.set(globalThis, 'Worker', class {
    readonly worker = new Worker(`
        const {parentPort,workerData} = require('node:worker_threads')
        globalThis.self = parentPort
        globalThis.fetch = async path => new Response(await require('node:fs/promises').readFile(
            path.endsWith('/wasm/engine.wasm') ? workerData.engine : path))
        import(workerData.worker)
    `, {eval: true, workerData: {engine: join(root, 'engine/engine.wasm'), worker: pathToFileURL(workerFile).href}})
    onmessage?: (message: object) => void
    constructor() {this.worker.on('message', data => this.onmessage?.({data}))}
    postMessage(message: unknown, ports: never[]) {this.worker.postMessage(message, ports)}
    terminate() {this.worker.terminate()}
})
const {Option, Terminable, UUID} = await import('@opendaw/lib-std')
const {PPQN, WavFile, AudioData} = await import('@opendaw/lib-dsp')
const {OfflineEngineRenderer, Project, EffectFactories, AudioContentFactory} = await import('@opendaw/studio-core')
const {InstrumentFactories, ProjectSkeleton, MetaData} = await import('@opendaw/studio-adapters')
const {exportArea} = await import('../src/flowtu/work-area-render')
const {default: JSZip} = await import('jszip')
OfflineEngineRenderer.install('worker', {wasmUrl: wasmDist})
const {AudioFileBox} = await import('@opendaw/studio-boxes')
const tone = AudioData.create(48000, 12000, 1)
tone.frames[0].forEach((_, i, channel) => {channel[i] = 0.4 * Math.sin(i / 12)})
const sampleId = UUID.generate()
const sample = {name: 'Tone', uuid: UUID.toString(sampleId), duration: .25, bpm: 0}
const env = {audioContext: {currentTime: 0, sampleRate: 48000, createGain: () => ({connect(){},disconnect(){},gain:{value:1}}),
    createStereoPanner: () => ({connect(){},disconnect(){},pan:{value:0}})}, audioWorklets: undefined,
    sampleManager: {register: () => Terminable.Empty, getOrCreate: () => ({
        uuid: sampleId, data: Option.wrap(tone), peaks: Option.None, state: {type: 'loaded'},
        subscribe: (observer: (state: {type: string}) => void) => {observer({type:'loaded'}); return Terminable.Empty}
    })}} as never
const project = Project.fromSkeleton(env, ProjectSkeleton.empty({createDefaultUser:true, createOutputMaximizer:false}))
const Q = PPQN.Quarter
project.editing.modify(() => {
    project.api.setBpm(120)
    project.api.createInstrument(InstrumentFactories.Tape, {name: 'Empty'})
    const tape = project.api.createInstrument(InstrumentFactories.Tape, {name: 'Recorded'})
    const audioFileBox = AudioFileBox.create(project.boxGraph, sampleId, box => {
        box.fileName.setValue(sample.name)
        box.endInSeconds.setValue(sample.duration)
    })
    AudioContentFactory.createNotStretchedRegion({boxGraph:project.boxGraph, targetTrack:tape.trackBox,
        sample, audioFileBox, name:'Recorded', position:2*Q})
    const overlap = project.api.createAudioTrack(tape.audioUnitBox)
    MetaData.store(overlap, UUID.toString(tape.trackBox.address.uuid), 'flowtu:overlap-lane')
    AudioContentFactory.createNotStretchedRegion({boxGraph:project.boxGraph, targetTrack:overlap,
        sample, audioFileBox, name:'Overlap lane', position:Q})
    const stored = project.api.createAudioTrack(tape.audioUnitBox)
    MetaData.store(stored, true, 'flowtu:asset-storage')
    stored.enabled.setValue(false)
    AudioContentFactory.createNotStretchedRegion({boxGraph:project.boxGraph, targetTrack:stored,
        sample, audioFileBox, name:'Library only', position:Q/2})
    const lead = project.api.createInstrument(InstrumentFactories.Vaporisateur, {name: 'Melody'})
    const reverb = project.api.insertEffect(lead.audioUnitBox.audioEffects, EffectFactories.Reverb)
    reverb.enabled.setValue(true)
    const region = project.api.createNoteRegion({trackBox:lead.trackBox, position: Q, duration: Q*2, name:'Motif'})
    project.api.createNoteEvent({owner:region, position:0, duration: Q/2, pitch:63, velocity:0.9})
    // Store a second visible lane on the same channel. Only its own performance should be printed.
    project.api.createNoteTrack(lead.audioUnitBox)
})
const area = {start: Q/2, end: Q*3}
const {getWorkArea, setWorkArea, setWorkAreaPictureEnd, installSharedLocators} = await import('../src/flowtu/work-area')
assert.deepEqual(getWorkArea(project), {start:0, end:3*Q})
setWorkAreaPictureEnd(project, 6)
assert.deepEqual(getWorkArea(project), {start:0, end:12*Q})
setWorkArea(project, area)
assert.deepEqual(getWorkArea(project), area)
const reopened = project.copy()
assert.deepEqual(getWorkArea(reopened), area)
reopened.terminate()
setWorkArea(project)
assert.deepEqual(getWorkArea(project), {start:0, end:12*Q})
project.editing.undo()
assert.deepEqual(getWorkArea(project), area)
assert.throws(() => setWorkArea(project, {start:Q, end:Q}))
// Old exports saved independent bounds. Adopt them on open, even with a conflicting native loop.
const legacy = project.copy()
const loop = legacy.timelineBox.loopArea
const native = () => ({start:loop.from.getValue(), end:loop.to.getValue()})
legacy.editing.modify(() => {
    MetaData.store(legacy.rootBox, {start:Q, end:2*Q}, 'flowtu:export-work-area:v1')
    loop.from.setValue(0); loop.to.setValue(4*Q); loop.enabled.setValue(true)
})
legacy.editing.markSaved()
const binding = installSharedLocators(legacy)
assert.deepEqual(native(), {start:Q, end:2*Q})
assert.equal(legacy.editing.hasUnsavedChanges(), false)
assert.deepEqual(getWorkArea(legacy), native())
setWorkArea(legacy)
setWorkAreaPictureEnd(legacy, 8)
await Promise.resolve()
assert.deepEqual(native(), {start:0, end:16*Q})
legacy.editing.undo()
await Promise.resolve()
assert.deepEqual(native(), {start:Q, end:2*Q})
assert.equal(loop.enabled.getValue(), true)
binding.terminate()
legacy.terminate()
const signal = new AbortController().signal
const saved = new Uint8Array(project.toArrayBuffer())
const stems = await exportArea(project, area, 'stems', false, signal, () => {})
const zip = await JSZip.loadAsync(await stems.arrayBuffer())
const names = Object.keys(zip.files)
assert.equal(names.length, 4)
const files = await Promise.all(names.map(async name => WavFile.decodeFloats(await zip.file(name)!.async('arraybuffer'))))
for (const f of files) {
    assert.equal(f.numberOfFrames, 60000)
    assert.equal(f.numberOfChannels, 2)
    assert.equal(f.sampleRate, 48000)
}
const audible = files.filter(f => f.frames[0].some(s => Math.abs(s) > 1e-5))
assert.equal(audible.length, 2)
const recorded = files[names.findIndex(n => n.includes('Recorded'))].frames[0]
assert.ok(recorded.slice(0,11900).every(s => Math.abs(s) < 1e-6), 'library asset is silent')
assert.ok(recorded.slice(12100,13100).some(s => Math.abs(s) > 1e-3), 'overlap lane stays in its parent stem')
assert.ok(recorded.slice(24200,35900).every(s => Math.abs(s) < 1e-6))
assert.ok(recorded.slice(36100,37000).some(s => Math.abs(s) > 1e-3))
assert.ok(recorded.slice(48200).every(s => Math.abs(s) < 1e-6))
const melody = files.find((file, i) => names[i].includes('Melody') && audible.includes(file))!
assert.ok(melody.frames[0].slice(0,11800).every(s => Math.abs(s) < 1e-6))
assert.ok(melody.frames[0].slice(12000,22000).some(s => Math.abs(s) > 1e-4))
const wetArea = {start: Q*1.25, end: Q*3}
const render = async (wet: boolean) => WavFile.decodeFloats(await (await exportArea(project, wetArea,'mix',wet,signal,()=>{})).arrayBuffer())
const dry = await render(false), wet = await render(true)
assert.equal(wet.numberOfFrames, dry.numberOfFrames)
assert.ok(dry.frames[0].slice(0,512).some(s=>Math.abs(s)>1e-4), 'note active before In is audible at In')
assert.ok(wet.frames[0].some((s,i) => Math.abs(s-dry.frames[0][i]) > 1e-4))
assert.deepEqual(new Uint8Array(project.toArrayBuffer()), saved)
const {createRoutingBus, connectRoute, disconnectRoute, routesOf} = await import('../src/flowtu/routing-graph')
createRoutingBus(project, EffectFactories.Reverb)
createRoutingBus(project)
const units = project.rootBoxAdapter.audioUnits.adapters()
const channel = units.find(u=>u.label === 'Recorded')!
const fx = units.find(u=>!u.isOutput && u.isBus && u.audioEffects.unwrap().size() === 1)!
const bus = units.find(u=>u.label === 'Bus 1')!
const master = units.find(u=>u.isOutput)!
assert.equal(routesOf(channel)[0].target,master)
connectRoute(project, channel, fx, 'send')
connectRoute(project, channel, fx, 'send')
assert.equal(channel.auxSends.size(), 1)
connectRoute(project, fx, bus, 'out')
assert.throws(() => connectRoute(project, bus, fx, 'send'), /feedback loop/)
assert.throws(() => connectRoute(project, bus, fx, 'out'), /feedback loop/)
const before = await render(true)
const patch = routesOf(channel).find(r=>r.port === 'send')!
disconnectRoute(project, patch)
const after = await render(true)
assert.ok(before.frames[0].some((s,i)=>Math.abs(s-after.frames[0][i]) > .0001), 'parallel FX is audible in the WASM mix')
project.editing.undo()
assert.equal(routesOf(channel).find(r=>r.port === 'send')?.target,fx)
const copyWithRoutes = project.copy()
const restored = copyWithRoutes.rootBoxAdapter.audioUnits.adapters().find(u=>u.label === 'Recorded')!
assert.deepEqual(routesOf(restored).map(r=>[r.port,r.target.label]), routesOf(channel).map(r=>[r.port,r.target.label]))
copyWithRoutes.terminate()
// The graphical EQ controls address these exact native parameters. Verify the DSP
// at the center frequency using a stereo WAV rendered by the shipped WASM plugin.
const eqProject = Project.fromSkeleton(env, ProjectSkeleton.empty({createDefaultUser:true, createOutputMaximizer:false}))
const {RevampDeviceBox} = await import('@opendaw/studio-boxes')
const filter = eqProject.editing.modify(() => {
    const tape = eqProject.api.createInstrument(InstrumentFactories.Tape)
    const audioFileBox = AudioFileBox.create(eqProject.boxGraph, sampleId, b => {
        b.fileName.setValue(sample.name); b.endInSeconds.setValue(sample.duration)
    })
    AudioContentFactory.createNotStretchedRegion({boxGraph:eqProject.boxGraph, targetTrack:tape.trackBox,
        sample, audioFileBox, name:'EQ stimulus', position:0})
    const filter = eqProject.api.insertEffect(tape.audioUnitBox.audioEffects, EffectFactories.Revamp)
    assert.ok(filter instanceof RevampDeviceBox)
    filter.midBell.enabled.setValue(true)
    filter.midBell.frequency.setValue(48000 / (24 * Math.PI))
    filter.midBell.gain.setValue(0)
    filter.midBell.q.setValue(1.5)
    return filter
}).unwrap()
async function eqRms() {
    const blob = await exportArea(eqProject, {start:0, end:Q}, 'mix', true, signal, () => {})
    const frames = WavFile.decodeFloats(await blob.arrayBuffer()).frames[0].subarray(2400, 11000)
    return Math.sqrt(frames.reduce((sum, sample) => sum + sample * sample, 0) / frames.length)
}
const flat = await eqRms()
eqProject.editing.modify(() => filter.midBell.gain.setValue(-12))
const cutDb = 20 * Math.log10(await eqRms() / flat)
assert.ok(flat > 0 && Math.abs(cutDb + 12) < .2, 'EQ bell cut measured ' + cutDb.toFixed(2) + ' dB')
eqProject.terminate()
console.log('WORK_AREA_RENDER_OK')
