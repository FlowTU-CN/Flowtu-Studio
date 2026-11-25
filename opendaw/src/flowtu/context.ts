import {MetaData} from '@opendaw/studio-adapters'
import {NoteRegionBox} from '@opendaw/studio-boxes'
import {type Project} from '@opendaw/studio-core'
import {UUID} from '@opendaw/lib-std'
import {type MusicalContext} from './commands'

export const contextOrigin='flowtu:composition-context:v1'
export type CompositionContext=MusicalContext & {version:1; regionId:string; sourceLabel:string}

// Native project metadata participates in undo/redo and .odb/.flowtu.zip saves.
export function readContext(project:Project):CompositionContext|undefined {
    const data=MetaData.read(project.rootBox,contextOrigin)
    if(!data||typeof data!=='object'||Array.isArray(data))return
    const c=data as unknown as CompositionContext
    if(c.version!==1||typeof c.regionId!=='string'||!Number.isInteger(c.tonic)||c.tonic<0||c.tonic>11||typeof c.minor!=='boolean'||!Number.isInteger(c.bars)||c.bars<1||c.bars>32||typeof c.sourceLabel!=='string')return
    if(!Array.isArray(c.harmony)||!c.harmony.length||c.harmony.length>32||!c.harmony.every(ch=>Array.isArray(ch)&&ch.length>=3&&ch.length<=8&&ch.every(p=>Number.isInteger(p)&&p>=0&&p<=127)))return
    try{const region=project.boxGraph.findBox(UUID.parse(c.regionId)).unwrapOrNull();if(!(region instanceof NoteRegionBox)||region.mute.getValue())return}catch{return}
    return c
}
export function contextPosition(project:Project,c:CompositionContext):number {
    return project.boxGraph.findBox<NoteRegionBox>(UUID.parse(c.regionId)).unwrap().position.getValue()
}
