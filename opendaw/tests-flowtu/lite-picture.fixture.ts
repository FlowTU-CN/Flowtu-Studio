import assert from 'node:assert/strict'
import type {PictureReport, PictureScene} from '../src/flowtu/lite-model'
Reflect.set(globalThis,'AudioWorkletNode',class {})
const {ProjectSkeleton}=await import('@opendaw/studio-adapters')
const {Project}=await import('@opendaw/studio-core')
const {applyPictureAnalysis}=await import('../src/flowtu/LitePictureAnalysis')
const {buildLitePrompt,readPictureReport}=await import('../src/flowtu/lite-model')
const {readScoring,writeScoring,generateScoringMidi,readScoringTakes}=await import('../src/flowtu/scoring-model')
const env={audioContext:{currentTime:0,sampleRate:48000,createGain:()=>({connect(){},disconnect(){},gain:{value:1}}),
    createStereoPanner:()=>({connect(){},disconnect(){},pan:{value:0}})}} as never
const project=Project.fromSkeleton(env,ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}))
const jpeg='data:image/jpeg;base64,/9j/AAAA'
function shot(title:string,start:number,end:number,startsNewBeat:boolean):PictureScene {
    return {title,start,end,startsNewBeat,boundary:start===0?'opening':'cut',motion:.1,brightness:.3,warmth:0,keyframeTime:(start+end)/2,
        observation:title,thumbnail:jpeg,contextFrames:[{time:start+.1,thumbnail:jpeg}],musicPrompt:'Generate sparse piano chords.'}
}
const report:PictureReport={version:1,file:'film.mp4',size:100,offset:0,model:'Vision fixture',duration:30,scenes:[
    shot('Station',0,9.011,true),shot('Train',9.011,15,true),shot('Another angle',15,21.001,false),shot('Night',21.001,30,true)
]}
const protectedCue={id:'authored',name:'Edited drum entry',start:12,end:14,prompt:'Generate sparse piano chords in D minor.',tone:'keys' as const}
writeScoring(project,{...readScoring(project),cues:[protectedCue]})
generateScoringMidi(project,protectedCue)
const authored=readScoring(project).cues[0]
applyPictureAnalysis(project,report,50)
const cues=readScoring(project).cues
assert.deepEqual(cues.map(({start,end})=>[start,end]),[[0,9.011],[9.011,12],[12,14],[14,21.001],[21.001,30]])
assert.deepEqual(cues.find(c=>c.id==='authored'),authored)
assert.equal(readScoringTakes(project,'authored').length,1)
const prompt=buildLitePrompt(project,{start:9,end:21,prompt:'New direction'})
assert.deepEqual(prompt.picture.map(s=>s.title),['Train','Another angle'])
assert.equal(prompt.previousPicture?.title,'Station')
assert.equal(prompt.nextPicture?.title,'Night')
assert.ok(!JSON.stringify(prompt).includes('data:image'))
assert.ok(!readPictureReport(project)?.scenes.some(s=>s.contextFrames))
assert.equal(report.scenes[0].contextFrames?.length,1)
const saved=Project.load(env,project.toArrayBuffer() as ArrayBuffer)
assert.deepEqual(readPictureReport(saved),readPictureReport(project))
assert.deepEqual(readScoring(saved).cues,cues)
project.editing.undo()
assert.equal(readPictureReport(project),undefined)
assert.deepEqual(readScoring(project).cues,[authored])
project.editing.redo()
assert.deepEqual(readScoring(project).cues,cues)
applyPictureAnalysis(project,report,50)
assert.deepEqual(readScoring(project).cues,cues)
const early=cues[0], late=cues.at(-1)!
const edited={...readScoring(project),cues:cues.map(c=>c.id===late.id?{...c,prompt:'My ending'}:c)}
writeScoring(project,edited)
applyPictureAnalysis(project,{...report,model:'Second model',
    scenes:report.scenes.map(s=>({...s,musicPrompt:'Generate warm bass lines.'}))},50)
const rescored=readScoring(project)
assert.equal(rescored.cues.find(c=>c.id===early.id)?.prompt,'Generate warm bass lines.')
assert.equal(rescored.cues.find(c=>c.id===late.id)?.prompt,'My ending')
assert.deepEqual(rescored.cues.find(c=>c.id==='authored'),authored)
project.editing.undo()
assert.deepEqual(readScoring(project),edited)
console.log('LITE_PICTURE_OK')

// Two cuts can have the same filename and byte length. Their footage, reports and cue edits
// must survive a native project round-trip, and a delayed analysis can only commit to its film.
const {addFilmSheet,adoptFilmSheet,currentFilm,newFilmSheet,selectFilmSheet,deleteFilmSheet,readFilmBook,updateFilmTrack}=await import('../src/flowtu/film-sheets')
const {editFilmCue,mergeFilmCue,moveFilmCue,reorderFilmCue,splitFilmCue}=await import('../src/flowtu/film-cue-edits')
const booklet=Project.load(env,saved.toArrayBuffer() as ArrayBuffer)
const A=newFilmSheet('film.mp4',30,0), B=newFilmSheet('film.mp4',30,1.25)
adoptFilmSheet(booklet,A)
const firstSheet=readScoring(booklet), firstReport=readPictureReport(booklet)
addFilmSheet(booklet,B)
assert.notEqual(A.id,B.id)
assert.equal(currentFilm(booklet)?.id,B.id)
assert.deepEqual(readScoring(booklet).cues,[])
assert.equal(readPictureReport(booklet),undefined)
applyPictureAnalysis(booklet,{...report,sheetId:A.id},50)
assert.equal(readPictureReport(booklet),undefined)
applyPictureAnalysis(booklet,{...report,sheetId:B.id,offset:1.25},50)
const Bcues=readScoring(booklet).cues
assert.equal(Bcues.length,3)
assert.equal(Bcues[0].start,1.25)
assert.ok(Bcues[0].markdown?.includes('Station'))
editFilmCue(booklet,Bcues[0].id,{name:'Opening titles',markdown:'## Band\n- Felt piano'})
assert.match(JSON.stringify(buildLitePrompt(booklet,{start:1.25,end:3,prompt:'Keep the melody'})),/Felt piano/)
applyPictureAnalysis(booklet,{...report,sheetId:B.id,offset:1.25},50)
assert.equal(readScoring(booklet).cues[0].markdown,'## Band\n- Felt piano')
const editBefore=readScoring(booklet)
const half=splitFilmCue(booklet,Bcues[0].id,3)
assert.deepEqual(readScoring(booklet).cues.slice(0,2).map(c=>[c.start,c.end]),[[1.25,3],[3,10.261]])
mergeFilmCue(booklet,Bcues[0].id)
assert.equal(readScoring(booklet).cues.length,editBefore.cues.length)
booklet.editing.undo()
assert.ok(readScoring(booklet).cues.some(c=>c.id===half))
booklet.editing.undo()
assert.deepEqual(readScoring(booklet),editBefore)
moveFilmCue(booklet,Bcues[0].id,1.5)
assert.equal(readScoring(booklet).cues[0].start,1.5)
booklet.editing.undo()
reorderFilmCue(booklet,Bcues[0].id,Bcues[1].id)
assert.equal(readScoring(booklet).cues.find(c=>c.id===Bcues[1].id)?.start,1.25)
booklet.editing.undo()
assert.deepEqual(readScoring(booklet),editBefore)
selectFilmSheet(booklet,A.id)
assert.deepEqual(readScoring(booklet),firstSheet)
assert.deepEqual(readPictureReport(booklet),firstReport)
const reopened=Project.load(env,booklet.toArrayBuffer() as ArrayBuffer)
assert.deepEqual(readFilmBook(reopened).sheets.map(s=>s.name),['film.mp4','film.mp4'])
selectFilmSheet(reopened,B.id)
assert.deepEqual(readScoring(reopened),editBefore)
assert.equal(readPictureReport(reopened)?.sheetId,B.id)
updateFilmTrack(reopened,B.id,{folded:true,height:110})
selectFilmSheet(reopened,null)
assert.equal(currentFilm(reopened),undefined)
assert.equal(readScoring(reopened).cues.length,0)
reopened.editing.undo()
assert.equal(currentFilm(reopened)?.id,B.id)
assert.equal(currentFilm(reopened)?.height,110)
assert.deepEqual(readScoring(reopened),editBefore)


// Removing a library movie never consumes another sheet, even when file names match.
deleteFilmSheet(reopened,A.id)
assert.deepEqual(readFilmBook(reopened).sheets.map(s=>s.id),[B.id])
assert.deepEqual(readScoring(reopened),editBefore)
reopened.editing.undo()
deleteFilmSheet(reopened,B.id)
assert.deepEqual(readFilmBook(reopened).sheets.map(s=>s.id),[A.id])
assert.equal(currentFilm(reopened),undefined)
assert.equal(readPictureReport(reopened),undefined)
assert.deepEqual(readScoring(reopened).cues,[])
const withoutB=Project.load(env,reopened.toArrayBuffer() as ArrayBuffer)
selectFilmSheet(withoutB,A.id)
assert.deepEqual(readScoring(withoutB),firstSheet)
assert.deepEqual(readPictureReport(withoutB),firstReport)
reopened.editing.undo()
assert.equal(currentFilm(reopened)?.id,B.id)
assert.deepEqual(readScoring(reopened),editBefore)

// A picture analysis finishing after a drag must not refill the gap the user just made.
const {applyCueTiming}=await import('../src/flowtu/film-cue-drag')
const {setSelectedScoringCue}=await import('../src/flowtu/scoring-selection')
const {manualWorkArea}=await import('../src/flowtu/work-area')
const {getExplicitTimelineSelection}=await import('../src/flowtu/timeline-selection')
const timeline=Project.fromSkeleton(env,ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}))
writeScoring(timeline,{...readScoring(timeline),cues:[
    {...protectedCue,id:'opening',name:'Opening',start:0,end:15,autoEnd:true},
    {...protectedCue,id:'ending',name:'Ending',start:15,end:30}
]})
const initial=readScoring(timeline).cues
const initialTiming=new Map(initial.map(c=>[c.id,{start:c.start,end:c.end}]))
setSelectedScoringCue(timeline,'ending')
applyCueTiming(timeline,{id:'ending',start:10,end:25})
const bounds={start:Math.round(timeline.tempoMap.secondsToPPQN(10)),end:Math.round(timeline.tempoMap.secondsToPPQN(25))}
assert.deepEqual(manualWorkArea(timeline),bounds)
assert.deepEqual(getExplicitTimelineSelection(timeline),bounds)
assert.deepEqual(readScoring(timeline).cues.map(c=>[c.start,c.end]),[[0,15],[10,25]])
timeline.editing.undo()
assert.deepEqual(readScoring(timeline).cues,initial)
assert.equal(manualWorkArea(timeline),undefined)
timeline.editing.redo()
assert.deepEqual(getExplicitTimelineSelection(timeline),bounds)
applyPictureAnalysis(timeline,report,50,initialTiming)
assert.deepEqual(readScoring(timeline).cues.map(c=>[c.id,c.start,c.end]),[['opening',0,15],['ending',10,25]])
assert.equal(readPictureReport(timeline)?.model,report.model)
const reopenedTimeline=Project.load(env,timeline.toArrayBuffer() as ArrayBuffer)
assert.deepEqual(readScoring(reopenedTimeline),readScoring(timeline))
assert.deepEqual(manualWorkArea(reopenedTimeline),bounds)

// A merged cue remains a single analysis card, with ordered shots and each original musical instruction.
// Check the actual provider request, including two instructions too long for the command box.
const {pictureGroups,requestLiteGuide}=await import('../src/flowtu/lite-model')
const mergeProject=Project.fromSkeleton(env,ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}))
applyPictureAnalysis(mergeProject,report,50)
const originalCues=readScoring(mergeProject).cues
const [first,second,third]=originalCues
const requestedDirections=['Sparse piano '+ 'a'.repeat(455), 'Busy bowed strings '+ 'b'.repeat(456)]
writeScoring(mergeProject,{...readScoring(mergeProject),cues:[
    {...first,prompt:requestedDirections[0],markdown:'Opening rain',tone:'keys'},
    {...second,prompt:requestedDirections[1],markdown:'The train approaches',tone:'pad'}, third
]})
const beforeMerge=readScoring(mergeProject)
mergeFilmCue(mergeProject,first.id)
const scene=readScoring(mergeProject).cues[0]
assert.equal(scene.end,second.end)
assert.deepEqual(scene.analysisSections?.map(item=>item.prompt),requestedDirections)
assert.ok(scene.markdown?.includes('Opening rain') && scene.markdown.includes('The train approaches'))
let cards=pictureGroups(readPictureReport(mergeProject)!,readScoring(mergeProject).cues)
assert.deepEqual(cards.map(card=>card.shots.map(s=>s.title)),[['Station','Train','Another angle'],['Night']])
let received:ReturnType<typeof buildLitePrompt>|undefined
Reflect.set(globalThis,'window',{flowtuScoringModel:{composeMidi:(input:ReturnType<typeof buildLitePrompt>)=>{
    received=input
    return Promise.resolve([{pitch:60,beat:0,length:1,velocity:.7}])
}}})
await requestLiteGuide(mergeProject,scene,new AbortController().signal)
assert.deepEqual(received?.cue.directions[0].sections?.map(part=>[part.in,part.out,part.prompt,part.tone]),[
    [first.start,first.end,requestedDirections[0],'keys'],[second.start,second.end,requestedDirections[1],'pad']
])
assert.deepEqual(received?.picture.map(s=>s.title),['Station','Train','Another angle'])
assert.deepEqual(buildLitePrompt(Project.load(env,mergeProject.toArrayBuffer() as ArrayBuffer),scene),received)
mergeProject.editing.undo()
assert.deepEqual(readScoring(mergeProject),beforeMerge)
assert.equal(pictureGroups(readPictureReport(mergeProject)!,beforeMerge.cues).length,4)
mergeProject.editing.redo()
moveFilmCue(mergeProject,scene.id,3)
const movedScene=readScoring(mergeProject).cues.find(c=>c.id===scene.id)!
assert.deepEqual(buildLitePrompt(mergeProject,movedScene).picture.map(s=>s.title),['Station','Train','Another angle'])
const splitId=splitFilmCue(mergeProject,scene.id,3+first.end)
const later=readScoring(mergeProject).cues.find(c=>c.id===splitId)!
assert.deepEqual(later.analysisSections?.map(x=>x.name),[second.name])
assert.deepEqual(buildLitePrompt(mergeProject,later).picture.map(s=>s.title),['Train','Another angle'])

// Merge three long instructions, trim the result, then finish a vision pass started before the merges.
const serial=Project.fromSkeleton(env,ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}))
applyPictureAnalysis(serial,report,50)
const serialCues=readScoring(serial).cues.map((c,i)=>({...c,prompt:['Generate warm keys ','Generate plucked melody ','Generate quiet strings '][i]+String(i).repeat(378)}))
writeScoring(serial,{...readScoring(serial),cues:serialCues})
const originalBounds=new Map(serialCues.map(c=>[c.id,{start:c.start,end:c.end}]))
mergeFilmCue(serial,serialCues[0].id)
const ab=readScoring(serial)
mergeFilmCue(serial,serialCues[0].id)
const [abc]=readScoring(serial).cues
assert.equal(readScoring(serial).cues.length,1)
for(const c of serialCues) assert.ok(abc.prompt.includes(c.prompt.slice(0,28)))
assert.deepEqual(abc.analysisSections?.map(s=>s.prompt),serialCues.map(c=>c.prompt))
serial.editing.undo()
assert.deepEqual(readScoring(serial),ab)
serial.editing.redo()
const mergedLocal=serial.editing.modify(()=>generateScoringMidi(serial,abc),true).unwrap()
assert.equal(readScoringTakes(serial,abc.id)[0].id,mergedLocal.regionId)
serial.editing.undo()
assert.deepEqual(readScoring(serial).cues,[abc])

applyCueTiming(serial,{id:abc.id,start:10,end:20})
const trimmed=readScoring(serial)
const latestReport={...report,model:'Late pass',scenes:report.scenes.map(s=>({...s,observation:'Updated '+s.title}))}
applyPictureAnalysis(serial,latestReport,50,originalBounds)
assert.deepEqual(readScoring(serial),trimmed,'Analysis finishing after a merge must not recreate the consumed cues.')
const filtered=await requestLiteGuide(serial,trimmed.cues[0],new AbortController().signal)
assert.deepEqual(received?.picture.map(s=>s.imageObservation),['Updated Train','Updated Another angle'])
const generated=serial.editing.modify(()=>generateScoringMidi(serial,trimmed.cues[0],abc.id,filtered),true).unwrap()
assert.equal(readScoringTakes(serial,abc.id)[0].id,generated.regionId)
serial.editing.undo()
assert.equal(readScoringTakes(serial,abc.id).length,0)
serial.editing.undo()
assert.equal(readPictureReport(serial)?.model,report.model)
assert.deepEqual(readScoring(serial),trimmed)

// Keep an intervening human rewrite in full when its merged command box needs to be shortened again.
serial.editing.undo()
serial.editing.undo()
const authoredGroup=readScoring(serial)
assert.equal(authoredGroup.cues.length,2)
const rewrite='Bring in cello before the train. '+ 'z'.repeat(410)
writeScoring(serial,{...authoredGroup,cues:authoredGroup.cues.map((c,i)=>i===0?{...c,prompt:rewrite}:c)})
mergeFilmCue(serial,abc.id)
const finalScene=readScoring(serial).cues[0]
assert.ok(buildLitePrompt(serial,finalScene).cue.directions[0].markdown?.includes(rewrite))

// A report finishing behind a user edit must preserve both the edit's undo slot and the analysis.
const delayed=Project.fromSkeleton(env,ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}))
const movie=newFilmSheet('film.mp4',30,0)
addFilmSheet(delayed,movie)
const authoredSpan={...protectedCue,start:0,end:30}
writeScoring(delayed,{...readScoring(delayed),cues:[authoredSpan]})
const take=generateScoringMidi(delayed,authoredSpan)
const {deleteProjectAsset}=await import('../src/flowtu/scoring-assets')
assert.ok(deleteProjectAsset(delayed,take.regionId))
const {takeRegion}=await import('../src/flowtu/scoring-model')
assert.equal(takeRegion(delayed,take.regionId),undefined)
applyPictureAnalysis(delayed,{...report,sheetId:movie.id},50,undefined,'automatic')
assert.ok(readPictureReport(delayed))
delayed.editing.undo()
assert.ok(takeRegion(delayed,take.regionId),'first Undo restores the deleted take')
assert.equal(readPictureReport(delayed)?.sheetId,movie.id,'background result survives that Undo')
delayed.editing.redo()
assert.equal(takeRegion(delayed,take.regionId),undefined)
const currentReport=readPictureReport(delayed)
applyPictureAnalysis(delayed,{...report,sheetId:movie.id,model:'Manually requested'},50)
delayed.editing.undo()
assert.deepEqual(readPictureReport(delayed),currentReport,'manual reanalysis still has its own undo step')
const movie2=newFilmSheet('other.mp4',30,0)
addFilmSheet(delayed,movie2)
applyPictureAnalysis(delayed,{...report,sheetId:movie2.id},50,undefined,'automatic')
assert.ok(readScoring(delayed).cues.length>0)
delayed.editing.undo()
assert.equal(readScoring(delayed).cues.length,0,'automatic cue edits stay undoable')
delayed.editing.undo()
assert.deepEqual(readPictureReport(delayed),currentReport)
