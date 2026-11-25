import assert from 'node:assert/strict'
Reflect.set(globalThis, 'AudioWorkletNode', class {})
const {autoLayoutRouting, routingLayout} = await import('../src/flowtu/routing-layout')
const {canvasPosition, connectRoute, createRoutingBus, routesOf, savedPosition} = await import('../src/flowtu/routing-graph')
const {ProjectSkeleton, InstrumentFactories, MetaData} = await import('@opendaw/studio-adapters')
const {Project} = await import('@opendaw/studio-core')

const nodes = [
    {id:'t1',kind:'track',width:190,height:75}, {id:'t2',kind:'track',width:256,height:380},
    {id:'a',kind:'bus',width:208,height:220}, {id:'b',kind:'bus',width:208,height:75},
    {id:'sum',kind:'bus',width:208,height:90}, {id:'master',kind:'master',width:190,height:120}
] as const
const edges = [
    {source:'t1',target:'b'}, {source:'t2',target:'a'}, {source:'t1',target:'master'},
    {source:'a',target:'sum'}, {source:'b',target:'sum'}, {source:'sum',target:'master'}
]
const points = routingLayout(nodes, edges)
assert.deepEqual(routingLayout(nodes, edges), points)
for (const {source,target} of edges) {
    assert.ok(points.get(source)!.x + nodes.find(n=>n.id===source)!.width < points.get(target)!.x)
}
assert.equal(Math.sign(points.get('t1')!.y - points.get('t2')!.y),
    Math.sign(points.get('b')!.y - points.get('a')!.y), 'two parallel lanes do not cross')
for (const [i, node] of nodes.entries()) {
    const p = points.get(node.id)!
    for (const other of nodes.slice(i+1)) {
        const q = points.get(other.id)!
        assert.ok(p.x + node.width < q.x || p.y + node.height < q.y ||
            q.x + other.width < p.x || q.y + other.height < p.y, node.id + ' overlaps ' + other.id)
    }
}
// Regression: the old canvas capped the Y position at 24,000px and piled up tall racks.
const mass = Array.from({length:250},(_,i)=>({id:'track'+i,kind:'track' as const,width:208,height:320+i%3*68}))
const big = routingLayout(mass,[])
assert.ok(Math.max(...[...big.values()].map(p=>p.y)) > 24000)
assert.equal(new Set([...big.values()].map(p=>p.y)).size, mass.length)

const env = {
    audioContext: {currentTime:0, sampleRate:48000, createGain:()=>({connect(){},disconnect(){},gain:{value:1}}),
        createStereoPanner:()=>({connect(){},disconnect(){},pan:{value:0}})}
} as never
const project = Project.fromSkeleton(env, ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}))
project.editing.modify(()=>project.api.createInstrument(InstrumentFactories.Vaporisateur,{name:'Source'}))
createRoutingBus(project)
const units = project.rootBoxAdapter.audioUnits.adapters(), bus = units.find(u=>u.label==='Bus 1')!
connectRoute(project, units.find(u=>u.label==='Source')!, bus, 'send')
const original = {x:480,y:127}
project.editing.modify(()=>MetaData.store(bus.box, original, canvasPosition))
const panels = new Map(units.map(unit=>[unit,{offsetWidth:210,offsetHeight:unit.isBus ? 320 : 118}]))
const routes = units.flatMap(routesOf)
assert.equal(autoLayoutRouting(project,panels,routes),true)
assert.ok(units.every(unit=>savedPosition(unit)))
assert.equal(autoLayoutRouting(project,panels,routes),false)
const copy = project.copy()
for (const unit of units) assert.deepEqual(savedPosition(copy.rootBoxAdapter.audioUnits.adapters().find(u=>u.label===unit.label)!), savedPosition(unit))
project.editing.undo()
assert.deepEqual(savedPosition(bus),original)
assert.ok(units.filter(u=>u!==bus).every(u=>!savedPosition(u)), 'one undo restores all positions')
assert.deepEqual(units.flatMap(routesOf),routes)
copy.terminate()
project.terminate()
console.log('ROUTING_LAYOUT_OK')
