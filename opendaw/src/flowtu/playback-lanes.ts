import {type AnyRegionBoxAdapter, AudioRegionBoxAdapter, NoteRegionBoxAdapter, AudioUnitBoxAdapter, MetaData, TrackBoxAdapter, TrackType} from "@opendaw/studio-adapters"
import {UUID} from "@opendaw/lib-std"

type AssetRegion = AudioRegionBoxAdapter | NoteRegionBoxAdapter

export function copyAssetTo<T extends AssetRegion>(source: T, target: TrackBoxAdapter, position: number): T {
    const copy = source.copyTo({position, target: target.box.regions, consolidate: true})
    if (source instanceof AudioRegionBoxAdapter && copy instanceof AudioRegionBoxAdapter) {
        // The SDK's fade clone carries length and slope. Copy the equal-power flags as well.
        copy.box.fading.inEqualPower.setValue(source.box.fading.inEqualPower.getValue())
        copy.box.fading.outEqualPower.setValue(source.box.fading.outEqualPower.getValue())
    }
    return copy as T
}

export const assetLaneOrigin = "flowtu:asset-storage"
export const isAssetLane = (track: TrackBoxAdapter) => MetaData.read(track.box, assetLaneOrigin) === true

export const overlapLaneOrigin = "flowtu:overlap-lane"
const audioSiblings = (track: TrackBoxAdapter) => track.context.boxAdapters.adapterFor(track.audioUnit, AudioUnitBoxAdapter)
    .tracks.values().filter(t => t.type === TrackType.Audio && !isAssetLane(t))

export function displayTrack(track: TrackBoxAdapter): TrackBoxAdapter {
    if (track.type !== TrackType.Audio || track.optAudioUnit.isEmpty()) {return track}
    const owner = MetaData.read(track.box, overlapLaneOrigin)
    if (!owner) {return track}
    const siblings = audioSiblings(track)
    // Early projects stored true on the lane immediately below its owner.
    return siblings.find(t => UUID.toString(t.uuid) === owner) ?? siblings.filter(t =>
        t !== track && !MetaData.read(t.box, overlapLaneOrigin)).sort((a, b) =>
        Math.abs(a.indexField.getValue() - track.indexField.getValue()) -
        Math.abs(b.indexField.getValue() - track.indexField.getValue()))[0] ?? track
}
export function playbackLanes(track: TrackBoxAdapter): ReadonlyArray<TrackBoxAdapter> {
    if (track.type !== TrackType.Audio || track.optAudioUnit.isEmpty()) {return [track]}
    const owner = displayTrack(track)
    return [owner, ...audioSiblings(owner).filter(t => t !== owner && displayTrack(t) === owner)]
}

/** Within a shared span, the left half of the title is the outgoing clip's and the right half is the incoming clip's. */
export function clipAtSharedTitle(clips: ReadonlyArray<AnyRegionBoxAdapter>, position: number) {
    const pair = clips.filter(r => r.position <= position && position < r.complete).sort((a, b) =>
        a.position - b.position || a.complete - b.complete)
    if (pair.length !== 2) {return null}
    return position < (pair[0].complete + pair[1].position) / 2 ? pair[0] : pair[1]
}
