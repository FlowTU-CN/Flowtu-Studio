import assert from 'node:assert/strict'
import {Option, Progress, Terminable, UUID} from '@opendaw/lib-std'
import {AudioFileBox, SoundfontFileBox} from '@opendaw/studio-boxes'
import {InstrumentFactories, ProjectSkeleton, TrackBoxAdapter} from '@opendaw/studio-adapters'
import {Project, ProjectBundle, type ProjectEnv, ProjectMeta, ProjectProfile, SampleStorage, SoundfontStorage, Workers} from '@opendaw/studio-core'
import {deleteTracksWithMedia} from '../src/flowtu/track-delete'
import {encodeStudioBundle} from '../src/flowtu/retained-preset-resources'
import {prepareStoredAudition} from '../src/flowtu/media-retention'
import {takeRegion} from '../src/flowtu/scoring-model'
import {deleteProjectAsset} from '../src/flowtu/scoring-assets'

/** Exercise the real bundle encoder/decoder with separate source and destination stores. */
export async function checkRetainedPresetArchive(env:ProjectEnv) {
    const font=UUID.generate(), sample=UUID.generate(), fontId=UUID.toString(font), sampleId=UUID.toString(sample)
    const store=new Map<string,Uint8Array>()
    const text=new TextEncoder()
    const samplePath=SampleStorage.Folder+'/'+sampleId+'/', fontPath=SoundfontStorage.Folder+'/'+fontId+'/'
    for (const path of [samplePath+'audio.wav',samplePath+'peaks.bin',samplePath+'meta.json',fontPath+'soundfont.sf2',fontPath+'meta.json']) {
        store.set(path,text.encode(path))
    }
    const originalFiles=new Map(store), reads:string[]=[]
    const descriptor=Object.getOwnPropertyDescriptor(Workers,'Opfs')!
    Object.defineProperty(Workers,'Opfs',{configurable:true,get:()=>({
        read:async(path:string)=>{reads.push(path);assert.ok(store.has(path),path);return store.get(path)},
        write:async(path:string,value:Uint8Array)=>{store.set(path,value)}
    })})
    const loader=(uuid:UUID.Bytes)=>({uuid,state:{type:'loaded'},data:Option.None,peaks:Option.None,soundfont:Option.None,subscribe:()=>Terminable.Empty})
    const host={...env,sampleManager:{...env.sampleManager,getOrCreate:loader},soundfontManager:{...env.soundfontManager,getOrCreate:loader}} as ProjectEnv
    try {
        const project=Project.fromSkeleton(host,ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}))
        const soundLanes:TrackBoxAdapter[]=[], regions:string[]=[]
        project.editing.modify(()=>{
            const sf=SoundfontFileBox.create(project.boxGraph,font,box=>box.fileName.setValue('Imported SF2'))
            const wav=AudioFileBox.create(project.boxGraph,sample,box=>box.fileName.setValue('Imported sample'))
            const sourceTracks=[
                project.api.createInstrument(InstrumentFactories.Soundfont,{attachment:sf}),
                project.api.createInstrument(InstrumentFactories.Nano,{attachment:wav}),
                project.api.createInstrument(InstrumentFactories.Nano,{attachment:wav})
            ]
            for(const {trackBox} of sourceTracks) {
                const region=project.api.createNoteRegion({trackBox,position:0,duration:960,name:'Take'})
                project.api.createNoteEvent({owner:region,position:0,duration:960,pitch:60,velocity:1})
                soundLanes.push(project.boxAdapters.adapterFor(trackBox,TrackBoxAdapter))
                regions.push(UUID.toString(region.address.uuid))
            }
            project.trackUserCreatedSample(sample)
        },true)
        deleteTracksWithMedia(project,soundLanes)
        assert.ok(project.boxGraph.findBox(font).isEmpty() && project.boxGraph.findBox(sample).isEmpty())
        const profile=new ProjectProfile(UUID.generate(),project,ProjectMeta.init('Retained sampler'),Option.None)
        const bytes=await encodeStudioBundle(profile,Progress.Empty)
        assert.deepEqual(reads.sort(),[...originalFiles.keys()].sort(),'one copy per retained resource')
        store.clear()
        const restored=await ProjectBundle.decode(host,bytes)
        assert.deepEqual(store,originalFiles,'resource bytes must travel with the project')
        const other=restored.project
        assert.ok(other.boxGraph.findBox(font).isEmpty() && other.boxGraph.findBox(sample).isEmpty(),'archiving must not install instruments')
        const audition=other.copy()
        audition.editing.modify(()=>prepareStoredAudition(audition,regions.map(id=>takeRegion(audition,id)!)))
        assert.ok(audition.boxGraph.findBox(font).nonEmpty() && audition.boxGraph.findBox(sample).nonEmpty())
        audition.terminate()
        for (const id of regions) assert.ok(deleteProjectAsset(other,id))
        reads.length=0
        await encodeStudioBundle(restored,Progress.Empty)
        assert.deepEqual(reads,[],'removing the final Media item releases its archive dependencies')
    } finally {
        Object.defineProperty(Workers,'Opfs',descriptor)
    }
}
