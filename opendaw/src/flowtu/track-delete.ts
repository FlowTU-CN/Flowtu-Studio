import type {Project} from '@opendaw/studio-core'
import {AudioUnitBoxAdapter, type TrackBoxAdapter, TrackType} from '@opendaw/studio-adapters'
import {isAssetLane, playbackLanes} from './playback-lanes'
import {retainDeletedTrackMedia} from './media-retention'

function removeTracks(project: Project, units: Set<AudioUnitBoxAdapter>, lanes: Set<TrackBoxAdapter>) {
    if (units.size === 0 && lanes.size === 0) return
    project.editing.modify(() => {
        const mediaSources = new Set(lanes)
        for (const unit of units) for (const lane of unit.tracks.values()) mediaSources.add(lane)
        for (const region of project.regionSelection.selected().slice()) {
            if (region.trackBoxAdapter.mapOr(track => mediaSources.has(track), false)) project.regionSelection.deselect(region)
        }
        retainDeletedTrackMedia(project, [...mediaSources])
        for (const unit of units) project.api.deleteAudioUnit(unit.box)
        for (const lane of lanes) {
            if (!lane.box.isAttached()) continue
            const unit = lane.optAudioUnit.unwrapOrUndefined()
            if (unit) project.boxAdapters.adapterFor(unit, AudioUnitBoxAdapter).deleteTrack(lane)
            else lane.target.targetVertex.flatMap(v => project.parameterFieldAdapters.opt(v.address))
                .flatMap(parameter => parameter.optTracks()).ifSome(tracks => tracks.delete(lane))
        }
    }, true)
}

export function deleteUnitWithMedia(project: Project, unit: AudioUnitBoxAdapter) {
    if (!unit.box.isAttached() || unit.isOutput) return
    removeTracks(project, new Set([unit]), new Set())
}

const isContent = (track: TrackBoxAdapter) => track.type === TrackType.Audio || track.type === TrackType.Notes

export function deleteTracksWithMedia(project: Project, targets: readonly TrackBoxAdapter[]) {
    const lanes = new Set<TrackBoxAdapter>()
    const contentUnits = new Set<AudioUnitBoxAdapter>()
    for (const target of targets) {
        if (!target.box.isAttached()) continue
        const unit = target.optAudioUnit.map(box => project.boxAdapters.adapterFor(box, AudioUnitBoxAdapter)).unwrapOrUndefined()
        if (unit && (unit.isOutput || project.audioUnitFreeze.isFrozen(unit))) continue
        for (const lane of playbackLanes(target)) lanes.add(lane)
        if (unit && isContent(target) && !isAssetLane(target)) contentUnits.add(unit)
    }
    // Removing the final visible content lane also removes its channel. Otherwise the
    // timeline would immediately insert a synthetic row bearing the same channel name.
    const units = new Set<AudioUnitBoxAdapter>()
    for (const unit of contentUnits) {
        const tracks = unit.tracks.values()
        if (!tracks.every(track => !isContent(track) || isAssetLane(track) || lanes.has(track))) continue
        units.add(unit)
        for (const track of tracks) lanes.delete(track)
    }
    removeTracks(project, units, lanes)
}
