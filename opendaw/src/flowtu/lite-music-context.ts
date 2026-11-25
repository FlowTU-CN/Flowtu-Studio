import {LoopableRegion, PPQN, type AudioData} from '@opendaw/lib-dsp'
import {UUID} from '@opendaw/lib-std'
import {AudioRegionBoxAdapter, NoteRegionBoxAdapter} from '@opendaw/studio-adapters'
import type {Project} from '@opendaw/studio-core'
import {isAssetLane} from './playback-lanes'
import {takeRegion} from './scoring-model'
import {midiTrackName} from './track-name'

const windowSeconds = 8
const labels = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
type Source = {track: string; instrument: string; regionId: string}
type PlayedNote = Source & {start: number; end: number; pitch: number; velocity: number}
type AudioEdge = Source & {from: number; to: number; status: 'pcm' | 'not-decoded' | 'stretched' | 'empty'; rmsDb?: number; onsetsPerSecond?: number; estimatedPitch?: number}
export type LiteMusicEdge = {notes: PlayedNote[]; audio: AudioEdge[]; boundaryPitches: number[]; chord: string | null}
export type LiteMusicContext = {bpm: number; endBpm: number; windowSeconds: number; before: LiteMusicEdge; after: LiteMusicEdge}

function chordName(pitches: number[]) {
    const pcs = new Set(pitches.map(pitch => pitch % 12))
    const triads: [string, number[]][] = [['',[0,4,7]], ['m',[0,3,7]], ['dim',[0,3,6]], ['7',[0,4,7,10]], ['maj7',[0,4,7,11]], ['m7',[0,3,7,10]]]
    for (const root of pcs) {
        for (const [suffix, tones] of triads) if (tones.length === pcs.size && tones.every(x => pcs.has((root + x) % 12))) return labels[root] + suffix
    }
    return null
}

// A strong periodicity AND fundamental are required. Chords, silence and noise may have no pitch estimate.
function tonalPitch(wave: Float32Array, rate: number, offset: number) {
    const n = 384
    if (offset < 0 || offset + n > wave.length) return
    let energy = 0
    for (let i = 0; i < n; i++) energy += wave[offset+i] ** 2
    if (energy/n < .00001) return
    const max = Math.min(Math.round(rate/55), Math.floor(n/3)), corr = new Float64Array(max+1)
    for (let lag = Math.max(2, Math.floor(rate/1100)); lag <= max; lag++) {
        let sum=0, a=0, b=0
        for (let i=0; i<n-lag; i++) {
            const x=wave[offset+i], y=wave[offset+i+lag]; sum+=x*y; a+=x*x; b+=y*y
        }
        corr[lag] = sum / Math.sqrt(a*b || 1)
    }
    for (let lag=2; lag<max; lag++) {
        if (corr[lag]<.92 || corr[lag]<corr[lag-1] || corr[lag]<corr[lag+1]) continue
        const delta = (corr[lag-1]-corr[lag+1]) / (2*(corr[lag-1]-2*corr[lag]+corr[lag+1]) || 1)
        const hz = rate / (lag + Math.max(-.5,Math.min(.5,delta)))
        let real=0, imag=0
        for (let i=0; i<n; i++) {const phase=2*Math.PI*hz*i/rate; real+=wave[offset+i]*Math.cos(phase); imag+=wave[offset+i]*Math.sin(phase)}
        if ((real*real+imag*imag)*2/(n*energy) >= .62) return Math.round(69 + 12*Math.log2(hz/440))
    }
    return undefined
}

function pcmFeatures(data: AudioData, start: number, end: number, edge: 'before' | 'after', gainDb: number): Partial<AudioEdge> {
    const stride = Math.max(1,Math.round(data.sampleRate/4000)), rate = data.sampleRate/stride
    const from=Math.max(0,Math.round(start*data.sampleRate)), to=Math.min(data.numberOfFrames,Math.round(end*data.sampleRate))
    const count = Math.floor((to-from)/stride)
    if (count < 1 || !data.frames.length) return {status:'empty'}
    const wave=new Float32Array(count), block=Math.max(1,Math.round(rate*.03))
    let sum=0, blockSum=0, previous=0, onsets=0
    for (let i=0; i<count; i++) {
        // RMS over channels avoids losing out-of-phase stereo. Use one real channel for pitch.
        let loudness=0, firstChannel=0
        for (const [ch,channel] of data.frames.entries()) {
            for (let j=0; j<stride; j++) {const s=channel[from+i*stride+j]; loudness+=s*s; if (ch===0) firstChannel+=s}
        }
        wave[i]=firstChannel/stride; loudness/=stride*data.frames.length
        sum+=loudness; blockSum+=loudness
        if ((i+1)%block===0) {const rms=Math.sqrt(blockSum/block); if (i>=block && rms>.009 && rms>1.65*previous+.005) onsets++; previous=rms; blockSum=0}
    }
    const at = edge==='before' ? wave.length-768 : 0
    const p=tonalPitch(wave,rate,at), q=tonalPitch(wave,rate,at+384)
    return {status:'pcm', rmsDb: Math.max(-120, Math.round((10*Math.log10(sum/count || 1e-12)+gainDb)*10)/10),
        onsetsPerSecond: Math.round(onsets*rate/count*10)/10, ...(p!==undefined && p===q ? {estimatedPitch:p} : {})}
}

type AudioCandidate = {info: AudioEdge; region: AudioRegionBoxAdapter; channelGain: number}
function describeAudio(project: Project, {info, region, channelGain}: AudioCandidate, edge: 'before'|'after') {
    if (!region.isPlayModeNoStretch) return {...info,status:'stretched' as const}
    const file=region.optFile.unwrapOrNull(), pcm=file?.data.unwrapOrNull()
    if (!file || !pcm) return info
    // Describe up to two seconds from the loop pass touching the relevant edge.
    const tempo=project.tempoMap, boundary=tempo.secondsToPPQN(edge==='before' ? info.to : info.from)
    const unit = edge==='before' ? Math.max(region.position,boundary-.001) : boundary+.001
    const pass = LoopableRegion.locateLoops(region,unit,unit+.001).next().value
    if (!pass) return {...info,status:'empty' as const}
    const from=Math.max(info.from,tempo.ppqnToSeconds(pass.rawStart),edge==='before' ? info.to-2 : info.from)
    const to=Math.min(info.to,tempo.ppqnToSeconds(pass.rawEnd),edge==='after' ? info.from+2 : info.to)
    const sourceZero=file.startInSeconds+region.waveformOffset.getValue()-tempo.ppqnToSeconds(pass.rawStart)
    return {...info,from,to,...pcmFeatures(pcm,sourceZero+from,Math.min(file.endInSeconds,sourceZero+to),edge,region.gain.getValue()+channelGain)}
}

function readEdge(project: Project, min: number, max: number, edge: 'before'|'after'): LiteMusicEdge {
    const notes: PlayedNote[] = [], candidates: AudioCandidate[] = []
    const tempo = project.tempoMap, units = project.rootBoxAdapter.audioUnits.adapters(), solo = units.some(u=>u.isInstrument && u.box.solo.getValue())
    const lo=tempo.secondsToPPQN(min), hi=tempo.secondsToPPQN(max)
    if (max>min) for (const unit of units) {
        if (unit.box.mute.getValue() || (solo && !unit.box.solo.getValue()) || unit.box.volume.getValue()<=-100) continue
        for (const track of unit.tracks.values()) {
            if (!track.enabled.getValue() || isAssetLane(track)) continue
            for (const r of track.regions.collection.asArray()) {
                if (r.mute || r.complete<=lo || r.position>=hi) continue
                const source={regionId:UUID.toString(r.uuid), track:midiTrackName(unit.box) ?? unit.label, instrument:unit.input.label.unwrapOrElse(()=>unit.label)}
                if (r instanceof NoteRegionBoxAdapter && r.loopDuration>0) {
                    const list=r.optCollection.unwrapOrNull()?.events.asArray() ?? []
                    const first=Math.max(lo,r.position), last=Math.min(hi,r.complete)
                    const scanFrom=edge==='before' ? Math.max(first,last-r.loopDuration*12) : first
                    const scanTo=edge==='after' ? Math.min(last,first+r.loopDuration*12) : last
                    for (const pass of LoopableRegion.locateLoops(r,scanFrom,scanTo)) for (const note of list) {
                        const onset=pass.rawStart+note.position, release=pass.rawStart+note.complete
                        if (onset>=pass.resultEnd) break
                        if (release<=pass.resultStart || !note.velocity || !note.chance) continue
                        notes.push({...source, pitch:note.pitch,velocity:note.velocity,start:tempo.ppqnToSeconds(Math.max(pass.resultStart,onset)),end:tempo.ppqnToSeconds(Math.min(pass.resultEnd,release))})
                    }
                } else if (r instanceof AudioRegionBoxAdapter) {
                    candidates.push({region:r, channelGain:unit.box.volume.getValue(), info:{...source, from:Math.max(min,tempo.ppqnToSeconds(r.position)),to:Math.min(max,tempo.ppqnToSeconds(r.complete)),status:'not-decoded'}})
                }
            }
        }
    }
    const before=edge==='before'
    notes.sort((a,b)=>before ? b.end-a.end || b.start-a.start : a.start-b.start || b.end-a.end)
    const nearby=notes.slice(0,64), t=nearby[0], aligned=nearby.filter(n=>t && (before ? Math.abs(n.end-t.end) : Math.abs(n.start-t.start))<.035)
    const audio=candidates.sort((a,b)=> before ? b.info.to-a.info.to : a.info.from-b.info.from).slice(0,4).map(c=>describeAudio(project,c,edge))
    const boundaryPitches=[...new Set(aligned.map(n=>n.pitch))].sort((a,b)=>a-b)
    if (!boundaryPitches.length) {
        const tonal=audio.find(a=>a.estimatedPitch!==undefined && (a.rmsDb ?? -120)>-65)
        if(tonal?.estimatedPitch!==undefined) boundaryPitches.push(tonal.estimatedPitch)
    }
    return {notes:nearby.sort((a,b)=>a.start-b.start || a.pitch-b.pitch),audio,boundaryPitches,chord:chordName(boundaryPitches)}
}

export function readLiteMusicContext(project: Project, start: number, end: number): LiteMusicContext {
    return {bpm:project.tempoMap.getTempoAt(project.tempoMap.secondsToPPQN(start)),endBpm:project.tempoMap.getTempoAt(project.tempoMap.secondsToPPQN(end)),windowSeconds,
        before:readEdge(project,Math.max(0,start-windowSeconds),start,'before'), after:readEdge(project,end,end+windowSeconds,'after')}
}

function edgeDynamics(edge:LiteMusicEdge, side:'before'|'after') {
    const notes=side==='before' ? edge.notes.slice(-8) : edge.notes.slice(0,8)
    const starts=[...new Set(notes.map(n=>n.start))].sort((a,b)=>a-b)
    const gaps=starts.slice(1).map((s,i)=>s-starts[i]).filter(d=>d>.06 && d<1.6).sort((a,b)=>a-b)
    const audio=edge.audio.find(a=>a.status==='pcm' && (a.rmsDb ?? -120)>-65)
    const velocity=notes.length ? notes.reduce((sum,n)=>sum+n.velocity,0)/notes.length : audio?.rmsDb!==undefined ? Math.max(.15,Math.min(.95,1+audio.rmsDb/65)) : undefined
    const spacing=gaps.length ? gaps[Math.floor(gaps.length/2)] : audio?.onsetsPerSecond && audio.onsetsPerSecond>.65 ? 1/audio.onsetsPerSecond : undefined
    return {velocity,spacing}
}

/** Shape only the entrance and cadence of a newly generated region. Caller owns its undo transaction. */
export function shapeLiteTransition(project: Project, regionId: string, context: LiteMusicContext) {
    const region=takeRegion(project,regionId)
    if (!(region instanceof NoteRegionBoxAdapter)) return
    const notes=Array.from(region.optCollection.unwrapOrNull()?.events.asArray() ?? [])
    if (!notes.length) return
    const first=notes[0].position, last=notes[notes.length-1].position
    const before=edgeDynamics(context.before,'before'), after=edgeDynamics(context.after,'after')
    const usedByOnset = new Map<number, Set<number>>()
    for (const [i,note] of notes.entries()) {
        if (note.position!==first && note.position!==last) continue
        const atStart=first===last ? (i%2===0 && !!context.before.boundaryPitches.length) || !context.after.boundaryPitches.length : note.position===first
        const edge=atStart ? context.before : context.after, {velocity,spacing}=atStart ? before : after
        if (edge.boundaryPitches.length) {
            const used = usedByOnset.get(note.position) ?? new Set<number>()
            const targets=edge.boundaryPitches.flatMap(p=>{
                const closest=p+12*Math.round((note.pitch-p)/12)
                return [closest,closest-12,closest+12]
            }).filter(p=>p>=0 && p<=127 && !used.has(p))
            targets.sort((a,b)=>Math.abs(a-note.pitch)-Math.abs(b-note.pitch))
            if (targets.length) {note.box.pitch.setValue(targets[0]); used.add(targets[0]); usedByOnset.set(note.position,used)}
        }
        if (velocity!==undefined) note.box.velocity.setValue(Math.min(1,Math.max(.05,.4*note.velocity+.6*velocity)))
        if (spacing!==undefined) {
            const gate=Math.round(spacing*(atStart?context.bpm:context.endBpm)/60*PPQN.Quarter*.88)
            note.box.duration.setValue(Math.max(1,Math.min(note.duration,Math.round(.5*note.duration+.5*gate))))
        }
    }
}
