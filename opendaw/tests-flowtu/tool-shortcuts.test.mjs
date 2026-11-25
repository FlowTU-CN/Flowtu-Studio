import test from 'node:test'
import assert from 'node:assert/strict'
import {toolForKey} from '../src/flowtu/tool-shortcuts.ts'
test('editor tool keys follow A/V smart, B blade and R range without swallowing command shortcuts',()=>{
 for(const [key,tool] of Object.entries({a:'select',V:'select',b:'cut',B:'cut',r:'range',t:'trim',f:'fade','1':'select','2':'cut','7':'range'}))assert.equal(toolForKey(key),tool)
 for(const flag of ['altKey','ctrlKey','metaKey','shiftKey'])assert.equal(toolForKey('b',{[flag]:true}),undefined)
 assert.equal(toolForKey('m'),undefined);assert.equal(toolForKey('5'),'mute')
 assert.equal(toolForKey(' '),undefined);assert.equal(toolForKey('Escape'),undefined)
})

test('profile-specific tools and split commands preserve modifiers and reserve P for locators', async () => {
 const {setKeyProfile, profileSplit, toolKeyLabel} = await import('../src/flowtu/tool-shortcuts.ts')
 try {
  setKeyProfile('video')
  assert.equal(toolForKey('b'),'cut')
  assert.equal(toolForKey('2'),undefined)
  assert.equal(toolKeyLabel('range'),'R')
  setKeyProfile('cubase')
  assert.equal(toolForKey('2'),'range')
  assert.equal(toolForKey('3'),'cut')
  assert.equal(toolForKey('3',{code:'Numpad3'}),undefined)
  assert.equal(profileSplit('≈',{altKey:true,code:'KeyX'}),true)
  setKeyProfile('protools')
  assert.equal(toolForKey('F7'),'range')
  assert.equal(toolForKey('F6',{ctrlKey:true}),undefined)
  assert.equal(toolForKey('p'),undefined)
  assert.equal(profileSplit('b',{}),true)
  assert.equal(toolForKey('b'),undefined)
 } finally {setKeyProfile('flowtu')}
})
