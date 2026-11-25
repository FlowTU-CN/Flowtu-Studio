import test from 'node:test'
import assert from 'node:assert/strict'
import {envelopeLocalPosition,envelopeValue,boundedEnvelopePosition} from '../src/flowtu/envelope.ts'

test('inline automation targets the displayed repeat and respects the trimmed source offset',()=>{
 assert.equal(envelopeLocalPosition(1600,1000,1920),600)
 assert.equal(envelopeLocalPosition(3520,1000,1920),600)
 assert.equal(envelopeLocalPosition(900,1000,1920),1820)
 assert.equal(envelopeLocalPosition(2919.9,1000,1920),1919)
 assert.equal(envelopeLocalPosition(2920,1000,1920),0)
 assert.equal(envelopeLocalPosition(NaN,0,0),0)
})

test('vertical automation edits clamp to the audible parameter range',()=>{
 assert.equal(envelopeValue(10,10,110),1)
 assert.equal(envelopeValue(110,10,110),0)
 assert.equal(envelopeValue(60,10,110),.5)
 assert.equal(envelopeValue(-50,10,110),1)
 assert.equal(envelopeValue(300,10,110),0)
})

test('node dragging cannot reorder neighbours or escape its source loop',()=>{
 assert.equal(boundedEnvelopePosition(-25,1000),0)
 assert.equal(boundedEnvelopePosition(1500,1000),999)
 assert.equal(boundedEnvelopePosition(50,1000,100,300),101)
 assert.equal(boundedEnvelopePosition(400,1000,100,300),299)
 assert.equal(boundedEnvelopePosition(250.4,1000,100,300),250)
})
