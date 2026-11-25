import test from 'node:test'
import assert from 'node:assert/strict'
import {parseCommand,generateNotes,encodeMidi} from '../src/flowtu/commands.ts'
test('Chinese request retains instrument, form, key, tempo and effect',()=>{
 const c=parseCommand('生成 8 小节温暖的电钢琴和弦，D 小调，90 BPM，加 15% 混响')
 assert.equal(c.tone,'keys');assert.equal(c.pattern,'chords');assert.equal(c.tonic,2);assert.equal(c.minor,true);assert.equal(c.bpm,90);assert.equal(c.reverb,.15);assert.equal(c.bars,8)
})
test('effect-only and tone-only requests do not create MIDI',()=>{
 const c=parseCommand('给第 2 轨加 25% 混响');assert.equal(c.action,'effect');assert.equal(c.target,2);assert.equal(c.reverb,.25)
 assert.equal(parseCommand('把第四轨换成钟琴').action,'tone')
 assert.equal(parseCommand('关闭第 2 轨混响').removeEffect,true)
 assert.equal(parseCommand('速度设为 100 BPM').action,'tempo')
})
test('invalid requests do not silently fall back to notes',()=>{
 for(const s of ['你好','生成 0 小节贝斯','生成 100 小节钢琴','给第 0 轨加混响','加 120% 混响','生成小提琴','生成钢琴 300 BPM','生成 -4 小节钢琴','加 -20% 混响','速度 -100 BPM'])assert.throws(()=>parseCommand(s),s)
})
test('all local patterns generate bounded playable notes with no same-pitch overlaps',()=>{
 for(const tone of ['keys','bass','pad','pluck','lead','bell'])for(const pattern of ['和弦','琶音','旋律','低音']){
 const c=parseCommand('生成 16 小节 '+pattern+'，A 小调',tone,16);const ns=generateNotes(c,4)
 assert.ok(ns.length>0);for(const n of ns){assert.ok(n.pitch>=0&&n.pitch<=127);assert.ok(n.beat>=0&&n.length>0&&n.beat+n.length<=64);assert.ok(n.velocity>0&&n.velocity<=1)}
 for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++)if(ns[i].pitch===ns[j].pitch)assert.ok(ns[i].beat+ns[i].length<=ns[j].beat||ns[j].beat+ns[j].length<=ns[i].beat)
 }
})
test('MIDI export has an SMF header, matching chunk length and end marker',()=>{
 const notes=generateNotes(parseCommand('生成 4 小节拨弦琶音'))
 const data=encodeMidi(notes,100),view=new DataView(data.buffer)
 assert.equal(new TextDecoder().decode(data.slice(0,4)),'MThd');assert.equal(view.getUint16(12),480)
 assert.equal(view.getUint32(18),data.length-22);assert.deepEqual([...data.slice(-4)],[0,255,47,0])
 assert.equal([...data].filter((v,i)=>v===144&&i>22).length,notes.length)
})

test('follow-up instruments inherit harmony and key without changing project tempo',()=>{
 const first=parseCommand('生成 8 小节电钢琴和弦，D 小调，90 BPM')
 const context={tonic:first.tonic,minor:first.minor,bars:first.bars,harmony:[[62,65,69],[70,74,77],[65,69,72],[60,64,67]]}
 const bass=parseCommand('再加一条贝斯','keys',context.bars,context)
 assert.equal(bass.usesContext,true);assert.equal(bass.tonic,2);assert.equal(bass.minor,true);assert.equal(bass.bars,8);assert.equal(bass.bpm,undefined)
 const notes=generateNotes(bass)
 for(let bar=0;bar<8;bar++){
  const chord=context.harmony[bar%4].map(p=>p%12)
  assert.equal(notes.find(n=>n.beat===bar*4).pitch%12,chord[0])
  assert.ok(notes.filter(n=>Math.floor(n.beat/4)===bar).every(n=>chord.includes(n.pitch%12)))
 }
 const changed=parseCommand('生成 2 小节拨弦琶音，E 大调','keys',8,context)
 assert.equal(changed.usesContext,false);assert.equal(changed.tonic,4);assert.equal(changed.minor,false);assert.equal(changed.harmony,undefined)
 const fx=parseCommand('给它加 20% 混响','keys',8,context)
 assert.equal(fx.action,'effect');assert.equal(fx.bpm,undefined)
})
test('explicit chord progression is used by each generated instrument',()=>{
 const first=parseCommand('生成 4 小节电钢琴，D 小调，和弦进行：Dm Bb F C')
 assert.deepEqual(first.harmony,[[62,65,69],[70,74,77],[65,69,72],[60,64,67]])
 for(const tone of ['bass','lead','pad','pluck']){
  const c=parseCommand('生成 4 小节',''+tone,4,{...first,harmony:first.harmony})
  for(const n of generateNotes(c))assert.ok(first.harmony[Math.floor(n.beat/4)%4].some(p=>p%12===n.pitch%12))
 }
 assert.throws(()=>parseCommand('生成钢琴，和弦进行：C nonsense G'))
})
