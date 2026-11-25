import assert from 'node:assert/strict'
Reflect.set(globalThis, 'AudioWorkletNode', class {})
const {ProjectSkeleton, InstrumentFactories} = await import('@opendaw/studio-adapters')
const {Project, EffectFactories} = await import('@opendaw/studio-core')
const {connectRoute, routesOf, disconnectRoute, createRoutingBus, deleteRoutingBus, unitId} = await import('../src/flowtu/routing-graph')
const env = {
    audioContext: {currentTime:0, sampleRate:48000, createGain:()=>({connect(){},disconnect(){},gain:{value:1}}),
        createStereoPanner:()=>({connect(){},disconnect(){},pan:{value:0}})}
} as never
const project = Project.fromSkeleton(env, ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}))
const units = () => project.rootBoxAdapter.audioUnits.adapters()
const get = (name: string) => units().find(unit => unit.label === name)!
project.editing.modify(() => project.api.createInstrument(InstrumentFactories.Vaporisateur, {name:'Keys'}))
createRoutingBus(project, EffectFactories.Reverb)
const fx = units().find(unit => unit.isBus && !unit.isOutput)!, master = units().find(unit => unit.isOutput)!
const channel = get('Keys'), name = fx.label, id = unitId(fx)
connectRoute(project, channel, fx, 'out')
connectRoute(project, channel, fx, 'send')

disconnectRoute(project, routesOf(channel).find(r => r.port === 'out')!)
assert.deepEqual(routesOf(channel).map(r => r.port), ['send'])
project.editing.undo()
assert.equal(routesOf(channel).length, 2)
deleteRoutingBus(project, channel)
deleteRoutingBus(project, master)
assert.equal(units().length, 3)
deleteRoutingBus(project, fx)
assert.equal(units().length, 2)
assert.equal(channel.box.isAttached(),true)
assert.equal(master.box.isAttached(),true)
assert.deepEqual(routesOf(channel), [])
assert.equal(channel.auxSends.size(), 0)
project.editing.undo()
const restored = get(name)
assert.equal(unitId(restored),id)
assert.equal(restored.audioEffects.unwrap().size(),1)
assert.deepEqual(routesOf(channel).map(r => [r.port,r.target]),[['out',restored],['send',restored]])
project.editing.redo()
assert.deepEqual(routesOf(channel), [])
assert.equal(units().length, 2)
project.terminate()
console.log('ROUTING_DELETE_OK')
