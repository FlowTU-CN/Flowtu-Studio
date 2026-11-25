import test from 'node:test'
import assert from 'node:assert/strict'
import {FRAME_RATES,getFrameRate,formatTimelineTime,parseTimelineTime,frameToSeconds,secondsToFrame,quantizeSeconds} from '../src/flowtu/time-format.ts'
import {snapTimePosition,timeGridIndex,timeGridPosition} from '../src/flowtu/time-snap.ts'

test('millisecond clock carries seconds, minutes and hours without displaying 60 seconds',()=>{
 const rate=getFrameRate('25')
 assert.equal(formatTimelineTime(59.9996,'time',rate),'00:01:00.000')
 assert.equal(formatTimelineTime(3599.9996,'time',rate),'01:00:00.000')
 assert.equal(formatTimelineTime(.01,'time',rate),'00:00:00.010')
 assert.equal(parseTimelineTime('01:02:03.010','time',rate),3723.01)
 assert.equal(parseTimelineTime('2:03.010','time',rate),123.01)
 assert.equal(parseTimelineTime('0.01','time',rate),.01)
 for(const invalid of ['00:60:00.000','-1','Infinity','1:99',''])assert.equal(parseTimelineTime(invalid,'time',rate),null)
})
test('every FPS preserves frame count across hour boundaries and rejects invalid timecode',()=>{
 for(const rate of FRAME_RATES){
  for(const frame of [0,1,rate.nominal-1,rate.nominal,rate.nominal*60-1,rate.nominal*3600+5]){
   const seconds=frameToSeconds(frame,rate),code=formatTimelineTime(seconds,'timecode',rate)
   assert.equal(secondsToFrame(seconds,rate,'floor'),frame)
   assert.equal(secondsToFrame(seconds,rate,'ceil'),frame)
   const frameClock=formatTimelineTime(seconds,'frames',rate)
   assert.equal(frameClock,code.replace(/:(\d{2})$/,'.$1'))
   assert.equal(parseTimelineTime(frameClock,'frames',rate),seconds)
   assert.equal(parseTimelineTime(String(frame),'frames',rate),seconds)
   assert.ok(Math.abs(parseTimelineTime(code,'timecode',rate)-seconds)<1e-9)
  }
  assert.equal(formatTimelineTime(frameToSeconds(rate.nominal*60,rate),'timecode',rate),'00:01:00:00')
  assert.equal(parseTimelineTime(`00:00:00:${rate.nominal}`,'timecode',rate),null)
  assert.equal(parseTimelineTime('00:00:60:00','timecode',rate),null)
  assert.equal(parseTimelineTime('1.5','frames',rate),null)
  assert.equal(parseTimelineTime(`00:00:00.${rate.nominal}`,'frames',rate),null)
  assert.equal(parseTimelineTime('00:01:00.000','frames',rate),null)
 }
 assert.equal(parseTimelineTime('00:01:00:00','timecode',getFrameRate('29.97')),60.06)
})
test('frame display rolls at the project rate and accepts a pasted frame count or timecode',()=>{
 const rate=getFrameRate('25')
 for(const [frame,clock] of [[470,'00:00:18.20'],[1499,'00:00:59.24'],[1500,'00:01:00.00']]){
  const seconds=frameToSeconds(frame,rate)
  assert.equal(formatTimelineTime(seconds,'frames',rate),clock)
  assert.equal(parseTimelineTime(clock,'frames',rate),seconds)
  assert.equal(parseTimelineTime(clock.replace('.',':'),'frames',rate),seconds)
 }
})
test('10 ms quantization is stable for decimal boundaries and negative positions',()=>{
 assert.equal(quantizeSeconds(.1451,.01),.15)
 assert.equal(quantizeSeconds(.1451,.01,'floor'),.14)
 assert.equal(quantizeSeconds(.1451,.01,'ceil'),.15)
 assert.equal(quantizeSeconds(.29,.01,'floor'),.29)
 assert.equal(quantizeSeconds(-.014,.01,'floor'),-.02)
 assert.throws(()=>quantizeSeconds(1,0))
})
// 120 BPM until one second, then 60 BPM. The second segment deliberately has an off-grid pulse origin.
const map={
 ppqnToSeconds:p=>p<=1920?p/1920:1+(p-1920)/960,
 secondsToPPQN:s=>s<=1?s*1920:1920+(s-1)*960
}
test('absolute 10 ms and rational-frame grids stay stable through tempo changes and integer clip storage',()=>{
 for(const interval of [.01,1/25,1001/30000]){
  for(const seconds of [.004,.149, .999,1.003,1.294,6.123]){
   const position=map.secondsToPPQN(seconds)
   for(const rounding of ['round','floor','ceil']){
    const snapped=snapTimePosition(map,position,interval,rounding)
    const expectedIndex=Math[rounding](seconds/interval)
    assert.equal(snapped,Math.round(map.secondsToPPQN(expectedIndex*interval)))
    // Native positions are Int32 PPQN: subsequent drag operations must not creep a frame/grid step.
    for(const again of ['round','floor','ceil'])assert.equal(snapTimePosition(map,snapped,interval,again),snapped)
    assert.ok(Math.abs(map.ppqnToSeconds(snapped)-expectedIndex*interval)<=1/1920)
   }
  }
 }
 const position=timeGridPosition(map,100,.01)
 assert.equal(timeGridPosition(map,timeGridIndex(map,position,.01,'floor')+1,.01),1930)
 assert.equal(timeGridPosition(map,timeGridIndex(map,position,.01,'ceil')-1,.01),1901)
})

test('source clocks include high-speed and non-preset video rates',async()=>{
 const {sourceFrameRateId}=await import('../src/flowtu/time-format.ts')
 for (const [observed,id] of [[30000/1001,'29.97'],[48000/1001,'47.952'],[120,'120'],[12.5,'12.5']]) {
  assert.equal(sourceFrameRateId(observed),id)
  const rate=getFrameRate(id)
  assert.ok(Math.abs(rate.numerator/rate.denominator-observed)<1e-8)
  const frame=rate.nominal-1,seconds=frameToSeconds(frame,rate)
  assert.equal(parseTimelineTime(formatTimelineTime(seconds,'timecode',rate),'timecode',rate),seconds)
 }
})
