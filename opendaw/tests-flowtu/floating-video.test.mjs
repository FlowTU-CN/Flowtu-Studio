import test from 'node:test'
import assert from 'node:assert/strict'
import {fitFloatingVideo,defaultFloatingVideo,readFloatingVideoGeometry} from '../src/flowtu/floating-video-geometry.ts'

test('a dragged window remains entirely inside the viewport',()=>{
    const viewport={width:1280,height:720}
    for(const [x,y] of [[-2000,-1000],[2000,1000],[600,-5]]){
        const result=fitFloatingVideo({x,y,width:380,height:367},viewport)
        assert.ok(result.x>=10&&result.y>=10)
        assert.ok(result.x+result.width<=1270)
        assert.ok(result.y+result.height<=710)
    }
})

test('restored geometry adapts to a smaller monitor while keeping controls reachable',()=>{
    const result=fitFloatingVideo({x:1800,y:900,width:900,height:677},{width:375,height:667})
    assert.equal(result.width,355)
    assert.equal(result.x,10)
    assert.ok(result.y>=10&&result.y+result.height<=657)
    const short=fitFloatingVideo({x:900,y:800,width:400,height:300},{width:230,height:180})
    assert.equal(short.width,210)
    assert.equal(short.x,10);assert.equal(short.y,10)
})

test('window width and height can change independently within viewport limits',()=>{
    const viewport={width:1440,height:900}
    const rectangle={x:20,y:20,width:840,height:270}
    assert.deepEqual(fitFloatingVideo(rectangle,viewport),rectangle)
    assert.equal(fitFloatingVideo({...rectangle,width:-500},viewport).width,260)
    assert.equal(fitFloatingVideo({...rectangle,height:40},viewport).height,220)
    const home=defaultFloatingVideo({width:1280,height:720})
    assert.equal(home.width,380);assert.equal(home.y,110)
})

test('layout storage accepts geometry only and rejects corrupt or non-finite state',()=>{
    for(const value of [null,'bad','null','{}','{"x":1,"y":2,"width":0}','{"x":"1","y":2,"width":300}','{"x":1,"y":2,"width":1e999}'])assert.equal(readFloatingVideoGeometry(value),undefined)
    assert.deepEqual(readFloatingVideoGeometry('{"x":20,"y":30,"width":400,"url":"ignored"}'),{x:20,y:30,width:400,height:379})
})
