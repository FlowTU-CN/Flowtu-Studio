import {deleteUnitWithMedia} from "./track-delete"
import {AudioBusFactory, type AudioUnitBoxAdapter, MetaData} from '@opendaw/studio-adapters'
import {AudioUnitBox, AuxSendBox} from '@opendaw/studio-boxes'
import {AudioSendRouting, AudioUnitType, Colors, IconSymbol} from '@opendaw/studio-enums'
import {UUID} from '@opendaw/lib-std'
import {type EffectFactory, type Project} from '@opendaw/studio-core'

export type Port = 'out' | 'send'
export type Route = {source: AudioUnitBoxAdapter; target: AudioUnitBoxAdapter; port: Port; sendId?: string}
export const unitId = (unit: AudioUnitBoxAdapter) => UUID.toString(unit.uuid)
export const maxCanvasCoordinate = 1_000_000
export const canvasPosition = 'flowtu:routing-position:v1'

export function routesOf(source: AudioUnitBoxAdapter): Route[] {
    const result: Route[] = []
    source.output.adapter.ifSome(bus => result.push({source, target: bus.audioUnitBoxAdapter(), port: 'out'}))
    for (const send of source.auxSends.adapters()) {
        send.optTargetBus.ifSome(bus => result.push({source, target: bus.audioUnitBoxAdapter(), port: 'send', sendId: UUID.toString(send.uuid)}))
    }
    return result
}

export function connectRoute(project: Project, source: AudioUnitBoxAdapter, target: AudioUnitBoxAdapter, port: Port) {
    const bus = project.rootBoxAdapter.audioBusses.adapters().find(bus => bus.audioUnitBoxAdapter() === target)
    if (!source.box.isAttached() || source.isOutput || !bus) throw new Error('Choose a bus or master input.')
    const seen = new Set<AudioUnitBoxAdapter>()
    const pending = [target]
    while (pending.length > 0) {
        const next = pending.pop()!
        if (next === source) throw new Error('This connection would create a feedback loop.')
        if (seen.has(next)) continue
        seen.add(next)
        for (const route of routesOf(next)) pending.push(route.target)
    }
    if (port === 'send' && target.isOutput) throw new Error('Use Out for the master or send to an FX bus.')
    if (routesOf(source).some(route => route.port === port && route.target === target)) return
    project.editing.modify(() => {
        if (port === 'out') source.box.output.refer(bus.box.input)
        else AuxSendBox.create(project.boxGraph, UUID.generate(), box => {
            box.audioUnit.refer(source.box.auxSends)
            box.targetBus.refer(bus.box.input)
            box.routing.setValue(AudioSendRouting.Post)
            box.sendGain.setValue(-6)
            box.index.setValue(source.auxSends.getMinFreeIndex())
        })
    }, true)
}

export function sendFor(route: Route) {
    return route.source.auxSends.adapters().find(send => send.optTargetBus.unwrapOrNull()?.audioUnitBoxAdapter() === route.target &&
        (!route.sendId || UUID.toString(send.uuid) === route.sendId))
}

export function disconnectRoute(project: Project, route: Route) {
    project.editing.modify(() => {
        if (route.port === 'send') sendFor(route)?.delete()
        else if (route.source.output.adapter.unwrapOrNull()?.audioUnitBoxAdapter() === route.target) route.source.box.output.defer()
    }, true)
}

export function deleteRoutingBus(project: Project, unit: AudioUnitBoxAdapter) {
    if (!unit.box.isAttached() || unit.isOutput || !unit.isBus) return
    deleteUnitWithMedia(project, unit)
}

export function createRoutingBus(project: Project, effect?: EffectFactory) {
    const names = new Set(project.rootBoxAdapter.audioUnits.adapters().map(unit => unit.label))
    const base = effect?.defaultName ?? 'Bus'
    let number = 1
    while (names.has(base + ' ' + number)) number++
    project.editing.modify(() => {
        const bus = AudioBusFactory.create(project.skeleton, base + ' ' + number, effect ? IconSymbol.Effects : IconSymbol.AudioBus,
            effect ? AudioUnitType.Aux : AudioUnitType.Bus, effect ? Colors.blue : Colors.orange)
        if (effect) {
            const unit = bus.output.targetVertex.unwrap().box
            if (!(unit instanceof AudioUnitBox)) throw new Error('The FX bus could not be created.')
            project.api.insertEffect(unit.audioEffects, effect)
        }
    }, true)
}

export function savedPosition(unit: AudioUnitBoxAdapter) {
    const point = MetaData.read(unit.box, canvasPosition)
    if (point && typeof point === 'object' && !Array.isArray(point) && typeof point.x === 'number' && typeof point.y === 'number' &&
        Number.isFinite(point.x) && Number.isFinite(point.y)) return {x: Math.max(0, Math.min(maxCanvasCoordinate, point.x)), y: Math.max(0, Math.min(maxCanvasCoordinate, point.y))}
    return undefined
}
