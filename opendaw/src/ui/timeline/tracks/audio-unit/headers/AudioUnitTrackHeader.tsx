import {deleteHeaderSelection,isHeaderSelected,selectHeader,watchHeaderSelection} from "@/flowtu/track-selection"
import {midiTrackName, setMidiTrackName, watchMidiTrackName} from "@/flowtu/track-name"
import {chooseTrackSound} from "@/flowtu/TrackSoundMenu"
import {chooseTrackSample} from "@/flowtu/track-samples"
import {tr, watchStudioLanguage} from "@/flowtu/studio-language"
import {trackColorPicker} from "@/flowtu/TrackColorPicker"
import {DefaultObservableValue, Errors, Lifecycle, Option, panic, Terminator, UUID} from "@opendaw/lib-std"
import {createElement, Group, replaceChildren} from "@opendaw/lib-jsx"
import {Icon} from "@/ui/components/Icon.tsx"
import {MenuButton} from "@/ui/components/MenuButton.tsx"
import {EffectFactories, MenuItem} from "@opendaw/studio-core"
import {AudioUnitBoxAdapter, TrackBoxAdapter, TrackType} from "@opendaw/studio-adapters"
import {AudioUnitChannelControls} from "@/ui/timeline/tracks/audio-unit/AudioUnitChannelControls.tsx"
import {installTrackHeaderMenu} from "@/ui/timeline/tracks/audio-unit/headers/TrackHeaderMenu.ts"
import {CollapseAutomationButton} from "@/ui/timeline/tracks/audio-unit/headers/CollapseAutomationButton.tsx"
import {TrackIcon} from "@/ui/timeline/tracks/audio-unit/headers/TrackIcon.tsx"
import {TracksManager} from "@/ui/timeline/tracks/audio-unit/TracksManager.ts"
import {TrackHeaderClassName} from "@/ui/timeline/tracks/audio-unit/TrackStyles.ts"
import {Events, Html, Keyboard} from "@opendaw/lib-dom"
import {StudioService} from "@/service/StudioService"
import {Surface} from "@/ui/surface/Surface"
import {Promises} from "@opendaw/lib-runtime"
import {Colors, IconSymbol} from "@opendaw/studio-enums"
import {DragAndDrop} from "@/ui/DragAndDrop"
import {AnyDragData} from "@/ui/AnyDragData"
import {installUnitHeaderDrag} from "./TrackHeaderDrag"
import {createHoverEditSwitch, isDeviceDrag} from "./HoverEditSwitch"

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
    trackManager: TracksManager
    trackBoxAdapter: TrackBoxAdapter
    audioUnitBoxAdapter: AudioUnitBoxAdapter
    unitHead: DefaultObservableValue<boolean>
}

export const AudioUnitTrackHeader = ({lifecycle, service, trackManager, trackBoxAdapter, audioUnitBoxAdapter, unitHead}: Construct) => {
    const nameLabel: HTMLElement = <h5 className="device-name" style={{color: Colors.dark.toString()}}/>
    const controlLabel: HTMLElement = <h5 className="control-label" style={{color: Colors.shadow.toString()}}/>
    const {project} = service
    const isMidi = trackBoxAdapter.type === TrackType.Notes
    let deviceName = "", targetName = ""
    const refreshLabels = () => {
        const customName = isMidi ? midiTrackName(audioUnitBoxAdapter.box) : undefined
        nameLabel.textContent = customName ?? deviceName
        controlLabel.textContent = customName ? deviceName : targetName
    }
    lifecycle.own(trackBoxAdapter.catchupAndSubscribePath(option => {
        [deviceName, targetName] = option.unwrapOrElse(["", ""])
        refreshLabels()
    }))
    if (isMidi) lifecycle.own(watchMidiTrackName(audioUnitBoxAdapter.box, refreshLabels))
    // A value lane never speaks for the unit (content lanes and the synthetic lane sort before it), so it marks
    // the start of the unit's automation section instead: the automation glyph, deduped per value-lane run.
    const iconContainer: HTMLElement = trackBoxAdapter.type === TrackType.Value
        ? <div className="icon-container">
            <Icon symbol={IconSymbol.Automation} className="automation-icon"/>
        </div>
        : <TrackIcon lifecycle={lifecycle} service={service} audioUnitBoxAdapter={audioUnitBoxAdapter}/>
    const labels: HTMLElement = (
        <div className="labels">
            {nameLabel}
            {controlLabel}
        </div>
    )
    const element: HTMLElement = (
        <div className={Html.buildClassList(TrackHeaderClassName, "is-primary")} tabindex={-1} data-flowtu-track-header="">
            {iconContainer}
            {trackColorPicker(lifecycle, project, audioUnitBoxAdapter, iconContainer)}
            <CollapseAutomationButton lifecycle={lifecycle} service={service}
                                      audioUnitBoxAdapter={audioUnitBoxAdapter} head={unitHead}/>
            {labels}
            <Group onInit={element => {
                const channelLifeCycle = lifecycle.own(new Terminator())
                unitHead
                    .catchupAndSubscribe(owner => {
                        channelLifeCycle.terminate()
                        Html.empty(element)
                        if (owner.getValue()) {
                            replaceChildren(element, (
                                <AudioUnitChannelControls lifecycle={channelLifeCycle}
                                                          service={service}
                                                          adapter={audioUnitBoxAdapter} track={trackBoxAdapter}/>
                            ))
                        } else {
                            replaceChildren(element, <div/>)
                        }
                    })
            }}/>
            <MenuButton root={MenuItem.root()
                .setRuntimeChildrenProcedure(installTrackHeaderMenu(service, audioUnitBoxAdapter,
                    Option.wrap(trackBoxAdapter), () => {
                        const bounds = nameLabel.getBoundingClientRect()
                        void rename({clientX: bounds.left, clientY: bounds.bottom})
                    }))}
                        style={{minWidth: "0", justifySelf: "end"}}
                        appearance={{color: Colors.shadow, activeColor: Colors.cream}}>
                <Icon symbol={IconSymbol.Menu} style={{fontSize: "0.75em"}}/>
            </MenuButton>
        </div>
    )
    const soundTrack = trackBoxAdapter.type === TrackType.Notes || trackBoxAdapter.type === TrackType.Audio
    const rename = async (position: {clientX: number, clientY: number}) => {
        const {status, error, value} = await Promises.tryCatch(Surface.get(nameLabel)
            .requestFloatingTextInput(position, nameLabel.textContent ?? ""))
        if (status === "rejected") {
            if (!Errors.isAbort(error)) return panic(error)
        } else if (trackBoxAdapter.box.isAttached()) {
            project.editing.modify(() => {
                if (isMidi) setMidiTrackName(audioUnitBoxAdapter.box, value)
                else trackBoxAdapter.targetName = value
            })
        }
    }
    if (soundTrack) {
        const choose = () => {
            if (project.audioUnitFreeze.isFrozen(audioUnitBoxAdapter)) return
            if (trackBoxAdapter.type === TrackType.Notes) chooseTrackSound(service, audioUnitBoxAdapter)
            else void chooseTrackSample(service, trackBoxAdapter)
        }
        nameLabel.setAttribute("role", "button")
        nameLabel.setAttribute("aria-haspopup", "dialog")
        nameLabel.tabIndex = 0
        nameLabel.classList.add("choose-track-sound")
        const updateTitle = () => nameLabel.title = tr(trackBoxAdapter.type === TrackType.Notes ? "Choose instrument sound" : "Choose audio sample")
        updateTitle()
        lifecycle.ownAll(
            {terminate: watchStudioLanguage(updateTitle)},
            Events.subscribe(nameLabel, "click", event => {if(!event.shiftKey && !event.metaKey && !event.ctrlKey) choose()}),
            Events.subscribe(nameLabel, "keydown", event => {
                if (event.code !== "Enter" && event.code !== "Space") return
                event.preventDefault(); event.stopPropagation()
                if (!event.repeat) choose()
            })
        )
    }
    const audioUnitEditing = project.userEditingManager.audioUnit
    const hoverSwitch = createHoverEditSwitch(lifecycle, project, audioUnitBoxAdapter)
    const dragLifecycle = lifecycle.own(new Terminator())
    const groupedLane = () => trackManager.groupMembers(trackBoxAdapter.uuid).length > 1
        ? UUID.toString(trackBoxAdapter.uuid) : undefined
    lifecycle.ownAll(
        unitHead.catchupAndSubscribe(owner => {
            dragLifecycle.terminate()
            labels.draggable = false
            if (owner.getValue()) {
                dragLifecycle.own(installUnitHeaderDrag(element, audioUnitBoxAdapter, groupedLane))
            } else {
                dragLifecycle.own(DragAndDrop.installSource(labels, () => {
                    const uuid = groupedLane()
                    return uuid ? {type: "track", uuid} : null
                }, element))
            }
        }),
        watchHeaderSelection(project,()=>element.classList.toggle("focused",isHeaderSelected(project,trackBoxAdapter))),
        Events.subscribeDblDwn(soundTrack ? controlLabel : nameLabel, rename),
        Events.subscribe(element, "pointerdown", event => {
            const target=event.target
            const control=target instanceof Element && !!target.closest('[data-no-auto-scroll],button,input,select,[role=menuitem]')
            if ((event.button!==0 || control) && isHeaderSelected(project,trackBoxAdapter)) return
            selectHeader(project,trackBoxAdapter,trackManager.tracks().map(t=>t.trackBoxAdapter),event)
            if (!audioUnitEditing.isEditing(audioUnitBoxAdapter.box.editing)) {
                audioUnitEditing.edit(audioUnitBoxAdapter.box.editing)
            }
        }),
        Events.subscribe(element, "keydown", (event) => {
            if (event.code === "F2") {
                event.preventDefault()
                const bounds = nameLabel.getBoundingClientRect()
                void rename({clientX: bounds.left, clientY: bounds.bottom})
                return
            }
            if (!Keyboard.isDelete(event) || event.target instanceof Element &&
                event.target.closest('input, textarea, select, [contenteditable=true], [role=slider]')) {return}
            event.preventDefault();event.stopPropagation()
            if (!event.repeat) deleteHeaderSelection(project,trackBoxAdapter)
        }),
        DragAndDrop.installTarget(element, {
            drag: (_event: DragEvent, data: AnyDragData): boolean => {
                if (isDeviceDrag(data)) {hoverSwitch.hover()}
                return (data.type === "midi-effect" || data.type === "audio-effect") && data.uuids === null
            },
            drop: (_event: DragEvent, data: AnyDragData) => {
                hoverSwitch.cancel()
                if (data.type === "midi-effect") {
                    if (data.uuids !== null) {return}
                    const factory = EffectFactories.MidiNamed[data.device]
                    if (factory.type !== audioUnitBoxAdapter.input.adapter().unwrapOrNull()?.accepts) {
                        return
                    }
                    const effectField = audioUnitBoxAdapter.box.midiEffects
                    project.editing.modify(() =>
                        factory.create(project, effectField, effectField.pointerHub.incoming().length))
                } else if (data.type === "audio-effect") {
                    if (data.uuids !== null) {return}
                    const factory = EffectFactories.AudioNamed[data.device]
                    const effectField = audioUnitBoxAdapter.box.audioEffects
                    project.editing.modify(() =>
                        factory.create(project, effectField, effectField.pointerHub.incoming().length))
                }
            },
            enter: (allowDrop: boolean) => element.classList.toggle("accept-drop", allowDrop),
            leave: () => {
                element.classList.remove("accept-drop")
                hoverSwitch.cancel()
            }
        })
    )
    return element
}
