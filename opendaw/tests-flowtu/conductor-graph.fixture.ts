import assert from 'node:assert/strict'
Reflect.set(globalThis, 'AudioWorkletNode', class {})
const {PPQN, Interpolation} = await import('@opendaw/lib-dsp')
const {ProjectSkeleton} = await import('@opendaw/studio-adapters')
const {Project} = await import('@opendaw/studio-core')
const {setMeterPoint, setTempoPoint} = await import('../src/ui/timeline/tracks/primary/conductor-points')
// No sample-backed devices are needed for a conductor-only project.
const env = {
    audioContext: {
        currentTime: 0, sampleRate: 48000,
        createGain: () => ({connect() {}, disconnect() {}, gain: {value: 1}}),
        createStereoPanner: () => ({connect() {}, disconnect() {}, pan: {value: 0}})
    }
} as never
const project = Project.fromSkeleton(env, ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}))
const bar = PPQN.Bar, map = project.tempoMap, track = project.timelineBoxAdapter.signatureTrack
const close = (actual:number, expected:number) => assert.ok(Math.abs(actual-expected)<1e-7, `Expected ${expected}, got ${actual}`)
setTempoPoint(project, bar, 60)
close(map.ppqnToSeconds(bar), 2)
close(map.ppqnToSeconds(2*bar), 6)
setTempoPoint(project, bar, 80)
close(map.ppqnToSeconds(2*bar), 5)
project.editing.undo()
close(map.ppqnToSeconds(2*bar), 6)
setMeterPoint(project, bar+PPQN.Quarter, 3, 4)
assert.deepEqual(track.signatureAt(bar-1), [4,4])
assert.deepEqual(track.signatureAt(bar), [3,4])
assert.equal(track.toParts(bar+3*PPQN.Quarter).bars, 2)
setMeterPoint(project, bar+PPQN.Quarter, 6, 8)
assert.equal(track.size,1)
const loaded=Project.load(env, project.toArrayBuffer() as ArrayBuffer)
assert.deepEqual(loaded.timelineBoxAdapter.signatureTrack.signatureAt(bar), [6,8])
close(loaded.tempoMap.ppqnToSeconds(2*bar),6)
project.editing.modify(()=>project.timelineBox.tempoTrack.enabled.setValue(false))
close(map.ppqnToSeconds(2*bar),4)
close(map.secondsToPPQN(4),2*bar)
close(map.intervalToSeconds(bar,2*bar),2)
close(map.getTempoAt(2*bar),120)
project.editing.undo()
close(map.ppqnToSeconds(2*bar),6)
// Use a fresh conductor so placing the first ramp in the middle also tests its origin.
const curved = Project.fromSkeleton(env, ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}))
const curveMap = curved.tempoMap, meter = curved.timelineBoxAdapter.signatureTrack
setMeterPoint(curved, 0, 3, 4)
const changeAt = 3 * PPQN.Quarter
setMeterPoint(curved, changeAt + 2, 11, 8)
assert.deepEqual(meter.signatureAt(changeAt - 1), [3, 4])
assert.deepEqual(meter.signatureAt(changeAt), [11, 8])
assert.equal(meter.toParts(changeAt + 10 * PPQN.Quarter / 2).beats, 10)
assert.equal(meter.toParts(changeAt + 11 * PPQN.Quarter / 2).bars, 2)
setMeterPoint(curved, changeAt, 3, 5)
assert.deepEqual(meter.signatureAt(changeAt), [11, 8])
for (const slope of [0.5, 0.25, 0.75, 0, 1]) {
    setTempoPoint(curved, changeAt, 60, Interpolation.Curve(slope))
    close(curveMap.getTempoAt(changeAt / 2), 120 - 60 * slope)
    // Independent midpoint integration in musical time, including near-step bends.
    const samples = 16384
    let elapsed = 0
    for (let i = 0; i < samples; i++) {
        elapsed += PPQN.pulsesToSeconds(changeAt / samples, curveMap.getTempoAt((i + 0.5) * changeAt / samples))
    }
    assert.ok(Math.abs(curveMap.ppqnToSeconds(changeAt) - elapsed) < 1e-6)
    for (const fraction of [0.01, 0.25, 0.5, 0.7, 0.99, 1.1]) {
        close(curveMap.secondsToPPQN(curveMap.ppqnToSeconds(changeAt * fraction)), changeAt * fraction)
    }
}
setTempoPoint(curved, changeAt, 120, Interpolation.Curve(0.75))
close(curveMap.ppqnToSeconds(changeAt), 1.5)
curved.editing.undo()
close(curveMap.getTempoAt(changeAt / 2), 60)
setTempoPoint(curved, changeAt, 60, Interpolation.Curve(0.75))
const reopened = Project.load(env, curved.toArrayBuffer() as ArrayBuffer)
close(reopened.tempoMap.getTempoAt(changeAt / 2), 75)
close(reopened.tempoMap.ppqnToSeconds(changeAt), curveMap.ppqnToSeconds(changeAt))
assert.deepEqual(reopened.timelineBoxAdapter.signatureTrack.signatureAt(changeAt), [11, 8])
// A viewport beginning inside an odd bar must preserve the same shading and beat phase as the whole score.
const {TimelineRange} = await import('@opendaw/studio-core')
const {renderBarBeatGrid} = await import('../src/ui/timeline/tracks/audio-unit/BarBeatGrid')
const range = new TimelineRange()
range.maxUnits = 16 * PPQN.Bar
range.width = 850
const eighth = PPQN.Quarter / 2
const paintGrid = (start: number, end: number) => {
    range.showUnitInterval(start, end)
    const fills: {x: number, width: number}[] = []
    const context = {fillRect(x: number, _y: number, width: number) {fills.push({x, width})}} as CanvasRenderingContext2D
    renderBarBeatGrid({context, width: range.width, actualHeight: 96, devicePixelRatio: 1}, range, meter)
    return fills
}
const allBars = paintGrid(0, changeAt + 11 * eighth)
assert.equal(allBars.filter(rect => rect.width === 1).length, 3 + 11)
const band = allBars.find(rect => rect.width > 1)!
assert.equal(band.x, Math.floor(range.unitToX(changeAt)))
const partial = paintGrid(changeAt + 3 * eighth, changeAt + 7 * eighth)
assert.ok(partial.some(rect => rect.x < 0 && rect.x + rect.width >= range.width - 1))
assert.deepEqual(partial.filter(rect => rect.width === 1 && rect.x >= 0).map(rect => rect.x),
    [3, 4, 5, 6].map(beat => Math.floor(range.unitToX(changeAt + beat * eighth))))
const {musicalRulerTicks} = await import('../src/ui/timeline/musical-ruler')
range.showUnitInterval(0, changeAt + 11 * eighth)
assert.equal(musicalRulerTicks(range, meter, 0).find(t => t.x === 0)?.label, '0')
const farBar = changeAt + 10000 * 11 * eighth
range.minimum = 0.01 // exercise sub-tick zoom as well as the current UI limit
range.maxUnits = farBar + 11 * eighth
range.showUnitInterval(farBar + 9 * eighth + 170, farBar + 9 * eighth + 181)
const fine = musicalRulerTicks(range, meter, 1).filter(t => t.x >= 0 && t.x < range.width)
assert.deepEqual(fine.map(t => t.label), Array.from({length: 11}, (_, i) => `10002•10•1:${170+i}`))
range.showUnitInterval(farBar + 9 * eighth + 170.1, farBar + 9 * eighth + 170.9)
assert.deepEqual(musicalRulerTicks(range, meter, 1).filter(t => t.x >= 0), [])
console.log('CONDUCTOR_OK')
