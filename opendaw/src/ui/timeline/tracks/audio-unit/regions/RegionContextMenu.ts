import {duplicateRegions} from "@/flowtu/duplicate-regions"
import {deleteScoringRegion} from "@/flowtu/scoring-model"
import {tr} from "@/flowtu/studio-language"
import {EmptyExec, isInstanceOf, isNull, RuntimeNotifier, Selection, Terminable} from "@opendaw/lib-std"
import {getTimelineSelection, loopTimelineSelection} from "@/flowtu/timeline-selection"
import {
    AudioBounce,
    AudioConsolidation,
    AudioContentModifier,
    ContextMenu,
    ElementCapturing,
    MenuItem,
    NoteMidiExport,
    TimelineRange
} from "@opendaw/studio-core"
import {AnyRegionBoxAdapter, AudioRegionBoxAdapter} from "@opendaw/studio-adapters"
import {RegionCaptureTarget} from "@/ui/timeline/tracks/audio-unit/regions/RegionCapturing.ts"
import {Surface} from "@/ui/surface/Surface.tsx"
import {RegionTransformer} from "@/ui/timeline/tracks/audio-unit/regions/RegionTransformer.ts"
import {NameValidator} from "@/ui/validator/name.ts"
import {DebugMenus} from "@/ui/menu/debug"
import {ColorMenu} from "@/ui/timeline/ColorMenu"
import {Browser} from "@opendaw/lib-dom"
import {StudioService} from "@/service/StudioService"
import {Promises} from "@opendaw/lib-runtime"
import {RegionsShortcuts} from "@/ui/shortcuts/RegionsShortcuts"
import {TempoDetection} from "@/service/TempoDetection"
import {AudioMaterialDialog} from "@/ui/analysis/AudioMaterialDialog"
import {Bounces} from "@/service/Bounces"

type Construct = {
    element: Element
    service: StudioService
    capturing: ElementCapturing<RegionCaptureTarget>
    selection: Selection<AnyRegionBoxAdapter>
    range: TimelineRange
}

export const installRegionContextMenu =
    ({element, service, capturing, selection, range}: Construct): Terminable => {
        const {project} = service
        const {editing, selection: vertexSelection} = project
        return ContextMenu.subscribe(element, ({addItems, client}: ContextMenu.Collector) => {
            const target = capturing.captureEvent(client)
            if (target === null || target.type === "track") {return}
            if (!selection.isSelected(target.region)) {
                selection.deselectAll()
                selection.select(target.region)
            }
            const region = target.region
            addItems(
                MenuItem.default({label: tr("Delete"), shortcut: "⌫"})
                    .setTriggerProcedure(() => editing.modify(() => selection.selected().slice()
                        .forEach(adapter => deleteScoringRegion(project,adapter)))),
                MenuItem.default({label: tr("Duplicate")})
                    .setTriggerProcedure(() => duplicateRegions(project,selection.selected().slice())),
                MenuItem.default({
                    label: tr("Mute"),
                    checked: region.mute
                }).setTriggerProcedure(() => editing.modify(() => {
                    const newValue = !region.mute
                    return selection.selected().slice().forEach(adapter => adapter.box.mute.setValue(newValue))
                })),
                ColorMenu.createItem(hue => editing.modify(() =>
                    selection.selected().slice().forEach(adapter => adapter.box.hue.setValue(hue)))),
                MenuItem.default({label: tr("Rename")})
                    .setTriggerProcedure(() => Surface.get(element).requestFloatingTextInput(client, region.label)
                        .then(value => NameValidator.validate(value, {
                            success: name => editing.modify(() => selection.selected()
                                .forEach(adapter => adapter.box.label.setValue(name)))
                        }), EmptyExec)),
                MenuItem.default({
                    label: tr("Loop Selection"),
                    shortcut: RegionsShortcuts["loop-selection"].shortcut.format()
                }).setTriggerProcedure(() => loopTimelineSelection(project)),
                MenuItem.default({label: tr("Zoom Selection")})
                    .setTriggerProcedure(() => {
                        const time = getTimelineSelection(project)
                        if (time) range.zoomRange(time.start, time.end)
                    }),
                MenuItem.default({
                    label: tr("Consolidate"),
                    selectable: selection.selected().some(x => x.isMirrowed),
                    separatorBefore: true
                }).setTriggerProcedure(() => editing.modify(() => selection.selected().slice()
                    .forEach(adapter => adapter.consolidate()))),
                MenuItem.default({label: tr("Flatten"), selectable: region.canFlatten(selection.selected())})
                    .setTriggerProcedure(() => {
                        if (region instanceof AudioRegionBoxAdapter) {
                            const audioRegions = selection.selected()
                                .filter((adapter): adapter is AudioRegionBoxAdapter =>
                                    isInstanceOf(adapter, AudioRegionBoxAdapter))
                            AudioConsolidation.flatten(project, service.sampleService, audioRegions)
                                .then(EmptyExec, console.warn)
                        } else {
                            const {truncateNotesAtRegionEnd} = service.engine.preferences.settings.playback
                            editing.modify(() => region.flatten(selection.selected(), truncateNotesAtRegionEnd)
                                .ifSome(box => project.selection.select(box)))
                        }
                    }),
                MenuItem.default({label: tr("Bounce..."), selectable: AudioBounce.canBounce(selection.selected())})
                    .setTriggerProcedure(() => Bounces.bounceRegions(service, selection.selected().slice())
                        .then(EmptyExec, console.warn)),
                MenuItem.default({label: tr("Convert to Clip")})
                    .setTriggerProcedure(() => region.trackBoxAdapter.ifSome(() => editing.modify(() => {
                        service.timeline.clips.visible.setValue(true)
                        const clip = RegionTransformer.toClip(region)
                        vertexSelection.select(clip)
                        project.userEditingManager.timeline.edit(clip)
                    }))),
                MenuItem.default({
                    label: tr("Export to Midi-File"),
                    hidden: region.type !== "note-region"
                }).setTriggerProcedure(() => {
                    if (region.type === "note-region") {
                        const label = region.label
                        NoteMidiExport.toFile(region.optCollection.unwrap("optCollection"),
                            `${label.length === 0 ? "region" : label}.mid`).then(EmptyExec, EmptyExec)
                    }
                }),
                MenuItem.default({
                    label: tr("Reset Fades"),
                    hidden: region.type !== "audio-region"
                }).setTriggerProcedure(() => {
                    if (isInstanceOf(region, AudioRegionBoxAdapter)) {
                        editing.modify(() => region.fading.reset())
                    }
                }),
                MenuItem.default({
                    label: tr("Play Mode"),
                    hidden: region.type !== "audio-region"
                }).setRuntimeChildrenProcedure(parent => parent.addMenuItem(
                    MenuItem.default({
                        label: tr("Pitch"),
                        checked: region.type === "audio-region" && region.asPlayModePitchStretch.nonEmpty()
                    }).setTriggerProcedure(async () => {
                        const {status, value: modifier, error} =
                            await Promises.tryCatch(AudioContentModifier.toPitchStretch(selection.selected()
                                .filter((region): region is AudioRegionBoxAdapter => region.type === "audio-region")))
                        if (status === "resolved") {
                            editing.modify(modifier)
                        } else {
                            console.warn(error)
                        }
                    }),
                    MenuItem.default({
                        label: tr("Timestretch"),
                        checked: region.type === "audio-region" && region.asPlayModeTimeStretch.nonEmpty()
                    }).setTriggerProcedure(async () => {
                        const {status, value: modifier, error} =
                            await Promises.tryCatch(AudioContentModifier.toTimeStretch(selection.selected()
                                .filter((region): region is AudioRegionBoxAdapter => region.type === "audio-region")))
                        if (status === "resolved") {
                            editing.modify(modifier)
                        } else {
                            console.warn(error)
                        }
                    }),
                    MenuItem.default({
                        label: tr("No Warp"),
                        checked: region.type === "audio-region" && region.isPlayModeNoStretch
                    }).setTriggerProcedure(async () => {
                            const {status, value: modifier, error} =
                                await Promises.tryCatch(AudioContentModifier.toNotStretched(selection.selected()
                                    .filter((region): region is AudioRegionBoxAdapter => region.type === "audio-region")))
                            if (status === "resolved") {
                                editing.modify(modifier)
                            } else {
                                console.warn(error)
                            }
                        }
                    )
                )),
                MenuItem.default({
                    label: tr("Detect BPM (AI)..."),
                    hidden: region.type !== "audio-region" || !Browser.isLocalHost()
                }).setTriggerProcedure(() => {
                    if (region.type === "audio-region") {
                        region.file.data.ifSome(async data => {
                            const bpm = await TempoDetection.runOne(data.frames[0], data.sampleRate, region.label)
                            // null is cancel or failure, both of which runOne has already reported.
                            if (isNull(bpm)) {return}
                            await RuntimeNotifier.info({headline: region.label, message: `${bpm} bpm`})
                        })
                    }
                }),
                MenuItem.default({
                    label: tr("Analyze Material..."),
                    hidden: region.type !== "audio-region" || !Browser.isLocalHost()
                }).setTriggerProcedure(() => {
                    if (region.type === "audio-region") {
                        region.file.data.ifSome(async data => {
                            const label = region.label.length === 0 ? "Audio" : region.label
                            const updater = RuntimeNotifier.progress({headline: "Analyzing material", message: label})
                            const {status, value, error} =
                                await Promises.tryCatch(service.materialAnalyzer.analyze(data))
                            updater.terminate()
                            if (status === "rejected") {
                                console.warn(error)
                                RuntimeNotifier.notify({message: "Could not analyze material.", icon: "Warning"})
                                return
                            }
                            await AudioMaterialDialog.show(label, value, element)
                        })
                    }
                }),
                DebugMenus.debugBox(region.box)
            )
        })
    }

