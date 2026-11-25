import {deleteUnitWithMedia} from "@/flowtu/track-delete"
import {headerTargets,deleteHeaderSelection} from "@/flowtu/track-selection"
import {playbackLanes} from "@/flowtu/playback-lanes"
import {chooseTrackSound} from "@/flowtu/TrackSoundMenu"
import {chooseTrackSample} from "@/flowtu/track-samples"
import {tr} from "@/flowtu/studio-language"
import {CaptureAudio, MenuItem, Project} from "@opendaw/studio-core"
import {MonitoringDialog} from "@/ui/monitoring/MonitoringDialog"
import {Browser} from "@opendaw/lib-dom"
import {isInstanceOf, Option, Procedure, UUID} from "@opendaw/lib-std"
import {
    AudioUnitBoxAdapter,
    DeviceAccepts,
    TrackBoxAdapter,
    TrackType,
    TransferAudioUnits
} from "@opendaw/studio-adapters"
import {DebugMenus} from "@/ui/menu/debug"
import {inScoringWorkspace} from "@/flowtu/studio-mode"
import {MidiImport} from "@/ui/timeline/MidiImport.ts"
import {CaptureMidiBox} from "@opendaw/studio-boxes"
import {StudioService} from "@/service/StudioService"
import {MenuCapture} from "@/ui/timeline/tracks/audio-unit/menu/capture"
import {GlobalShortcuts} from "@/ui/shortcuts/GlobalShortcuts"
import {MenuItems} from "@/ui/devices/menu-items"
import {trackFolderMenu} from "@/flowtu/track-folders"
import {trackHeightMenu} from "../TrackHeight"

// The unit's menu. `optTrackBoxAdapter` is empty on the synthetic unit lane (a unit without a notes/audio
// track), where only the track-scoped entries drop out — everything else acts on the unit and stays reachable.
export const installTrackHeaderMenu = (service: StudioService,
                                       audioUnitBoxAdapter: AudioUnitBoxAdapter,
                                       optTrackBoxAdapter: Option<TrackBoxAdapter>,
                                       rename?: () => void): Procedure<MenuItem> => parent => {
    const inputAdapter = audioUnitBoxAdapter.input.adapter()
    if (inputAdapter.isEmpty()) {return parent}
    const accepts: DeviceAccepts = inputAdapter.unwrap("Cannot unwrap input adapter").accepts
    const acceptMidi = audioUnitBoxAdapter.captureBox.mapOr(box => isInstanceOf(box, CaptureMidiBox), false)
    // An input that accepts neither (a Playfield slot) has no track type to offer.
    const optTrackType = accepts === false ? Option.None : Option.wrap(DeviceAccepts.toTrackType(accepts))
    const {project} = service
    const {audioUnitFreeze, captureDevices, editing, userEditingManager, selection} = project
    const isFrozen = audioUnitFreeze.isFrozen(audioUnitBoxAdapter)
    // the open menu outlives graph changes (undo, a live-room update), so every action re-checks its boxes
    const guarded = (procedure: Procedure<MenuItem>): Procedure<MenuItem> => item => {
        if (!audioUnitBoxAdapter.box.isAttached()) {return}
        if (optTrackBoxAdapter.mapOr(track => !track.box.isAttached(), false)) {return}
        procedure(item)
    }
    return parent.addMenuItem(
        ...(rename ? [MenuItem.default({label: tr("Rename…"), shortcut: "F2"}).setTriggerProcedure(guarded(rename))] : []),
        ...optTrackBoxAdapter.mapOr(track => [
            ...([TrackType.Audio, TrackType.Notes].includes(track.type) ? [
                MenuItem.default({label: tr(track.type === TrackType.Notes ? "Choose instrument sound" : "Choose audio sample"), selectable: !isFrozen})
                    .setTriggerProcedure(guarded(() => {
                        if (track.type === TrackType.Notes) chooseTrackSound(service, audioUnitBoxAdapter)
                        else void chooseTrackSample(service, track)
                    }))
            ] : []),
            trackHeightMenu(project, track.box)
        ], []),
        MenuItem.default({
            label: tr("Enabled"),
            checked: optTrackBoxAdapter.mapOr(track => track.enabled.getValue(), false),
            hidden: optTrackBoxAdapter.isEmpty()
        }).setTriggerProcedure(guarded(() => optTrackBoxAdapter.ifSome(track =>
            editing.modify(() => {const enabled=!track.enabled.getValue(); for(const lane of headerTargets(project,track)) lane.enabled.setValue(enabled)})))),
        MenuItem.default({
            label: tr(optTrackType.mapOr(type => `New ${TrackType.toLabelString(type)} Track`, "New Track")),
            hidden: optTrackType.isEmpty()
        }).setTriggerProcedure(guarded(() => optTrackType.ifSome(type => editing.modify(() =>
            type === TrackType.Notes
                ? project.api.createNoteTrack(audioUnitBoxAdapter.box)
                : project.api.createAudioTrack(audioUnitBoxAdapter.box))))),
        ...(audioUnitBoxAdapter.isOutput ? [] : trackFolderMenu(project, UUID.toString(audioUnitBoxAdapter.uuid))),
        MenuCapture.createItem(service, audioUnitBoxAdapter,
            optTrackBoxAdapter, editing, captureDevices.get(audioUnitBoxAdapter.uuid)),
        MenuItem.default({
            label: tr("Monitoring"),
            hidden: captureDevices.get(audioUnitBoxAdapter.uuid)
                .mapOr(capture => !isInstanceOf(capture, CaptureAudio), true)
        }).setTriggerProcedure(guarded(() => {
            const optCapture = captureDevices.get(audioUnitBoxAdapter.uuid)
            if (optCapture.isEmpty()) {return}
            const capture = optCapture.unwrap()
            if (!isInstanceOf(capture, CaptureAudio)) {return}
            capture.armed.setValue(true)
            MonitoringDialog.open(service, capture).finally()
        })),
        MenuItem.default({
            label: tr("Force Mono"),
            checked: captureDevices.get(audioUnitBoxAdapter.uuid)
                .mapOr(capture => isInstanceOf(capture, CaptureAudio)
                    ? capture.requestChannels.mapOr(channels => channels === 1, false)
                    : false, false),
            hidden: captureDevices.get(audioUnitBoxAdapter.uuid)
                .mapOr(capture => !isInstanceOf(capture, CaptureAudio), true)
        }).setTriggerProcedure(guarded(() => captureDevices.get(audioUnitBoxAdapter.uuid)
            .ifSome(capture => {
                if (isInstanceOf(capture, CaptureAudio)) {
                    const currentMono = capture.requestChannels.mapOr(channels => channels === 1, false)
                    editing.modify(() => capture.requestChannels = currentMono ? 2 : 1)
                }
            }))),
        MenuItem.default({
            label: tr("Duplicate AudioUnit"),
            shortcut: GlobalShortcuts["copy-device"].shortcut.format(),
            separatorBefore: true,
            hidden: audioUnitBoxAdapter.isOutput
        }).setTriggerProcedure(guarded(() => {
            const copies = editing.modify(() => TransferAudioUnits
                .transfer([audioUnitBoxAdapter.box], project.skeleton, {
                    insertIndex: audioUnitBoxAdapter.indexField.getValue() + 1
                }), false).unwrap("copyUnit")
            Option.wrap(copies.at(0)).ifSome(copy => userEditingManager.audioUnit.edit(copy.editing))
        })),
        MenuItems.copyAudioUnit(audioUnitBoxAdapter),
        MenuItem.default({
            label: tr("Freeze AudioUnit"),
            hidden: !audioUnitBoxAdapter.isInstrument || isFrozen
        }).setTriggerProcedure(guarded(() => project.audioUnitFreeze.freeze(audioUnitBoxAdapter))),
        MenuItem.default({
            label: tr("Unfreeze AudioUnit"),
            hidden: !audioUnitBoxAdapter.isInstrument || !isFrozen
        }).setTriggerProcedure(guarded(() => project.audioUnitFreeze.unfreeze(audioUnitBoxAdapter))),
        MenuItem.default({
            label: tr("Extract AudioUnit Into New Project"),
            hidden: audioUnitBoxAdapter.isOutput
        }).setTriggerProcedure(guarded(async () => {
            if (!await service.projectProfileService.approveLosingChanges()) {return}
            const newProject = Project.new(service)
            editing.modify(() => {
                const {boxGraph, skeleton} = newProject
                boxGraph.beginTransaction()
                TransferAudioUnits.transfer([audioUnitBoxAdapter.box], skeleton)
                boxGraph.endTransaction()
            })
            service.projectProfileService.setProject(newProject, "NEW")
        })),
        MenuItem.default({
            label: tr("Select Clips"),
            selectable: optTrackBoxAdapter.mapOr(track => headerTargets(project,track).some(lane=>!lane.clips.collection.isEmpty()), false) && !isFrozen,
            hidden: optTrackBoxAdapter.isEmpty()
        }).setTriggerProcedure(guarded(() => optTrackBoxAdapter.ifSome(track => headerTargets(project,track).flatMap(lane=>lane.clips.collection.adapters())
            .forEach(clip => selection.select(clip.box))))),
        MenuItem.default({
            label: tr("Select Regions"),
            selectable: optTrackBoxAdapter.mapOr(track => headerTargets(project,track).some(lane=>playbackLanes(lane).some(t=>!t.regions.collection.isEmpty())), false) && !isFrozen,
            hidden: optTrackBoxAdapter.isEmpty()
        }).setTriggerProcedure(guarded(() => optTrackBoxAdapter.ifSome(track => headerTargets(project,track).flatMap(lane=>playbackLanes(lane).flatMap(t=>t.regions.collection.asArray()))
            .forEach(region => selection.select(region.box))))),
        MenuItem.default({
            label: tr("Compact Tracks"),
            hidden: !Browser.isLocalHost(),
            selectable: !isFrozen,
            separatorBefore: true
        }).setTriggerProcedure(guarded(() => editing.modify(() =>
            project.api.compactTracks(audioUnitBoxAdapter.box)))),
        MenuItem.default({
            label: tr("Import MIDI File..."),
            hidden: !acceptMidi,
            selectable: !isFrozen,
            separatorBefore: true
        }).setTriggerProcedure(guarded(() => {
            if (inScoringWorkspace()) service.requestMediaPlacement(undefined, optTrackBoxAdapter.mapOr(t => UUID.toString(t.uuid), undefined))
            else void MidiImport.toTracks(project, audioUnitBoxAdapter)
        })),
        MenuItem.default({
            label: tr("Delete '{0}'", audioUnitBoxAdapter.input.label.unwrapOrElse(tr("No Input"))),
            selectable: !audioUnitBoxAdapter.isOutput,
            hidden: !isFrozen && optTrackBoxAdapter.nonEmpty() && audioUnitBoxAdapter.tracks.collection.size() === 1,
            separatorBefore: true
        }).setTriggerProcedure(guarded(() => deleteUnitWithMedia(project, audioUnitBoxAdapter))),
        MenuItem.default({
            label: tr(optTrackBoxAdapter.mapOr(track => `Delete ${TrackType.toLabelString(track.type)} Track`, "Delete Track")),
            selectable: !audioUnitBoxAdapter.isOutput && !isFrozen,
            hidden: optTrackBoxAdapter.isEmpty()
        }).setTriggerProcedure(guarded(() => optTrackBoxAdapter.ifSome(track => deleteHeaderSelection(project,track)))),
        DebugMenus.debugBox(audioUnitBoxAdapter.box)
    )
}
