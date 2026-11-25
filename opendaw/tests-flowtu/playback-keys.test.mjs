import test from 'node:test'
import assert from 'node:assert/strict'
import {playbackAction} from '../src/flowtu/playback-keys.ts'
test('Space playback and period stop never hijack composing or modified shortcuts',()=>{
 const event={key:' ',code:'Space',altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,isComposing:false}
 assert.equal(playbackAction(event),'toggle')
 assert.equal(playbackAction({...event,key:'.',code:'Period'}),'stop')
 for(const flag of ['altKey','ctrlKey','metaKey','shiftKey','isComposing'])assert.equal(playbackAction({...event,[flag]:true}),undefined)
 assert.equal(playbackAction({...event,key:'b',code:'KeyB'}),undefined)
})
test('return to project start uses the platform shortcut without consuming selection or undo modifiers',()=>{
 const arrow={key:'ArrowLeft',code:'ArrowLeft',altKey:false,shiftKey:false,ctrlKey:false,metaKey:true,isComposing:false}
 const home={...arrow,key:'Home',code:'Home',metaKey:false,ctrlKey:true}
 assert.equal(playbackAction(arrow,true),'start')
 assert.equal(playbackAction(home,false),'start')
 assert.equal(playbackAction(arrow,false),undefined)
 assert.equal(playbackAction(home,true),undefined)
 for(const flag of ['shiftKey','ctrlKey','altKey','isComposing'])assert.equal(playbackAction({...arrow,[flag]:true},true),undefined)
 assert.equal(playbackAction({...arrow,key:'z',code:'KeyZ'},true),undefined)
})
