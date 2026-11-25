import {deleteScoringRegion} from "@/flowtu/scoring-model"
import {mediaKind} from "@/flowtu/media-import"
import {inScoringWorkspace} from "@/flowtu/studio-mode"
import {fadeCurveDrag} from "@/flowtu/FadeHandles"
import {RegionLabel} from "@/ui/timeline/RegionLabel"
import {installCrossfadeZones} from "@/flowtu/CrossfadeZones"
import {cutWithCrossfade, syncCrossfades} from "@/flowtu/crossfades"
import css from "./RegionsArea.sass?inline"
import {TourAnchors} from "@/ui/tour/TourAnchors"
import {firstTrackRect} from "@/ui/timeline/tracks/audio-unit/FirstTrackRect"
import {clamp, DefaultObservableValue, EmptyExec, Lifecycle, Nullable, Option, Unhandled, UUID} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {CutCursor} from "@/ui/timeline/CutCursor.tsx"
import {ppqn} from "@opendaw/lib-dsp"
import {installAutoScroll} from "@/ui/AutoScroll.ts"
import {Config} from "@/ui/timeline/Config.ts"
import {TracksManager} from "@/ui/timeline/tracks/audio-unit/TracksManager.ts"
import {AnyRegionBoxAdapter, AudioUnitBoxAdapter, UnionAdapterTypes} from "@opendaw/studio-adapters"
import {createRegionLocator} from "@/ui/timeline/tracks/audio-unit/regions/RegionSelectionLocator.ts"
import {installRegionContextMenu} from "@/ui/timeline/tracks/audio-unit/regions/RegionContextMenu.ts"
import {RegionCaptureTarget, RegionCapturing} from "@/ui/timeline/tracks/audio-unit/regions/RegionCapturing.ts"
import {StudioService} from "@/service/StudioService.ts"
import {SelectionRectangle} from "@/ui/timeline/SelectionRectangle.tsx"
import {Cursor} from "@/ui/Cursors.ts"
import {CursorEvent, installCursor} from "@/ui/hooks/cursor.ts"
import {RegionStartModifier} from "@/ui/timeline/tracks/audio-unit/regions/RegionStartModifier.ts"
import {RegionDurationModifier} from "@/ui/timeline/tracks/audio-unit/regions/RegionDurationModifier.ts"
import {RegionMoveModifier} from "@/ui/timeline/tracks/audio-unit/regions/RegionMoveModifier.ts"
import {RegionLoopDurationModifier} from "@/ui/timeline/tracks/audio-unit/regions/RegionLoopDurationModifier.ts"
import {RegionContentStartModifier} from "@/ui/timeline/tracks/audio-unit/regions/RegionContentStartModifier.ts"
import {ScrollModel} from "@/ui/components/ScrollModel.ts"
import {RegionDragAndDrop} from "@/ui/timeline/tracks/audio-unit/regions/RegionDragAndDrop.ts"
import {PanelType} from "@/ui/workspace/PanelType.ts"
import {CssUtils, Dragging, Events, Html, Keyboard, ShortcutManager} from "@opendaw/lib-dom"
import {DragAndDrop} from "@/ui/DragAndDrop"
import {AnyDragData} from "@/ui/AnyDragData"
import {Dialogs} from "@/ui/components/dialogs"
import {ClipboardManager, ElementCapturing, RegionsClipboard, TimelineRange} from "@opendaw/studio-core"
import {RegionsShortcuts} from "@/ui/shortcuts/RegionsShortcuts"
import {WheelScaling} from "@/ui/timeline/WheelScaling"
import {moveByWheelPixels} from "@/ui/timeline/editors/WheelScroll"
import {editingTool} from "@/flowtu/editing-state"
import {bindEditingClipboard} from "@/flowtu/editing-clipboard"
import {timelinePosition,seekTimeline} from "@/flowtu/timeline-seek"
import {installEnvelopeEditing,isEnvelopeTrack} from "@/flowtu/EnvelopeTools"
import {loopTimelineSelection} from "@/flowtu/timeline-selection"
import {installRangeSelection} from "@/flowtu/RangeSelection"

const className = Html.adoptStyleSheet(css, "RegionsArea")

const CursorMap = Object.freeze({
    "position": "grab",
    "range": "text",
    "start": Cursor.LoopStart,
    "complete": Cursor.LoopEnd,
    "loop-duration": Cursor.ExpandWidth,
    "content-start": Cursor.ExpandWidth,
    "fade-in": "ew-resize",
    "fade-out": "ew-resize",
    "curve-in": "ns-resize",
    "curve-out": "ns-resize"
}) satisfies Record<string, CssUtils.Cursor | Cursor>

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
    manager: TracksManager
    scrollModel: ScrollModel
    scrollContainer: HTMLElement
    range: TimelineRange
}

export const RegionsArea = ({lifecycle, service, manager, scrollModel, scrollContainer, range}: Construct) => {
    const {project, timeline} = service
    const {snapping} = timeline
    const {
        selection,
        regionSelection,
        editing,
        boxAdapters,
        userEditingManager
    } = project
    const markerPosition = lifecycle.own(new DefaultObservableValue<Nullable<ppqn>>(null))
    const element: HTMLElement = (
        <div className={className} tabIndex={-1} data-scope="regions">
            <CutCursor lifecycle={lifecycle} position={markerPosition} range={range}/>
            <CutCursor lifecycle={lifecycle} position={snapping.guide} range={range} guide/>
        </div>
    )
    TourAnchors.registerRect(lifecycle, element, () => firstTrackRect(element, manager), "regions")
    const capturing: ElementCapturing<RegionCaptureTarget> = RegionCapturing.create(element, manager, range, project.audioUnitFreeze)
    installCrossfadeZones(element, manager, range, lifecycle)
    const isEnvelopeStroke = installEnvelopeEditing(element, service, capturing, range, manager, lifecycle)
    installRangeSelection(element, service, capturing, range, manager, lifecycle)
    const {audioUnitFreeze} = project
    const regionLocator = createRegionLocator(manager, range, regionSelection, audioUnitFreeze)
    const dragAndDrop = new RegionDragAndDrop(service, capturing, timeline.snapping)
    const shortcuts = ShortcutManager.get().createContext(element, "Regions")
    const {engine, boxGraph, overlapResolver, timelineFocus} = project
    const clipboardHandler = RegionsClipboard.createHandler({
        getEnabled: () => !engine.isPlaying.getValue(),
        getPosition: () => timelinePosition(project),
        setPosition: position => seekTimeline(project,position),
        editing,
        selection: regionSelection,
        boxGraph,
        boxAdapters,
        getTracks: () => manager.tracks().flatMap(track => manager.playbackLanes(track.trackBoxAdapter)),
        getFocusedTrack: () => timelineFocus.track,
        overlapResolver
    })

    lifecycle.ownAll(
        bindEditingClipboard(clipboardHandler),
        regionSelection.catchupAndSubscribe({
            onSelected: (selectable: AnyRegionBoxAdapter) => selectable.onSelected(),
            onDeselected: (selectable: AnyRegionBoxAdapter) => selectable.onDeselected()
        }),
        shortcuts,
        ClipboardManager.install(element, clipboardHandler),
        shortcuts.register(RegionsShortcuts["select-all"].shortcut, () => {
            regionSelection.select(...manager.tracks()
                .filter(track => !track.audioUnitBoxAdapter.mapOr(unit => audioUnitFreeze.isFrozen(unit), false))
                .flatMap(({trackBoxAdapter}) => manager.playbackLanes(trackBoxAdapter).flatMap(lane => lane.regions.collection.asArray())))
        }),
        shortcuts.register(RegionsShortcuts["deselect-all"].shortcut, () => regionSelection.deselectAll()),
        shortcuts.register(RegionsShortcuts["delete-selection"].shortcut, () => {
            const selected = regionSelection.selected()
            if (selected.length === 0) {return false}
            editing.modify(() => {selected.forEach(region => deleteScoringRegion(project,region)); syncCrossfades(project)})
            return true
        }),
        shortcuts.register(RegionsShortcuts["loop-selection"].shortcut, () =>
            loopTimelineSelection(project)),
        shortcuts.register(RegionsShortcuts["snapping-finer"].shortcut, () => snapping.stepFiner(), {allowRepeat: true}),
        shortcuts.register(RegionsShortcuts["snapping-coarser"].shortcut, () => snapping.stepCoarser(), {allowRepeat: true}),
        installRegionContextMenu({element, service, capturing, selection: regionSelection, range}),
        Events.subscribe(element, "pointerdown", (event: PointerEvent) => {
            const target = capturing.captureEvent(event)
            timelineFocus.clear()
            if (target === null) {return}
            if (target.type === "region") {
                timelineFocus.focusRegion(target.region)
                const optDeviceChain = target.region.trackBoxAdapter
                    .flatMap(track => track.optAudioUnit)
                    .map(unit => unit.editing)
                const switchDeviceChain = optDeviceChain
                    .mapOr(vertex => !userEditingManager.audioUnit.isEditing(vertex), false)
                // If the ContentEditor panel is open, clicking a region
                // (whether already selected or not) brings it into
                // edit-mode. No-op when that region is already the
                // current edit target.
                const switchRegion = service.panelLayout.getByType(PanelType.ContentEditor).isVisible
                    && !userEditingManager.timeline.isEditing(target.region.box)
                if (switchDeviceChain || switchRegion) {
                    // Sealed into its own history entry: the edit pointers write unmarked, and a leftover
                    // unmarked pending is folded into the NEXT marked modify, so an unsealed switch rides along
                    // with whatever the user edits next and undoing that edit jumps region and device chain back.
                    editing.modify(() => {
                        if (switchDeviceChain) {userEditingManager.audioUnit.edit(optDeviceChain.unwrap("editing"))}
                        if (switchRegion) {userEditingManager.timeline.edit(target.region.box)}
                    })
                }
            } else if (target.type === "track") {
                timelineFocus.focusTrack(target.track.trackBoxAdapter)
            }
        }),
        Events.subscribe(element, "dblclick", event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || editingTool.getValue() !== 'select') {return}
            const target = capturing.captureEvent(event)
            if (target === null) {return}
            if (target?.type === "region") {
                editing.modify(() => {
                    userEditingManager.timeline.edit(target.region.box)
                    service.panelLayout.showIfAvailable(PanelType.ContentEditor)
                })
            } else if (target.type === "track") {
                if (target.track.audioUnitBoxAdapter.mapOr(unit => audioUnitFreeze.isFrozen(unit), false)) {return}
                const {trackBoxAdapter} = target.track
                const x = event.clientX - element.getBoundingClientRect().left
                let {position, complete} = snapping.xToBarInterval(x)
                position = Math.max(position,
                    (trackBoxAdapter.regions.collection
                        .lowerEqual(position)?.complete ?? Number.NEGATIVE_INFINITY))
                complete = Math.min(complete,
                    (trackBoxAdapter.regions.collection
                        .greaterEqual(position + 1)?.position ?? Number.POSITIVE_INFINITY))
                if (complete <= position) {return}
                editing.modify(() => project.api.createTrackRegion(trackBoxAdapter.box, position, complete - position)
                    .ifSome(region => selection.select(region)))
            }
        }),
        Dragging.attach(element, (event: PointerEvent) => {
            const target = capturing.captureEvent(event)
            if (target === null) {
                if (Keyboard.isControlKey(event)) {
                    const trackIndex = manager.globalToIndex(event.clientY)
                    if (trackIndex === manager.numTracks()) {return Option.None}
                    return Option.wrap({
                        update: EmptyExec // TODO Create Region
                    })
                } else {
                    return Option.None
                }
            } else if (target.type === "region" && (editingTool.getValue() === 'erase' || editingTool.getValue() === 'mute')) {
                editing.modify(() => editingTool.getValue() === 'erase' ? deleteScoringRegion(project,target.region) : target.region.box.mute.toggle(), true)
                return Option.wrap({update: EmptyExec})
            } else if (target.type === "region" && (event.altKey || editingTool.getValue() === 'cut')) {
                if (!regionSelection.isSelected(target.region)) {
                    regionSelection.deselectAll()
                    regionSelection.select(target.region)
                }
                const clientRect = element.getBoundingClientRect()
                const pointerPulse = snapping.xToUnitRound(event.clientX - clientRect.left)
                editing.modify(() => regionSelection.selected()
                    .slice()
                    .filter(UnionAdapterTypes.isLoopableRegion)
                    .filter(region => !region.trackBoxAdapter.flatMap(track => track.optAudioUnit)
                        .mapOr(unit => audioUnitFreeze.isFrozen(project.boxAdapters.adapterFor(unit, AudioUnitBoxAdapter)), false))
                    .forEach(region => cutWithCrossfade(project, region, pointerPulse, !event.shiftKey)))
                return Option.wrap({update: EmptyExec}) // prevent selection or tools
            }
            return Option.None
        })
    )
    element.appendChild(
        <SelectionRectangle target={element} commandSelection
                            lifecycle={lifecycle}
                            selection={regionSelection}
                            locator={regionLocator}
                            xAxis={range.valueAxis}
                            yAxis={{
                                axisToValue: y => clamp(y + scrollContainer.scrollTop,
                                    0, scrollContainer.scrollTop + element.scrollHeight),
                                valueToAxis: value => value - scrollContainer.scrollTop
                            }}
        />
    )
    lifecycle.ownAll(
        installAutoScroll(element, (deltaX, deltaY) => {
            if (deltaY !== 0) {scrollModel.moveBy(deltaY)}
            if (deltaX !== 0) {range.moveUnitBy(deltaX * range.unitsPerPixel * Config.AutoScrollHorizontalSpeed)}
        }, {
            measure: () => {
                const {left, right} = element.getBoundingClientRect()
                const {top, bottom} = scrollContainer.getBoundingClientRect()
                return ({xMin: left, xMax: right, yMin: top, yMax: bottom})
            }, padding: Config.AutoScrollPadding, dragPadding: Config.AutoScrollDragPadding
        }),
        DragAndDrop.installTarget(element, {
            drag: (event: DragEvent, data: AnyDragData): boolean => {
                if (data.type === "project-asset") {
                    const position = dragAndDrop.assetDrop(event,data)
                    markerPosition.setValue(position ?? null)
                    return position !== undefined
                }
                if (data.type === "file" && inScoringWorkspace()) {
                    const x=event.clientX - element.getBoundingClientRect().left
                    markerPosition.setValue(Math.max(0,event.shiftKey ? Math.round(range.xToUnit(x)) : snapping.xToUnitRound(x)))
                    return true
                }
                const option = dragAndDrop.canDrop(event, data)
                if (option.isEmpty()) {
                    markerPosition.setValue(null)
                    return false
                }
                const rect = element.getBoundingClientRect()
                const position = snapping.xToUnitFloor(event.clientX - rect.left)
                markerPosition.setValue(Math.max(0, position))
                return true
            },
            drop: (event: DragEvent, data: AnyDragData) => {
                if (data.type === "project-asset") {dragAndDrop.assetDrop(event,data,true); return}
                if (data.type === "file" && inScoringWorkspace() && data.files.every(file => !!mediaKind(file))) {
                    const hit = capturing.captureEvent(event)
                    const track = hit?.type === 'track' ? hit.track.trackBoxAdapter : hit?.region.trackBoxAdapter.unwrapOrNull()
                    const pulse = markerPosition.getValue() ?? 0
                    markerPosition.setValue(null)
                    service.requestMediaPlacement(data.files, track ? UUID.toString(manager.displayTrack(track).uuid) : undefined, pulse)
                    return
                }
                const dialog = Dialogs.processMonolog("Import Sample")
                dragAndDrop.drop(event, data).finally(() => dialog.close())
            },
            enter: (_allowDrop: boolean) => {},
            leave: () => markerPosition.setValue(null)
        }),
        Events.subscribe(element, "wheel", (event: WheelEvent) => {
            if (event.shiftKey) {
                event.preventDefault()
                event.stopPropagation()
                WheelScaling.apply(element, range, event)
            } else if (event.altKey) {
                event.preventDefault()
                event.stopPropagation()
                moveByWheelPixels(range, event)
            } else {
                const deltaX = event.deltaX
                const threshold = 5.0
                const clamped = Math.max(deltaX - threshold, 0.0) + Math.min(deltaX + threshold, 0.0)
                if (Math.abs(clamped) > 0) {
                    event.preventDefault()
                    range.moveBy(clamped * 0.0003)
                }
            }
        }, {passive: false}),
        installCursor(element, capturing, {
            get: (target: Nullable<RegionCaptureTarget>, event: CursorEvent) => {
                const track = target?.type === "track" ? target.track.trackBoxAdapter : target?.region.trackBoxAdapter.unwrapOrUndefined()
                if (editingTool.getValue() === 'select' && track && isEnvelopeTrack(track)) {
                    markerPosition.setValue(null)
                    return isEnvelopeStroke(target,event.clientX,event.clientY) ? "default" : "text"
                }
                const units = snapping.xToUnitRound(event.clientX - element.getBoundingClientRect().left)
                markerPosition.setValue(
                    (event.altKey || editingTool.getValue() === 'cut') && target !== null && target.type === "region"
                    && target.region.position < units && units < target.region.complete
                        ? units
                        : null)
                if (target && !event.altKey && !event.ctrlKey && !event.metaKey && editingTool.getValue() === 'range') return "text"
                if (target?.type === "region" && target.part === "range" && (event.shiftKey || event.ctrlKey || event.metaKey) && !event.altKey) return "grab"
                return target === null || target.type === "track"
                    ? null
                    : editingTool.getValue() === 'erase' ? Cursor.Erase
                    : editingTool.getValue() === 'mute' ? Cursor.Speaker
                    : event.altKey || editingTool.getValue() === 'cut'
                        ? Cursor.Scissors
                        : event.shiftKey && (target.part === "fade-in" || target.part === "fade-out") ? "ns-resize"
                        : CursorMap[target.part]
            },
            leave: () => {isEnvelopeStroke(null,0,0); markerPosition.setValue(null)}
        }),
        Dragging.attach(element, (event: PointerEvent) => {
                const target: Nullable<RegionCaptureTarget> = capturing.captureEvent(event)
                if (target === null || target.type !== "region") {return Option.None}
                const clientRect = element.getBoundingClientRect()
                const pointerPulse = range.xToUnit(event.clientX - clientRect.left)
                const reference = target.region
                switch (target.part) {
                    case "start":
                        return manager.startRegionModifier(RegionStartModifier.create(regionSelection.selected(),
                            {project, element, snapping, pointerPulse, reference}))
                    case "complete":
                        return manager.startRegionModifier(RegionDurationModifier.create(regionSelection.selected(),
                            {project, element, snapping, pointerPulse, reference}))
                    case "range": // Modifier gestures passed through by the waveform range handler.
                    case "position":
                        const pointerIndex = manager.globalToIndex(event.clientY)
                        return manager.startRegionModifier(RegionMoveModifier.create(manager, regionSelection,
                            {element, snapping, pointerPulse, pointerIndex, reference}))
                    case "content-start":
                        return manager.startRegionModifier(RegionContentStartModifier.create(regionSelection.selected(),
                            {project, element, snapping, pointerPulse, reference}))
                    case "loop-duration":
                        return manager.startRegionModifier(RegionLoopDurationModifier.create(regionSelection.selected(),
                            {project, element, snapping, pointerPulse, reference}))
                    case "curve-in":
                    case "curve-out":
                    case "fade-in":
                    case "fade-out": {
                        const audioRegion = target.region
                        const isFadeIn = target.part === "fade-in" || target.part === "curve-in"
                        const {position, duration, complete, fading} = audioRegion
                        if (event.shiftKey || target.part === "curve-in" || target.part === "curve-out") {
                            const row = manager.getByIndex(manager.globalToIndex(event.clientY)).unwrapOrNull()
                            if (!row) {return Option.None}
                            const height = row.size - RegionLabel.labelHeight() - 1
                            return Option.wrap(fadeCurveDrag(project, audioRegion, isFadeIn, event.clientY, height))
                        }
                        const originalFadeIn = fading.in
                        const originalFadeOut = fading.out
                        return Option.wrap({
                            update: (dragEvent: Dragging.Event) => {
                                const pointerPpqn = range.xToUnit(dragEvent.clientX - clientRect.left)
                                editing.modify(() => {
                                    if (isFadeIn) {
                                        const newFadeIn = clamp(pointerPpqn - position, 0, duration)
                                        fading.inField.setValue(newFadeIn)
                                        if (newFadeIn + fading.out > duration) {
                                            fading.outField.setValue(duration - newFadeIn)
                                        }
                                    } else {
                                        const newFadeOut = clamp(complete - pointerPpqn, 0, duration)
                                        fading.outField.setValue(newFadeOut)
                                        if (fading.in + newFadeOut > duration) {
                                            fading.inField.setValue(duration - newFadeOut)
                                        }
                                    }
                                }, false)
                            },
                            approve: () => editing.mark(),
                            cancel: () => editing.modify(() => {
                                fading.inField.setValue(originalFadeIn)
                                fading.outField.setValue(originalFadeOut)
                            })
                        } satisfies Dragging.Process)
                    }
                    default: {
                        return Unhandled(target)
                    }
                }
            }, {permanentUpdates: true}
        )
    )
    return element
}
