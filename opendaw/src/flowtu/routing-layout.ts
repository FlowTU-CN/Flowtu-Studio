import {MetaData, type AudioUnitBoxAdapter} from '@opendaw/studio-adapters'
import type {Project} from '@opendaw/studio-core'
import {canvasPosition, maxCanvasCoordinate, savedPosition, unitId, type Route} from './routing-graph'

export type LayoutNode = {id: string; kind: 'track' | 'bus' | 'master'; width: number; height: number}
export type LayoutEdge = {source: string; target: string}
type Point = {x: number; y: number}
const margin = 28, rowGap = 34, columnGap = 108

/** Longest-path layering keeps cascaded buses between their sources and the master.
 * Within each column, order nodes by the relative positions of their neighbours. */
export function routingLayout(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): Map<string, Point> {
    const incoming = new Map(nodes.map(n => [n.id, new Set<string>()]))
    const outgoing = new Map(nodes.map(n => [n.id, new Set<string>()]))
    for (const {source, target} of edges) {
        if (!outgoing.has(source) || !incoming.has(target)) continue
        outgoing.get(source)!.add(target)
        incoming.get(target)!.add(source)
    }

    const rank = new Map<string, number>(nodes.map(n => [n.id, n.kind === 'bus' ? 1 : 0]))
    const remaining = new Map(nodes.map(n => [n.id, incoming.get(n.id)!.size]))
    const queue = nodes.filter(n => remaining.get(n.id) === 0).map(n => n.id)
    for (let i = 0; i < queue.length; i++) {
        const source = queue[i]
        for (const target of outgoing.get(source)!) {
            rank.set(target, Math.max(rank.get(target)!, rank.get(source)! + 1))
            const count = remaining.get(target)! - 1
            remaining.set(target, count)
            if (count === 0) queue.push(target)
        }
    }
    // Independent, unpatched buses still belong to the left of the output.
    const lastStage = nodes.reduce((last, n) => n.kind === 'master' ? last : Math.max(last, rank.get(n.id)!), -1)
    const groups = new Map<number, LayoutNode[]>()
    for (const node of nodes) {
        const stage = node.kind === 'master' ? lastStage + 1 : rank.get(node.id)!
        const group = groups.get(stage)
        if (group) group.push(node)
        else groups.set(stage, [node])
    }
    const columns = [...groups.entries()].sort(([a], [b]) => a - b).map(([, column]) => column)
    const fractions = new Map<string, number>()
    const updateOrder = (column: LayoutNode[]) => column.forEach((node, i) => fractions.set(node.id, (i + .5) / column.length))
    columns.forEach(updateOrder)
    const order = (column: LayoutNode[], neighbours: Map<string, Set<string>>) => {
        const scores = new Map(column.map(node => {
            const adjacent = neighbours.get(node.id)!
            if (!adjacent.size) return [node.id, fractions.get(node.id)!]
            let total = 0
            adjacent.forEach(id => total += fractions.get(id)!)
            return [node.id, total / adjacent.size]
        }))
        column.sort((a, b) => scores.get(a.id)! - scores.get(b.id)!)
        updateOrder(column)
    }
    for (let pass = 0; pass < 3; pass++) {
        for (let i = 1; i < columns.length; i++) order(columns[i], incoming)
        for (let i = columns.length - 2; i >= 0; i--) order(columns[i], outgoing)
    }

    const heights = columns.map(column => column.reduce((total, n) => total + n.height + rowGap, -rowGap))
    const maxHeight = heights.reduce((max, h) => Math.max(max, h), 0)
    const points = new Map<string, Point>()
    let x = margin
    columns.forEach((column, i) => {
        let y = margin + (maxHeight - heights[i]) / 2
        let width = 0
        for (const node of column) {
            points.set(node.id, {x, y: Math.round(y)})
            y += node.height + rowGap
            width = Math.max(width, node.width)
        }
        x += width + columnGap
    })

    // Ports sit under each title, including on very tall insert racks. Align their
    // top edges rather than the centres of those racks with their upstream inputs.
    columns.forEach((column, i) => {
        let bottom = margin, stillNeeded = heights[i]
        for (const node of column) {
            const point = points.get(node.id)!
            const sources = incoming.get(node.id)!
            if (sources.size) {
                let sum = 0
                sources.forEach(id => sum += points.get(id)!.y)
                point.y = Math.round(Math.max(bottom, Math.min(margin + maxHeight - stillNeeded, sum / sources.size)))
            } else {
                point.y = Math.max(point.y, bottom)
            }
            bottom = point.y + node.height + rowGap
            stillNeeded -= node.height + rowGap
        }
    })
    return points
}

export function autoLayoutRouting(project: Project, panels: ReadonlyMap<AudioUnitBoxAdapter, Pick<HTMLElement, 'offsetWidth' | 'offsetHeight'>>,
                                  routes: readonly Route[]): boolean {
    const nodes: LayoutNode[] = [...panels].map(([unit, el]) => ({
        id: unitId(unit), kind: unit.isOutput ? 'master' : unit.isBus ? 'bus' : 'track',
        width: Math.max(1, el.offsetWidth), height: Math.max(1, el.offsetHeight)
    }))
    const positions = routingLayout(nodes, routes.map(r => ({source: unitId(r.source), target: unitId(r.target)})))
    const changes = [...panels.keys()].flatMap(unit => {
        const point = positions.get(unitId(unit))!, saved = savedPosition(unit)
        if (point.x > maxCanvasCoordinate || point.y > maxCanvasCoordinate) throw new Error('This layout exceeds the canvas dimensions.')
        return saved?.x === point.x && saved.y === point.y ? [] : [{unit, point}]
    })
    if (!changes.length) return false
    project.editing.modify(() => {
        for (const {unit, point} of changes) MetaData.store(unit.box, point, canvasPosition)
    }, true)
    return true
}
