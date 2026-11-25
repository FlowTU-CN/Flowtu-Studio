import assert from 'node:assert/strict'
Reflect.set(globalThis, 'AudioWorkletNode', class {})
const {Option, Terminable, UUID} = await import('@opendaw/lib-std')
const {TimeBase} = await import('@opendaw/lib-dsp')
const {ProjectSkeleton, InstrumentFactories, TrackType} = await import('@opendaw/studio-adapters')
const {Project} = await import('@opendaw/studio-core')
const {addVideoAudioTrack, importVideoOriginalAudio} = await import('../src/flowtu/VideoImport')
const env = {audioContext: {currentTime: 0, sampleRate: 48000, createGain: () => ({connect() {}, disconnect() {}, gain: {value: 1}}), createStereoPanner: () => ({connect() {}, disconnect() {}, pan: {value: 0}})}, audioWorklets: undefined, sampleManager: {getOrCreate: (uuid: unknown) => ({get data() {return Option.None}, get peaks() {return Option.None}, get uuid() {return uuid}, get state() {return {type: 'idle'}}, invalidate() {}, subscribe: () => Terminable.Empty}), record() {}, invalidate() {}, remove() {}, register: () => Terminable.Empty}, soundfontManager: undefined, sampleService: undefined, soundfontService: undefined} as never
const project = Project.fromSkeleton(env, ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false}))
project.editing.modify(() => {
    project.api.setBpm(97)
    for (let i = 0; i < 4; i++) project.api.createInstrument(InstrumentFactories.Tape)
})
const units = () => project.rootBox.audioUnits.pointerHub.incoming().map(p => UUID.toString(p.box.address.uuid))
const originalUnits = units()
const sample = {uuid: UUID.toString(UUID.generate()), name: 'Reference original', duration: 4, bpm: 0, sample_rate: 48000, origin: 'import'} as never
const result = addVideoAudioTrack(project, sample, 'reference.mp4', 1.23)
assert.equal(units().length, originalUnits.length + 1)
assert.ok(originalUnits.every(id => units().includes(id)))
assert.equal(result.track.type.getValue(), TrackType.Audio)
assert.equal(result.region.timeBase, TimeBase.Seconds)
assert.deepEqual([result.region.fading.inSlope,result.region.fading.outSlope],[.75,.25])
assert.ok(Math.abs(project.tempoMap.ppqnToSeconds(result.region.position) - 1.23) < .0007)
assert.equal(result.region.box.duration.getValue(), 4)
assert.equal(result.region.waveformOffset.getValue(), 0)
assert.match(result.region.box.label.getValue(), /reference\.mp4.*Original Audio/)
assert.equal(result.region.file.uuid.toString(), UUID.parse(sample.uuid).toString())
project.editing.undo()
assert.deepEqual(units(), originalUnits)
project.editing.redo()
assert.equal(units().length, originalUnits.length + 1)
project.editing.undo()

const negative = addVideoAudioTrack(project, sample, 'reference.mp4', -1.25)
assert.equal(negative.region.position, 0)
assert.equal(negative.region.waveformOffset.getValue(), 1.25)
assert.equal(negative.region.box.duration.getValue(), 2.75)
assert.equal(negative.region.box.loopDuration.getValue(), 2.75)
project.editing.undo()
for (const offset of [-4, NaN, Infinity]) assert.throws(() => addVideoAudioTrack(project, sample, 'reference.mp4', offset))
assert.deepEqual(units(), originalUnits)

const file = {name: 'reference.mp4', arrayBuffer: async () => new ArrayBuffer(8)} as File
const service = {hasProfile: true, project, sampleService: {importFile: async () => {throw new Error('Could not decode audio file')}}, sampleManager: {getAudioData: async () => ({})}}
await assert.rejects(() => importVideoOriginalAudio(service as never, project, file, 0), /Could not decode/)
assert.deepEqual(units(), originalUnits, 'Decode failure must not add an empty track')
let importedBpm = -1
service.sampleService.importFile = async (args: {bpm: number}) => {importedBpm = args.bpm; return sample}
await importVideoOriginalAudio(service as never, project, file, 0)
assert.equal(importedBpm, 0, 'Original soundtrack must not be stretched to detected tempo')
assert.equal(units().length, originalUnits.length + 1)
project.editing.undo()
service.sampleService.importFile = async () => {service.hasProfile = false; return sample}
await assert.rejects(() => importVideoOriginalAudio(service as never, project, file, 0), /project changed/)
assert.deepEqual(units(), originalUnits, 'Changing project during import must not create an old-project track')
console.log('VIDEO_IMPORT_GRAPH_OK')
