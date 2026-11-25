import assert from 'node:assert/strict'
Reflect.set(globalThis, 'AudioWorkletNode', class {})
const {Option, Terminable, UUID} = await import('@opendaw/lib-std')
const {PPQN, TimeBase} = await import('@opendaw/lib-dsp')
const {ProjectSkeleton, InstrumentFactories, AudioRegionBoxAdapter, TrackBoxAdapter} = await import('@opendaw/studio-adapters')
const {AudioFileBox} = await import('@opendaw/studio-boxes')
const {Project, AudioContentFactory, RegionsClipboard} = await import('@opendaw/studio-core')
const {copyAudioRange} = await import('../src/flowtu/range-clipboard')

const env = {
    audioContext: {currentTime: 0, sampleRate: 48000,
        createGain: () => ({connect() {}, disconnect() {}, gain: {value: 1}}),
        createStereoPanner: () => ({connect() {}, disconnect() {}, pan: {value: 0}})},
    audioWorklets: undefined,
    sampleManager: {getOrCreate: (uuid: unknown) => ({
        get data() {return Option.None}, get peaks() {return Option.None}, get uuid() {return uuid},
        get state() {return {type: 'idle'}}, invalidate() {}, subscribe: () => Terminable.Empty
    }), record() {}, invalidate() {}, remove() {}, register: () => Terminable.Empty},
    soundfontManager: undefined, sampleService: undefined, soundfontService: undefined
} as never
const project = Project.fromSkeleton(env, ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false}))
const Q = PPQN.Quarter
const {track, target, a, b, file} = project.editing.modify(() => {
    const {trackBox} = project.api.createInstrument(InstrumentFactories.Tape)
    const targetBox = project.api.createInstrument(InstrumentFactories.Tape).trackBox
    const file = AudioFileBox.create(project.boxGraph, UUID.generate(), box => {
        box.fileName.setValue('Range clipboard test'); box.startInSeconds.setValue(0); box.endInSeconds.setValue(12)
    })
    const create = (position: number) => project.boxAdapters.adapterFor(AudioContentFactory.createNotStretchedRegion({
        boxGraph: project.boxGraph, targetTrack: trackBox, audioFileBox: file,
        sample: {name: 'Imported audio', duration: 4, bpm: 0} as never, position, waveformOffset: 1
    }), AudioRegionBoxAdapter)
    const a = create(2 * Q), b = create(12 * Q)
    a.loopOffset = Q
    return {track: project.boxAdapters.adapterFor(trackBox, TrackBoxAdapter),
        target: project.boxAdapters.adapterFor(targetBox, TrackBoxAdapter), a, b, file}
}, true).unwrap()
const source = new Uint8Array(project.boxGraph.toArrayBuffer())
let cursor = 30 * Q
const handler = RegionsClipboard.createHandler({
    getEnabled: () => true, getPosition: () => cursor, setPosition: value => {cursor = value},
    editing: project.editing, selection: project.regionSelection, boxGraph: project.boxGraph,
    boxAdapters: project.boxAdapters, getTracks: () => [track, target],
    getFocusedTrack: () => Option.wrap(target), overlapResolver: project.overlapResolver
})
const targetRegions = () => target.regions.collection.asArray().filter(r => r instanceof AudioRegionBoxAdapter).sort((x, y) => x.position - y.position)
const spans = () => targetRegions().map(r => [r.position / Q, r.complete / Q])

// Import/no-warp regions store raw duration in seconds but their loop offset in
// pulses. Native paste must produce cropped fragments with the same audio source.
const cropped = copyAudioRange(project, {track, start: 4 * Q, end: 16 * Q})
assert.equal(cropped.count, 2)
assert.deepEqual(new Uint8Array(project.boxGraph.toArrayBuffer()), source)
assert.equal(a.loopOffset, Q)
assert.equal(a.duration, 8 * Q)
assert.equal(b.duration, 8 * Q)
handler.paste(cropped)
assert.deepEqual(spans(), [[30, 36], [38, 42]])
assert.equal(cursor, 42 * Q)
const [first, second] = targetRegions()
assert.equal(first.timeBase, TimeBase.Seconds)
assert.equal(first.box.duration.getValue(), 3)
assert.equal(second.box.duration.getValue(), 2)
assert.equal(first.loopOffset, 3 * Q)
assert.equal(second.loopOffset, 0)
assert.equal(first.waveformOffset.getValue(), 1)
assert.ok(targetRegions().every(r => UUID.toString(r.file.uuid) === UUID.toString(file.address.uuid)))
assert.notEqual(UUID.toString(first.uuid), UUID.toString(a.uuid))
project.editing.undo()
assert.deepEqual(spans(), [])
assert.deepEqual(new Uint8Array(project.boxGraph.toArrayBuffer()), source)

// Preserve silence at both selection edges as well as the gap between clips.
cursor = 30 * Q
handler.paste(copyAudioRange(project, {track, start: 0, end: 22 * Q}))
assert.deepEqual(spans(), [[32, 40], [42, 50]])
assert.equal(cursor, 52 * Q)
project.editing.undo()
assert.deepEqual(new Uint8Array(project.boxGraph.toArrayBuffer()), source)
assert.throws(() => copyAudioRange(project, {track, start: 10 * Q, end: 12 * Q}), /no audio/)
assert.throws(() => copyAudioRange(project, {track, start: NaN, end: Q}), /valid time range/)
assert.deepEqual(new Uint8Array(project.boxGraph.toArrayBuffer()), source)

// Anchoring the drag in the lower row keeps upward offsets when several rows are copied.
const {copyTrackRanges,checkPasteTracks}=await import('../src/flowtu/range-clipboard')
const {editAudioRanges}=await import('../src/flowtu/range-edit')
project.editing.modify(()=>a.copyTo({position:6*Q,target:target.box.regions}),true)
const initialGraph=new Uint8Array(project.boxGraph.toArrayBuffer())
const rowOrder=[track,target]
const interval={track:target,start:7*Q,end:11*Q}
const grouped=copyTrackRanges(project,interval,rowOrder,rowOrder)
assert.equal(grouped.count,2)
assert.throws(()=>checkPasteTracks(project,grouped,rowOrder,track),/destination track order/)
checkPasteTracks(project,grouped,rowOrder,target)
cursor=40*Q
handler.paste(grouped)
assert.equal(cursor,44*Q)
const rendered=(row:typeof track)=>row.regions.collection.asArray().filter(r=>r.position>=40*Q).map(r=>[r.position/Q,r.complete/Q])
assert.deepEqual(rendered(track),[[40,43]])
assert.deepEqual(rendered(target),[[40,44]])
project.editing.undo()
assert.deepEqual(new Uint8Array(project.boxGraph.toArrayBuffer()),initialGraph)
editAudioRanges(project,rowOrder,interval,'delete')
assert.ok(rowOrder.every(row=>row.regions.collection.asArray().every(r=>r.complete<=interval.start || r.position>=interval.end)))
project.editing.undo()
assert.deepEqual(new Uint8Array(project.boxGraph.toArrayBuffer()),initialGraph)
assert.throws(()=>editAudioRanges(project,rowOrder,{start:65*Q,end:66*Q},'delete'),/no audio/)
assert.deepEqual(new Uint8Array(project.boxGraph.toArrayBuffer()),initialGraph)
console.log('RANGE_CLIPBOARD_OK: no source mutation, native paste, seconds timebase, source offsets, gaps, leading and trailing silence, undo')
