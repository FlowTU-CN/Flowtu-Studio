import {AudioRegionBoxAdapter, AudioUnitBoxAdapter} from '@opendaw/studio-adapters'
import type {Project} from '@opendaw/studio-core'
import {mod, UUID} from '@opendaw/lib-std'
import {cutWithCrossfade, syncCrossfades} from './crossfades'
import {changeAudioEditorRegion} from './editor-audio-actions'
import {deleteScoringRegion, focusScoringTake, takeRegion} from './scoring-model'

export type LiteClipAction = 'split' | 'trim-start' | 'trim-end' | 'delete' | 'duplicate'

/** A single native edit. Adjacent clips are untouched and a split take retains all of its pieces. */
export function editLiteClip(project: Project, id: string, action: LiteClipAction, position: number): string | undefined {
    const region = takeRegion(project,id), track = region?.trackBoxAdapter.unwrapOrNull()
    if (!region || !track) throw new Error('This region is no longer on the timeline.')
    if (project.audioUnitFreeze.isFrozen(project.boxAdapters.adapterFor(track.audioUnit,AudioUnitBoxAdapter))) throw new Error('Unfreeze this track first.')
    const start = region.position, end = region.complete, pulse = Math.round(position)
    if (action !== 'duplicate' && action !== 'delete' && (!Number.isFinite(pulse) || pulse <= start || pulse >= end))
        throw new Error('Place the playhead inside the selected clip.')
    return project.editing.modify(() => {
        if (action === 'split') {
            const right = cutWithCrossfade(project,region,pulse,true).unwrap('Unable to split this clip.')
            return UUID.toString(right.uuid)
        }
        if (action === 'delete') {
            deleteScoringRegion(project,region)
            if (region instanceof AudioRegionBoxAdapter) syncCrossfades(project)
            return undefined
        }
        if (action === 'duplicate') {
            const copy = project.api.duplicateRegion(region,{findFreeSpace:true}).unwrap('Unable to duplicate this clip.')
            copy.box.mute.setValue(region.mute)
            if (region instanceof AudioRegionBoxAdapter && copy instanceof AudioRegionBoxAdapter) {
                copy.box.fading.inEqualPower.setValue(region.box.fading.inEqualPower.getValue())
                copy.box.fading.outEqualPower.setValue(region.box.fading.outEqualPower.getValue())
            }
            return UUID.toString(copy.uuid)
        }
        if (region instanceof AudioRegionBoxAdapter) {
            changeAudioEditorRegion(project,region,action,pulse); syncCrossfades(project)
        } else if (action === 'trim-start') {
            const offset = mod(region.loopOffset + pulse - start,region.loopDuration)
            region.position = pulse; region.duration = end-pulse; region.loopOffset = offset
        } else region.duration = pulse-start
        return id
    },true).unwrapOrNull() ?? undefined
}

/** Region focus writes native editor/selection fields. Seal them with the cut instead of leaving a second undo step. */
export function applyLiteToolbarEdit(project: Project, id: string, action: LiteClipAction, pulse: number): string | undefined {
    return project.editing.modify(() => {
        const next = editLiteClip(project,id,action,pulse)
        if (next) focusScoringTake(project,next)
        else project.regionSelection.deselectAll()
        return next
    },true).unwrapOrNull() ?? undefined
}

/** Preserve take membership when a cut touches either a MIDI or audio take. */
export function editLiteRange(project: Project, selection: import('./timeline-selection').AudioRangeSelection, action:'delete'|'split') {
    const clips = selection.track.regions.collection.asArray().filter(r => r.position < selection.end && Math.round(r.complete) > selection.start)
    if (!clips.length) throw new Error('The selected range contains no clips.')
    const parts: string[] = []
    project.editing.modify(() => {
        for (const r of clips) {
            let id: string = UUID.toString(r.uuid)
            if (!takeRegion(project,id)) continue
            if(selection.end < Math.round(r.complete)) editLiteClip(project,id,'split',selection.end)
            if(selection.start > r.position) id=editLiteClip(project,id,'split',selection.start)!
            if(action==='delete') editLiteClip(project,id,'delete',0)
            else parts.push(id)
        }
        project.regionSelection.deselectAll()
        for(const id of parts) project.regionSelection.select(takeRegion(project,id)!)
        if (parts.length===1) project.timelineFocus.focusRegion(takeRegion(project,parts[0])!)
    },true)
    return parts.length===1 ? parts[0] : undefined
}
