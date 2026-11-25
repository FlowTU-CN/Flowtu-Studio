import {clipDragSnap} from "@/ui/timeline/AudioClipSnap"
import {syncCrossfades} from "@/flowtu/crossfades"
import {RegionModifier} from "@/ui/timeline/tracks/audio-unit/regions/RegionModifier.ts"
import {int, Option} from "@opendaw/lib-std"
import {ppqn, RegionCollection} from "@opendaw/lib-dsp"
import {
    AnyLoopableRegionBoxAdapter,
    AnyRegionBoxAdapter,
    TrackBoxAdapter,
    UnionAdapterTypes
} from "@opendaw/studio-adapters"
import {RegionModifierSelection} from "@/ui/timeline/tracks/audio-unit/regions/RegionModifierSelection.ts"
import {Snapping} from "@/ui/timeline/Snapping.ts"
import {Project, RegionModifyStrategy} from "@opendaw/studio-core"
import {Dragging} from "@opendaw/lib-dom"

class SelectedModifyStrategy implements RegionModifyStrategy {
    readonly #tool: RegionDurationModifier

    constructor(tool: RegionDurationModifier) {this.#tool = tool}

    readPosition(region: AnyRegionBoxAdapter): ppqn {return region.position}
    readDuration(region: AnyRegionBoxAdapter): ppqn {return this.readComplete(region) - this.readPosition(region)}
    readComplete(region: AnyRegionBoxAdapter): ppqn {
        if (!region.canResize) {return region.complete}
        const duration = this.#tool.aligned
            ? (this.#tool.bounds[1] + this.#tool.deltaDuration) - region.position
            : region.duration + this.#tool.deltaDuration
        const minimum = Math.min(region.duration, region.isAudioRegion() ? 1 : this.#tool.snapping.value(region.position))
        const complete = region.position + Math.max(minimum, duration)
        return region.trackBoxAdapter.map(trackAdapter => trackAdapter.regions.collection
            .greaterEqual(region.complete, region => region.isSelected)).match({
            none: () => complete,
            some: region => complete > region.position ? region.position : complete
        })
    }
    readLoopOffset(region: AnyLoopableRegionBoxAdapter): ppqn {return region.loopOffset}
    readLoopDuration(region: AnyLoopableRegionBoxAdapter): ppqn {return region.resolveLoopDuration(this.readPosition(region))}
    readMirror(region: AnyRegionBoxAdapter): boolean {return region.isMirrowed}
    translateTrackIndex(value: int): int {return value}
    iterateRange<R extends AnyRegionBoxAdapter>(regions: RegionCollection<R>, from: ppqn, to: ppqn): Iterable<R> {
        return regions.iterateRange(
            this.#tool.adapters.reduce((from, adapter) => Math.min(from, adapter.position), from), to)
    }
}

type Construct = Readonly<{
    project: Project
    element: Element
    snapping: Snapping
    pointerPulse: ppqn
    reference: AnyRegionBoxAdapter
}>

export class RegionDurationModifier implements RegionModifier {
    static create(selected: ReadonlyArray<AnyRegionBoxAdapter>, construct: Construct): Option<RegionDurationModifier> {
        const adapters = selected.filter(region => UnionAdapterTypes.isLoopableRegion(region))
        return adapters.length === 0 ? Option.None : Option.wrap(new RegionDurationModifier(construct, adapters))
    }

    readonly #project: Project
    readonly #element: Element
    readonly #snapping: Snapping
    readonly #snapDelta: ReturnType<typeof clipDragSnap>
    readonly #bounds: [ppqn, ppqn]
    readonly #adapters: ReadonlyArray<AnyLoopableRegionBoxAdapter>
    readonly #selectedModifyStrategy: SelectedModifyStrategy

    #aligned: boolean
    #deltaDuration: int

    private constructor({project, element, snapping, pointerPulse, reference}: Construct,
                        adapter: ReadonlyArray<AnyLoopableRegionBoxAdapter>) {
        this.#project = project
        this.#element = element
        this.#snapping = snapping
        this.#snapDelta = clipDragSnap(project, snapping, adapter, reference, "end", pointerPulse)
        this.#bounds = [reference.position, reference.complete]
        this.#adapters = adapter
        this.#selectedModifyStrategy = new SelectedModifyStrategy(this)

        this.#aligned = false
        this.#deltaDuration = 0
    }

    get snapping(): Snapping {return this.#snapping}
    get adapters(): ReadonlyArray<AnyLoopableRegionBoxAdapter> {return this.#adapters}
    get aligned(): boolean {return this.#aligned}
    get deltaDuration(): int {return this.#deltaDuration}
    get bounds(): [ppqn, ppqn] {return this.#bounds}

    showOrigin(): boolean {return false}
    selectedModifyStrategy(): RegionModifyStrategy {return this.#selectedModifyStrategy}
    unselectedModifyStrategy(): RegionModifyStrategy {return RegionModifyStrategy.Identity}

    update({clientX, ctrlKey: aligned, shiftKey}: Dragging.Event): void {
        const deltaDuration = this.#snapDelta(clientX - this.#element.getBoundingClientRect().left, shiftKey)
        let change = false
        if (this.#aligned !== aligned) {
            this.#aligned = aligned
            change = true
        }
        if (this.#deltaDuration !== deltaDuration) {
            this.#deltaDuration = deltaDuration
            change = true
        }
        if (change) {this.#dispatchChange()}
    }

    approve(): void {
        // Delete or Undo mid-drag orphans what this drag captured. Applying to the survivors would commit
        // a partial edit nobody asked for, so the drag is abandoned instead.
        if (!RegionModifierSelection.isIntact(this.#adapters)) {return this.cancel()}
        const adapters = this.#adapters
        const modifiedTracks: ReadonlyArray<TrackBoxAdapter> = RegionModifierSelection.tracksOf(adapters)
        const result = this.#adapters.map<{ region: AnyLoopableRegionBoxAdapter, duration: ppqn }>(region =>
            ({region, duration: this.#selectedModifyStrategy.readDuration(region)}))
        this.#project.overlapResolver.apply(modifiedTracks, adapters, this, 0, (_trackResolver) => {
            result.forEach(({region, duration}) => region.duration = duration)
            syncCrossfades(this.#project)
        })
    }

    cancel(): void {
        this.#aligned = false
        this.#deltaDuration = 0
        this.#dispatchChange()
    }

    toString(): string {
        return `RegionDurationModifier{aligned: ${this.#aligned}, deltaDuration: ${this.#deltaDuration}}`
    }

    #dispatchChange(): void {
        this.#adapters.forEach(adapter => adapter.trackBoxAdapter
            .ifSome(trackAdapter => trackAdapter.regions.dispatchChange()))
    }
}
