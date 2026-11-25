import {
    clamp,
    DefaultObservableValue,
    int,
    Notifier,
    Observable,
    Observer,
    Option,
    quantizeCeil,
    quantizeFloor,
    quantizeRound,
    Subscription,
    Terminable
} from "@opendaw/lib-std"
import {ppqn, PPQN} from "@opendaw/lib-dsp"
import {MenuItem, MenuRootData, TimelineRange} from "@opendaw/studio-core"
import {SignatureTrackAdapter} from "@opendaw/studio-adapters"
import {getFrameRate, type FrameRate, type TimeRounding} from "../../flowtu/time-format"
import {snapTimePosition, timeGridIndex, timeGridPosition, type TimeMap} from "../../flowtu/time-snap"

export type SnapTarget = "both" | "edges" | "grid"

export interface SnapUnit {
    get name(): string
    ppqn(position: ppqn): int
    readonly timeGrid?: "milliseconds" | "frame"
}

const SMART_MIN_PIXEL = 16 as const

export class Snapping implements Observable<Snapping> {
    static readonly createMenuRoot = (snapping: Snapping): MenuItem<MenuRootData> => MenuItem.root()
        .setRuntimeChildrenProcedure(parent => parent.addMenuItem(...snapping.units
            .map((unit: SnapUnit, index: int) => MenuItem.default({label: unit.name, checked: unit === snapping.unit})
                .setTriggerProcedure(() => snapping.index = index))))

    readonly #range: TimelineRange
    readonly #units: ReadonlyArray<SnapUnit>
    readonly #notifier: Notifier<Snapping>

    #optSignatureTrack: Option<SignatureTrackAdapter> = Option.None
    #timeMap: TimeMap | undefined
    #frameRate: FrameRate = getFrameRate("25")

    readonly guide = new DefaultObservableValue<ppqn | null>(null)
    #target: SnapTarget = "both"
    #enabled: boolean = true
    #index: int = 0 | 0
    #timeGridStepping: boolean = false

    constructor(range: TimelineRange) {
        this.#range = range
        this.#units = this.#initUnits()
        this.#notifier = new Notifier<Snapping>()
    }

    get unit(): SnapUnit {return this.#units[this.#index]}
    get target(): SnapTarget {return this.#target}
    set target(value: SnapTarget) {
        if (this.#target !== value) {this.#target = value; this.guide.setValue(null); this.#notifier.notify(this)}
    }
    get gridEnabled(): boolean {return this.enabled && this.target !== "edges" && this.unit.name !== "Off"}
    get range(): TimelineRange {return this.#range}
    get enabled(): boolean {return this.#enabled}
    set enabled(value: boolean) {if(this.#enabled !== value){this.#enabled = value;this.guide.setValue(null);this.#notifier.notify(this)}}
    get index(): int {return this.#index}
    set index(value: int) {
        if (this.#index === value) {return}
        this.#index = value
        if (this.unit.name !== "Off") {this.#timeGridStepping = this.unit.timeGrid !== undefined}
        this.#notifier.notify(this)
    }
    get units(): ReadonlyArray<SnapUnit> {return this.#units}

    setFrameRate(rate: FrameRate): void {
        this.#frameRate = rate
        this.#notifier.notify(this)
    }

    registerTempoMap(map: TimeMap): Subscription {
        this.#timeMap = map
        this.#notifier.notify(this)
        return Terminable.create(() => {
            if (this.#timeMap === map) {this.#timeMap = undefined}
        })
    }

    // Preserve musical ordering, and step frame -> 10 ms -> Off for the absolute time grid.
    stepFiner(): void {
        if (this.#timeGridStepping) {
            this.index = this.#units.findIndex(unit => unit.name === (this.unit.timeGrid === "frame" ? "10 ms" : "Off"))
        } else {this.index = Math.min(this.#units.findIndex(unit => unit.name === "Off"), this.#index + 1)}
    }
    stepCoarser(): void {
        if (this.#timeGridStepping) {
            this.index = this.#units.findIndex(unit => unit.name === (this.unit.name === "Off" ? "10 ms" : "1 frame"))
        } else {this.index = Math.max(0, this.#index - 1)}
    }

    value(position: ppqn): ppqn {return this.gridEnabled ? this.#units[this.#index].ppqn(position) : 1}

    registerSignatureTrackAdapter(adapter: SignatureTrackAdapter): Subscription {
        this.#optSignatureTrack = Option.wrap(adapter)
        return Terminable.create(() => this.#optSignatureTrack = Option.None)
    }

    xToUnitFloor(x: number): ppqn {return this.floor(this.#range.xToUnit(x))}
    xToUnitCeil(x: number): ppqn {return this.ceil(this.#range.xToUnit(x))}
    xToUnitRound(x: number): ppqn {return this.round(this.#range.xToUnit(x))}

    xToBarInterval(x: number): { position: ppqn, complete: ppqn } {
        const pulse = this.#range.xToUnit(x)
        if (this.#optSignatureTrack.nonEmpty()) {
            return this.#optSignatureTrack.unwrap().getBarInterval(pulse)
        }
        const position = this.floor(pulse)
        return {position, complete: position + this.value(position)}
    }

    floor(position: ppqn): ppqn {
        if (this.#usesTimeGrid()) {return this.#snapTime(position, "floor")}
        if (this.#optSignatureTrack.nonEmpty()) {
            const adapter = this.#optSignatureTrack.unwrap()
            if (this.value(position) === adapter.barLengthAt(position)) {
                return adapter.floorToBar(position)
            }
        }
        return quantizeFloor(position, this.value(position))
    }

    round(position: ppqn): ppqn {
        if (this.#usesTimeGrid()) {return this.#snapTime(position, "round")}
        if (this.#optSignatureTrack.nonEmpty()) {
            const adapter = this.#optSignatureTrack.unwrap()
            if (this.value(position) === adapter.barLengthAt(position)) {
                return adapter.roundToBar(position)
            }
        }
        return quantizeRound(position, this.value(position))
    }

    ceil(position: ppqn): ppqn {
        if (this.#usesTimeGrid()) {return this.#snapTime(position, "ceil")}
        if (this.#optSignatureTrack.nonEmpty()) {
            const adapter = this.#optSignatureTrack.unwrap()
            if (this.value(position) === adapter.barLengthAt(position)) {
                return adapter.ceilToBar(position)
            }
        }
        return quantizeCeil(position, this.value(position))
    }

    computeDelta(beingPointerPulse: ppqn, newPointerX: number, beginValuePulse: ppqn): ppqn {
        const pointerTicks = this.#range.xToUnit(newPointerX) - (beingPointerPulse - beginValuePulse)
        // Musical relative snapping preserves off-grid offsets; time/frame grids are absolute.
        if (this.#usesTimeGrid()) {return this.round(pointerTicks) - beginValuePulse}
        const localDelta = this.round(pointerTicks - beginValuePulse)
        const globalDelta = this.round(pointerTicks) - beginValuePulse
        const localDistance = Math.abs((beginValuePulse + localDelta) - pointerTicks)
        const globalDistance = Math.abs((beginValuePulse + globalDelta) - pointerTicks)
        return localDistance < globalDistance ? localDelta : globalDelta
    }

    next(position: ppqn): ppqn {
        if (this.#usesTimeGrid()) {
            const interval = this.#timeInterval()
            return timeGridPosition(this.#timeMap!, timeGridIndex(this.#timeMap!, position, interval, "floor") + 1, interval)
        }
        return this.floor(position) + this.value(position)
    }

    previous(position: ppqn): ppqn {
        if (this.#usesTimeGrid()) {
            const interval = this.#timeInterval()
            return timeGridPosition(this.#timeMap!, timeGridIndex(this.#timeMap!, position, interval, "ceil") - 1, interval)
        }
        return this.ceil(position) - this.value(position)
    }

    #usesTimeGrid(): boolean {return this.gridEnabled && this.#timeMap !== undefined && this.unit.timeGrid !== undefined}
    #timeInterval(): number {return this.unit.timeGrid === "frame" ? this.#frameRate.denominator / this.#frameRate.numerator : 0.01}
    #snapTime(position: ppqn, rounding: TimeRounding): ppqn {
        return snapTimePosition(this.#timeMap!, position, this.#timeInterval(), rounding)
    }
    #timeUnitPulses(position: ppqn, seconds: number): int {
        if (!this.#timeMap) {return 1}
        const start = this.#timeMap.ppqnToSeconds(position)
        return Math.max(1, Math.round(this.#timeMap.secondsToPPQN(start + seconds) - position))
    }

    subscribe(observer: Observer<Snapping>): Subscription {return this.#notifier.subscribe(observer)}

    catchupAndSubscribe(observer: Observer<Snapping>): Subscription {
        observer(this)
        return this.#notifier.subscribe(observer)
    }

    terminate(): void {this.guide.terminate(); this.#notifier.terminate()}

    #initUnits() {
        const range: TimelineRange = this.#range
        const scope = this
        return [
            {
                name: "Smart",
                ppqn: (position: ppqn): int => {
                    const [nominator, denominator] = scope.#signatureAt(position)
                    const barPulses = PPQN.fromSignature(nominator, denominator)
                    const beatPulses = PPQN.fromSignature(1, denominator)
                    const minUnits = SMART_MIN_PIXEL * range.unitsPerPixel
                    // Start from the finest resolution
                    let interval = PPQN.fromSignature(1, 128)
                    // Scale up using the same logic as TimeGrid
                    while (interval < minUnits) {
                        if (interval < beatPulses) {
                            // Below beat level: multiply by 2
                            const nextInterval = interval * 2
                            if (nextInterval > beatPulses) {
                                interval = beatPulses
                            } else {
                                interval = nextInterval
                            }
                        } else if (interval < barPulses) {
                            // Between beat and bar level: multiply by nominator
                            const nextInterval = interval * nominator
                            if (nextInterval > barPulses) {
                                interval = barPulses
                            } else {
                                interval = nextInterval
                            }
                        } else {
                            // At or above bar level: don't go beyond a single bar for snapping
                            break
                        }
                    }

                    const clampSmartSnapping = true
                    const min = clampSmartSnapping
                        ? PPQN.fromSignature(1, 16)
                        : PPQN.fromSignature(1, 128)
                    // Clamp between min and bar level
                    return clamp(Math.floor(interval), min, barPulses)
                }
            },
            {
                name: "Bar",
                ppqn: (position: ppqn): int => {
                    const [nominator, denominator] = scope.#signatureAt(position)
                    return PPQN.fromSignature(nominator, denominator)
                }
            },
            {name: "1/2", ppqn: (_position: ppqn): int => PPQN.fromSignature(1, 2)},
            {name: "1/4", ppqn: (_position: ppqn): int => PPQN.fromSignature(1, 4)},
            {name: "1/8", ppqn: (_position: ppqn): int => PPQN.fromSignature(1, 8)},
            {name: "1/8T", ppqn: (_position: ppqn): int => PPQN.fromSignature(1, 4) / 3},
            {name: "1/16", ppqn: (_position: ppqn): int => PPQN.fromSignature(1, 16)},
            {name: "1/16T", ppqn: (_position: ppqn): int => PPQN.fromSignature(1, 8) / 3},
            {name: "1/32", ppqn: (_position: ppqn): int => PPQN.fromSignature(1, 32)},
            {name: "1/32T", ppqn: (_position: ppqn): int => PPQN.fromSignature(1, 16) / 3},
            {name: "1/64", ppqn: (_position: ppqn): int => PPQN.fromSignature(1, 64)},
            {name: "1/128", ppqn: (_position: ppqn): int => PPQN.fromSignature(1, 128)},
            {name: "Off", ppqn: (_position: ppqn): int => 1},
            {name: "10 ms", timeGrid: "milliseconds" as const, ppqn: (position: ppqn): int => scope.#timeUnitPulses(position, 0.01)},
            {name: "1 frame", timeGrid: "frame" as const, ppqn: (position: ppqn): int => scope.#timeUnitPulses(position, scope.#frameRate.denominator / scope.#frameRate.numerator)}
        ]
    }

    #signatureAt(position: ppqn): Readonly<[int, int]> {
        return this.#optSignatureTrack.mapOr(adapter => adapter.signatureAt(position), [4, 4])
    }
}
