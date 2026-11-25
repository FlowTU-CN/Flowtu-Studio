import {DragAndDrop} from '@/ui/DragAndDrop'
import type {Project} from '@opendaw/studio-core'
import {takeRegion} from './scoring-model'

export function installAssetDrag(row: HTMLElement, project: Project, id: string, parts?: readonly string[]) {
    return DragAndDrop.installSource(row, () => takeRegion(project,id) ? {type:'project-asset',project,id,parts,copy:true} : null)
}
