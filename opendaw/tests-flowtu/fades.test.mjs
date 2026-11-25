import test from 'node:test'
import assert from 'node:assert/strict'
import {planCrossfade,fitFade,handleX} from '../src/flowtu/fades.ts'
test('existing overlap uses the exact intersecting segment without moving clips',()=>{
 assert.deepEqual(planCrossfade({start:100,end:600},{start:450,end:1000},50,'overlap'),{start:450,end:600,secondStart:450,duration:150,moved:false})
})
test('join moves only the second start and bounds the fade to both sources',()=>{
 assert.deepEqual(planCrossfade({start:0,end:1000},{start:1000,end:1600},200,'join'),{start:800,end:1000,secondStart:800,duration:200,moved:true})
 for(const value of [0,-1,600,1200,NaN])assert.throws(()=>planCrossfade({start:0,end:1000},{start:1000,end:1600},value,'join'))
})
test('rejects gaps, containment, reversed pairs and invalid spans',()=>{
 for(const b of [{start:600,end:900},{start:200,end:300},{start:50,end:1000}])assert.throws(()=>planCrossfade({start:100,end:600},b,200,'overlap'))
 assert.throws(()=>planCrossfade({start:100,end:100},{start:80,end:200},20,'overlap'))
})
test('fade editing prevents overlapping fade envelopes and invalid values',()=>{
 assert.deepEqual(fitFade(1000,700,500),{value:700,opposite:300})
 assert.deepEqual(fitFade(1000,1500,100),{value:1000,opposite:0})
 assert.throws(()=>fitFade(1000,-1,0));assert.throws(()=>fitFade(1000,NaN,0))
 assert.equal(handleX(0,100,0),7);assert.equal(handleX(0,100,100),93)
})
