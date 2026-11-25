// Local, bounded music commands. No model or network request is used.
export const tones = {
    keys: {label: 'Electric Piano', engine: 'Tubular · FM Synth'},
    bass: {label: 'Bass', engine: 'Vaporisateur · Bass'},
    pad: {label: 'Ambient Pad', engine: 'Vaporisateur · Pad'},
    pluck: {label: 'Pluck', engine: 'Vaporisateur · Pluck'},
    lead: {label: 'Lead', engine: 'Vaporisateur · Lead'},
    bell: {label: 'Bell', engine: 'Tubular · FM Synth'}
} as const
export type Tone = keyof typeof tones
export type Pattern = 'chords' | 'arpeggio' | 'bass' | 'melody'
export type MusicalContext = {tonic:number; minor:boolean; bars:number; harmony:number[][]}
export type Command = {
    action: 'generate' | 'tone' | 'effect' | 'tempo'
    tone: Tone; bars: number; pattern: Pattern; tonic: number; minor: boolean
    target?: number; bpm?: number; reverb?: number; delay?: number
    removeEffect: boolean; sparse: boolean; warm: boolean; prompt: string
    harmony?: number[][]; usesContext?: boolean
}
export type Note = {beat: number; length: number; pitch: number; velocity: number}
const chinese: Record<string,number> = {'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12,'十六':16,'二十四':24,'三十二':32}
const numeric = (s: string) => chinese[s] ?? Number(s)
const numberToken = '(-?\\d+(?:\\.\\d+)?|三十二|二十四|十六|十二|十一|[一二两三四五六七八九十])'
export function parseCommand(raw: string, fallback: Tone = 'keys', bars = 4, context?: MusicalContext, allowDescription = false): Command {
    const text = raw.trim().toLowerCase()
    if (!text) throw new Error('Describe the instrument, notes or effect you want to add.')
    if (text.length > 500) throw new Error('Keep local commands within 500 characters.')
    if (/鼓|drum|小提琴|violin|人声|vocal|萨克斯|sax/.test(text)) throw new Error('Local instruments: electric piano, bass, ambient pad, pluck, lead and bell. Drums and sampled instruments are not supported yet.')
    const matched: Tone | undefined = /贝斯|bass|低音/.test(text) ? 'bass' : /pad|铺底|弦乐|strings|氛围/.test(text) ? 'pad'
        : /拨弦|吉他|pluck|guitar/.test(text) ? 'pluck' : /钟琴|铃|bell/.test(text) ? 'bell'
        : /主音|lead|vaporisateur/.test(text) ? 'lead' : /钢琴|键盘|piano|keys|tubular/.test(text) ? 'keys' : undefined
    const hasReverb = /混响|reverb/.test(text), hasDelay = /延迟|回声|delay|echo/.test(text)
    const explicitGenerate = /生成|编写|写一|来一|创作|generate|create|小节|\bbars?\b|和弦|琶音|旋律/.test(text)
    const toneOnly = /换成|换为|更换|切换|音色改|音色换|change|switch/.test(text)
    const tempo = text.match(/(?:bpm|速度|节奏)\s*[:：=为到]?\s*(-?\d+(?:\.\d+)?)/i) ?? text.match(/(-?\d+(?:\.\d+)?)\s*bpm/i)
    const target = text.match(new RegExp('第?\\s*'+numberToken+'\\s*(?:条)?\\s*(?:轨道|轨)')) ?? text.match(/track\s*(\d+)/)
    const barMatch = text.match(new RegExp(numberToken+'\\s*(?:个)?\\s*(?:小节|bars?\\b)'))
    const count = barMatch ? numeric(barMatch[1]) : bars
    if (!Number.isInteger(count) || count < 1 || count > 32) throw new Error('Generate between 1 and 32 bars at a time.')
    const bpm = tempo ? Number(tempo[1]) : undefined
    if (bpm !== undefined && (bpm < 40 || bpm > 240)) throw new Error('Tempo must be between 40 and 240 BPM.')
    const targetIndex = target ? numeric(target[1]) : undefined
    if (targetIndex !== undefined && (!Number.isInteger(targetIndex) || targetIndex < 1)) throw new Error('Track numbers start at 1.')
    if (!allowDescription && !matched && !explicitGenerate && !hasReverb && !hasDelay && bpm === undefined) throw new Error('Command not recognized. Try “Generate 4 bars of piano chords” or “Add 25% reverb to track 2”.')
    const action = toneOnly && matched ? 'tone' : !explicitGenerate && !matched && (hasReverb || hasDelay) ? 'effect'
        : !explicitGenerate && !matched && bpm !== undefined ? 'tempo' : 'generate'
    const tone = matched ?? fallback
    const key = text.match(/(?:\b|调性\s*[:：]?)([a-g])([#b]?)[\s-]*(major|minor|maj|min|大调|小调|大|小|m\b)/i)
    const explicitMood = /忧伤|伤感|悲伤|暗|minor|小调|major|大调/.test(text)
    const minor = key ? /minor|min|小|^m$/.test(key[3]) : explicitMood ? /忧伤|伤感|悲伤|暗|minor|小调/.test(text) : context?.minor ?? false
    const pc: Record<string,number> = {c:0,d:2,e:4,f:5,g:7,a:9,b:11}
    const tonic = key ? (pc[key[1]] + (key[2] === '#' ? 1 : key[2] === 'b' ? -1 : 0) + 12) % 12 : !explicitMood && context ? context.tonic : minor ? 9 : 0
    const progression = text.match(/(?:和弦进行|chord progression)\s*[:：]\s*([^，。\n]+)/i)
    const usesContext = !!context && !key && !explicitMood && !progression
    const harmony = progression ? parseHarmony(progression[1]) : usesContext ? context!.harmony : undefined
    const pattern: Pattern = /琶音|分解|arpeggio/.test(text) ? 'arpeggio' : /和弦|chord|铺底|pad/.test(text) ? 'chords'
        : /旋律|melody/.test(text) ? 'melody' : tone === 'bass' ? 'bass' : tone === 'keys' || tone === 'pad' ? 'chords' : 'melody'
    const amount = (word: string, defaultValue: number) => {
        const before = text.match(new RegExp('(-?\\d+(?:\\.\\d+)?)\\s*%\\s*(?:的)?\\s*(?:'+word+')'))
        const after = text.match(new RegExp('(?:'+word+')\\s*(?:到|为|设为|[:：])?\\s*(-?\\d+(?:\\.\\d+)?)\\s*%'))
        const match = before ?? after
        const value = match ? Number(match[1]) / 100 : /少量|一点|轻微|small/.test(text) ? .15 : /大空间|大厅|大混响|heavy/.test(text) ? .5 : defaultValue
        if (value < 0 || value > 1) throw new Error('Effect amount must be between 0% and 100%.')
        return value
    }
    return {action,tone,bars:count,pattern,tonic,minor,target:targetIndex,bpm,
        reverb:hasReverb ? amount('混响|reverb', .25) : undefined,delay:hasDelay ? amount('延迟|回声|delay|echo', .2) : undefined,
        removeEffect:/去掉|移除|关闭|不要|remove|disable/.test(text),sparse:/稀疏|简单|舒缓|慢|sparse/.test(text),warm:/温暖|柔和|warm|soft/.test(text),prompt:raw.trim(),harmony,usesContext}
}
export function parseHarmony(text:string):number[][] {
    const tokens=text.trim().split(/[\s,\/–—-]+/),pc:Record<string,number>={c:0,d:2,e:4,f:5,g:7,a:9,b:11}
    if(!tokens.length||tokens.length>32)throw new Error('Use 1–32 chords, for example “chord progression: Dm Bb F C”.')
    return tokens.map(token=>{
        const m=token.match(/^([a-g])([#b]?)(maj7|m7|m|7)?$/i)
        if(!m)throw new Error('Supported chords: major, minor, maj7, m7 and 7. Example: “chord progression: Dm Bb F C”.')
        const root=60+(pc[m[1].toLowerCase()]+(m[2]==='#'?1:m[2]==='b'?-1:0)+12)%12,quality=m[3]?.toLowerCase()??''
        return [0,quality==='m'||quality==='m7'?3:4,7,...(quality.includes('7')?[quality==='maj7'?11:10]:[])].map(n=>root+n)
    })
}
export function harmonyFor(command:Pick<Command,'tonic'|'minor'|'harmony'>):number[][] {
    if(command.harmony?.length)return command.harmony.map(chord=>[...chord])
    const scale=command.minor?[0,2,3,5,7,8,10]:[0,2,4,5,7,9,11]
    return (command.minor?[0,5,2,6]:[0,4,5,3]).map(d=>[0,2,4].map(n=>60+command.tonic+scale[(d+n)%7]+Math.floor((d+n)/7)*12))
}
export function harmonyLabel(harmony:number[][]):string {
    const names=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B']
    return harmony.map(chord=>{const root=chord[0]%12,intervals=chord.map(p=>(p-root+120)%12);return names[root]+(intervals.includes(3)?'m':'')+(intervals.includes(11)?'maj7':intervals.includes(10)?'7':'')}).join(' / ')
}
export function generateNotes(command: Command, variation = 0): Note[] {
    let seed = [...command.prompt].reduce((n,c) => (Math.imul(n,31)+c.charCodeAt(0))|0, 42 + variation * 1009)
    const random = () => {seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296}
    const scale = command.minor ? [0,2,3,5,7,8,10] : [0,2,4,5,7,9,11]
    const progression = command.minor ? [0,5,2,6] : [0,4,5,3]
    const harmony=harmonyFor(command)
    const degreePitch = (degree: number) => scale[degree % 7] + Math.floor(degree / 7) * 12
    const notes: Note[] = [], base = (command.tone === 'bass' ? 36 : command.tone === 'pad' ? 48 : 60) + command.tonic
    const add = (beat:number,length:number,pitch:number) => notes.push({beat,length:Math.min(length,command.bars*4-beat),pitch:Math.min(108,pitch),velocity:(command.warm?.55:.68)+random()*.1})
    for (let bar = 0; bar < command.bars; bar++) {
        const degree = progression[bar%4], pitches=harmony[bar%harmony.length], octave=command.tone==='bass'?36:command.tone==='pad'?48:60
        const root=octave+pitches[0]%12, chord=pitches.map(p=>root+p-pitches[0])
        if (command.pattern === 'chords') {
            const starts = command.sparse || command.tone === 'pad' ? [0] : [0,2]
            for (const beat of starts) for (const pitch of chord) add(bar*4+beat,starts.length===1?3.7:1.75,pitch)
        } else if (command.pattern === 'bass') {
            for (const beat of command.sparse?[0,2]:[0,1.5,2,3.5]) add(bar*4+beat,command.sparse?1.6:.4,beat===3.5?chord[2]:root)
        } else if (command.pattern === 'arpeggio') {
            const step = command.sparse ? 1 : .5
            for (let beat=0,i=0;beat<4;beat+=step,i++) add(bar*4+beat,step*.85,chord[(i+variation)%chord.length]+(i%6>=3?12:0))
        } else {
            const step = command.sparse ? 1 : .5
            for (let beat=0;beat<4;beat+=step) if (beat===0 || random()>.2) add(bar*4+beat,step*.85,command.harmony?chord[Math.floor(random()*chord.length)]:base+degreePitch((degree+Math.floor(random()*5))%7))
        }
    }
    return notes
}
// Standard MIDI file, format 0. Notes stay editable in any MIDI-capable DAW.
export function encodeMidi(notes: Note[], bpm: number): Uint8Array<ArrayBuffer> {
    const vlq = (n:number) => {const bytes=[n&127];while((n>>=7)>0)bytes.unshift((n&127)|128);return bytes}
    const micros=Math.round(60_000_000/bpm)
    const data=[0,255,81,3,(micros>>>16)&255,(micros>>>8)&255,micros&255,0,255,88,4,4,2,24,8]
    const events=notes.flatMap(n=>[{tick:Math.round(n.beat*480),on:true,pitch:n.pitch,v:Math.round(n.velocity*127)},{tick:Math.round((n.beat+n.length)*480),on:false,pitch:n.pitch,v:0}])
        .sort((a,b)=>a.tick-b.tick||Number(a.on)-Number(b.on))
    let previous=0
    for(const e of events){data.push(...vlq(e.tick-previous),e.on?144:128,e.pitch,e.v);previous=e.tick}
    data.push(0,255,47,0)
    const len=data.length
    return new Uint8Array([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107,(len>>>24)&255,(len>>>16)&255,(len>>>8)&255,len&255,...data])
}
