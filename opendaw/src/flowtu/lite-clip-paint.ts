import {AudioRenderer, NotesRenderer, TimelineRange, type Project} from '@opendaw/studio-core'
import {LoopableRegion} from '@opendaw/lib-dsp'
import {AudioRegionBoxAdapter, type NoteRegionBoxAdapter} from '@opendaw/studio-adapters'
import type {Terminator} from '@opendaw/lib-std'
import {curveProgress} from './crossfades'
import {tr} from './studio-language'

export type FadePart='fade-in'|'fade-out'|'curve-in'|'curve-out'
type Clip=AudioRegionBoxAdapter|NoteRegionBoxAdapter
type FadeShape={fadeIn:number;fadeOut:number;slopeIn:number;slopeOut:number}

export function fadeShape(r:AudioRegionBoxAdapter):FadeShape {
    return {fadeIn:r.fading.in,fadeOut:r.fading.out,slopeIn:r.fading.inSlope,slopeOut:r.fading.outSlope}
}

// Studio's renderers expect timeline pulses, while Score Lite lays out the film in elapsed seconds.
class ClipRange extends TimelineRange {
    constructor(private project:Project,private region:Clip) {super()}
    override get unitMin(){return this.region.position}
    override get unitMax(){return this.region.complete}
    override get unitPadding(){return 0}
    override unitToX(pulse:number){
        const tempo=this.project.tempoMap
        return this.width*tempo.intervalToSeconds(this.region.position,pulse)/tempo.intervalToSeconds(this.region.position,this.region.complete)
    }
}

export function paintLiteClip(button:HTMLButtonElement,canvas:HTMLCanvasElement,project:Project,region:Clip,owner:Terminator) {
    const range=owner.own(new ClipRange(project,region))
    const draw=()=>{
        const w=canvas.clientWidth, h=canvas.clientHeight
        if(w<1 || h<1)return
        const ctx=canvas.getContext('2d')
        if(!ctx)return
        canvas.width=Math.min(8192,Math.ceil(w*devicePixelRatio)); canvas.height=Math.ceil(h*devicePixelRatio)
        range.width=canvas.width/devicePixelRatio
        const bounds={top:Math.min(15,h*.34),bottom:h-1}
        if(region.loopDuration<=0)return
        const cycles=LoopableRegion.locateLoops(region,region.position,region.complete)
        for (const pass of cycles) {
            if(region instanceof AudioRegionBoxAdapter)
                region.optFile.ifSome(file=>AudioRenderer.render(ctx,range,file,project.tempoMap,region.observableOptPlayMode,
                    region.waveformOffset.getValue(),region.gain.getValue(),bounds,'#96cce6',pass))
            else region.optCollection.ifSome(collection=>NotesRenderer.render(ctx,range,collection,bounds,'#e8b47e',pass))
        }
        const layer=button.querySelector<HTMLElement>('.ft-lite-fades')
        if(layer && region instanceof AudioRegionBoxAdapter)drawLiteFade(layer,region,project,fadeShape(region))
    }
    const size=new ResizeObserver(draw)
    size.observe(canvas)
    owner.own({terminate:()=>size.disconnect()})
    if(region instanceof AudioRegionBoxAdapter)region.optFile.ifSome(file=>owner.own(file.getOrCreateLoader().subscribe(draw)))
    for(const edge of ['trim-start','trim-end']){
        const grip=document.createElement('i');grip.className='ft-lite-trim-edge';grip.dataset.clipEdge=edge
        grip.title=tr(edge==='trim-start'?'Trim start':'Trim end');button.append(grip)
    }
    if(!(region instanceof AudioRegionBoxAdapter))return
    const layer=document.createElement('span');layer.className='ft-lite-fades';button.append(layer)
    drawLiteFade(layer,region,project,fadeShape(region))
}

export function drawLiteFade(layer:HTMLElement,region:AudioRegionBoxAdapter,p:Project,shape:FadeShape) {
    const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg')
    svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('preserveAspectRatio','none')
    layer.replaceChildren(svg)
    const duration=p.tempoMap.intervalToSeconds(region.position,region.complete)
    const x=(pulse:number)=>Math.min(100,Math.max(0,100*p.tempoMap.intervalToSeconds(region.position,pulse)/duration))
    for(const side of ['in','out'] as const){
        const incoming=side==='in', length=incoming?shape.fadeIn:shape.fadeOut
        const left=incoming?0:x(region.complete-length), right=incoming?x(region.position+length):100
        const power=(incoming?region.box.fading.inEqualPower:region.box.fading.outEqualPower).getValue()
        const slope=incoming?shape.slopeIn:shape.slopeOut
        const y=(t:number)=>100*(incoming?1-curveProgress(t,slope,true,power):curveProgress(t,slope,false,power))
        if(right>left){
            const line=document.createElementNS(ns,'polyline')
            line.setAttribute('points',Array.from({length:33},(_,i)=>(left+(right-left)*i/32)+','+y(i/32)).join(' '))
            line.dataset.side=side;svg.append(line)
        }
        const handle=document.createElement('i');handle.className='ft-lite-fade-handle';handle.dataset.clipEdge='fade-'+side
        handle.title=tr(incoming?'Fade in':'Fade out')
        handle.style.left='clamp(5px,'+(incoming?right:left)+'%,calc(100% - 5px))';layer.append(handle)
        if(!power && (right-left)/100*layer.clientWidth>=16) {
            const point=document.createElement('i');point.className='ft-lite-curve-handle';point.dataset.clipEdge='curve-'+side
            point.title=tr(incoming?'Drag fade in curve':'Drag fade out curve')
            point.style.left=((left+right)/2)+'%';point.style.top=y(.5)+'%';layer.append(point)
        }
    }
}
