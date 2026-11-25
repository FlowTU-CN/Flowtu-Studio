import test from 'node:test'
import assert from 'node:assert/strict'
import {seekTimeline, timelinePosition} from '../src/flowtu/timeline-seek.ts'
import {normalizeAudioRange,intersectsAudioRange,isSmartRangeZone} from '../src/flowtu/audio-range.ts'
test('range selection works in either direction and clamps negative/outside timeline values',()=>{
 assert.deepEqual(normalizeAudioRange(900,200,1000),{start:200,end:900})
 assert.deepEqual(normalizeAudioRange(-200,1400,1000),{start:0,end:1000})
 assert.equal(intersectsAudioRange(0,200,{start:200,end:900}),false)
 assert.equal(intersectsAudioRange(800,1200,{start:200,end:900}),true)
})
test('smart range selection reserves move, trim and fade zones',()=>{
 assert.equal(isSmartRangeZone(50,65,0,100,0,100,20),true)
 assert.equal(isSmartRangeZone(50,30,0,100,0,100,20),false)
 assert.equal(isSmartRangeZone(4,65,0,100,0,100,20),false)
 assert.equal(isSmartRangeZone(96,65,0,100,0,100,20),false)
 assert.equal(isSmartRangeZone(50,99,0,100,0,100,20),false)
})


test('smart drag boundary resists jitter and leaves a selection zone on narrow clips', () => {
 const zone = (x,y,previous) => isSmartRangeZone(x,y,0,20,0,100,20,previous)
 assert.equal(zone(10,41,false),false)
 assert.equal(zone(10,43,false),true)
 assert.equal(zone(10,39,true),true)
 assert.equal(zone(10,37,true),false)
 assert.equal(zone(5,70,true),false)
})

test('a stopped mark uses the newest locate, including a cancelled gesture, until playback takes over', () => {
    function observable(initial) {
        let value = initial
        const listeners = new Set()
        return {
            getValue() {return value},
            subscribe(fn) {listeners.add(fn); return {terminate: () => listeners.delete(fn)}},
            report(next) {value = next; for (const fn of listeners) fn(this)}
        }
    }
    const requests = []
    const engine = {position: observable(10), isPlaying: observable(false), setPosition: pulse => requests.push(pulse)}
    const project = {engine, own() {}}
    seekTimeline(project, 20)
    seekTimeline(project, 30)
    assert.equal(timelinePosition(project), 30)
    engine.position.report(20)
    assert.equal(timelinePosition(project), 30)
    seekTimeline(project, 10) // Escape restores the pre-gesture playhead.
    engine.position.report(30)
    assert.equal(timelinePosition(project), 10)
    engine.position.report(10)
    engine.position.report(0)
    assert.equal(timelinePosition(project), 0)
    seekTimeline(project, 90)
    engine.isPlaying.report(true)
    engine.position.report(12)
    assert.equal(timelinePosition(project), 12)
    seekTimeline(project, 42)
    assert.equal(timelinePosition(project), 12)
    assert.deepEqual(requests, [20, 30, 10, 90, 42])
})
