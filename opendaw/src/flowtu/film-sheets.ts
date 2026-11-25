import type {VideoSourceInfo} from './video-source'
import {MetaData} from '@opendaw/studio-adapters'
import type {Project} from '@opendaw/studio-core'
import {scoringOrigin,readScoring} from './scoring-model'
import {pictureReportOrigin} from './lite-model'

export type FilmSheet = {id:string; name:string; offset:number; duration:number; height:number; folded:boolean; hasVideo:boolean; source?:VideoSourceInfo}
export type FilmBook = {active:string|null; sheets:FilmSheet[]}
const origin = 'flowtu:film-sheets:v1'
const pages = [scoringOrigin, pictureReportOrigin]

export function readFilmBook(project:Project):FilmBook {
    const data = MetaData.read(project.rootBox,origin) as unknown as FilmBook | null
    return data && Array.isArray(data.sheets) ? data : {active:null,sheets:[]}
}
export function currentFilm(project:Project) {
    const {active,sheets} = readFilmBook(project)
    return sheets.find(sheet=>sheet.id===active)
}
export const watchFilmBook = (project:Project, refresh:()=>void) =>
    MetaData.catchupAndSubscribe(project.rootBox,origin,refresh)

function select(project:Project, book:FilmBook, id:string|null) {
    const box = project.rootBox
    // The project can contain manually authored cues before any picture is attached.
    if (!book.active && (readScoring(project).cues.length || MetaData.read(box,pictureReportOrigin))) {
        const existing={...newFilmSheet('Untitled cue sheet',0,0),hasVideo:false}
        book.active=existing.id
        book.sheets.unshift(existing)
    }
    for (const key of pages) {
        // The open page uses Studio's existing scoring/report origins. Closed pages live in
        // the same native graph so snapshots, undo and project saves include the whole book.
        const value = MetaData.read(box,key)
        if (book.active && value!==null) MetaData.store(box,value,`${key}/${book.active}`)
        const savedKey = `${key}/${id}`
        const previous = id ? MetaData.read(box,savedKey) : null
        if (previous===null && key===pictureReportOrigin && book.sheets.some(sheet=>sheet.id===id && sheet.hasVideo)) {
            // Import owns this slot. A background analysis can fill it without becoming a user edit.
            MetaData.store(box,{sheetId:id,pending:true},key)
        } else if (previous===null) MetaData.clear(box,key)
        else {
            MetaData.store(box,previous,key)
            MetaData.clear(box,savedKey)
        }
    }
    MetaData.store(box,{active:id,sheets:book.sheets},origin)
}
export function selectFilmSheet(project:Project,id:string|null) {
    const book=readFilmBook(project)
    if (book.active===id) return
    if (id && !book.sheets.some(sheet=>sheet.id===id)) throw new Error('This cue sheet is no longer in the project.')
    project.editing.modify(()=>select(project,book,id),true)
}
export function newFilmSheet(name:string,duration:number,offset:number,source?:VideoSourceInfo):FilmSheet {
    return {id:crypto.randomUUID(),name,duration,offset,...(source ? {source} : {}),height:58,folded:false,hasVideo:true}
}
/** Adopt the scoring state in an older project. Loading its media must preserve existing cues. */
export function adoptFilmSheet(project:Project,sheet:FilmSheet) {
    project.editing.modify(()=>MetaData.store(project.rootBox,{active:sheet.id,sheets:[sheet]},origin),false)
}
export function addFilmSheet(project:Project,sheet:FilmSheet) {
    const book=readFilmBook(project)
    book.sheets.push(sheet)
    project.editing.modify(()=>select(project,book,sheet.id),true)
}
export function updateFilmTrack(project:Project,id:string,changes:Partial<Pick<FilmSheet,'height'|'folded'|'offset'>>) {
    const book=readFilmBook(project), sheet=book.sheets.find(s=>s.id===id)
    if (!sheet) return
    Object.assign(sheet,changes)
    project.editing.modify(()=>MetaData.store(project.rootBox,book,origin),true)
}

/** Retain original file facts for older saved cue sheets without adding an edit history step. */
export function rememberFilmSource(project:Project,id:string,source:VideoSourceInfo) {
    const book=readFilmBook(project), sheet=book.sheets.find(item=>item.id===id)
    if (!sheet || sheet.source) return
    sheet.source=source
    project.editing.modify(()=>MetaData.store(project.rootBox,book,origin),false)
}

/** Remove the movie and its two scoring pages as a single undoable edit. */
export function deleteFilmSheet(project:Project,id:string) {
    const book=readFilmBook(project)
    if (!book.sheets.some(sheet=>sheet.id===id && sheet.hasVideo)) return
    project.editing.modify(()=>{
        for (const key of pages) {
            if (book.active===id) MetaData.clear(project.rootBox,key)
            MetaData.clear(project.rootBox,`${key}/${id}`)
        }
        MetaData.store(project.rootBox,{active:book.active===id ? null : book.active,sheets:book.sheets.filter(sheet=>sheet.id!==id)},origin)
    },true)
}
