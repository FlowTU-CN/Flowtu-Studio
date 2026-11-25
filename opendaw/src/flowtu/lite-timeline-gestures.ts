import type {Project} from '@opendaw/studio-core'
import {tr, watchStudioLanguage} from './studio-language'
import {frameToSeconds, getFrameRate} from './time-format'
import {timeSettings} from './time-settings'
import {snapTimePosition, timeGridIndex, timeGridPosition} from './time-snap'
import {seekTimeline, timelinePosition} from './timeline-seek'
import {pinchZoomLogDelta} from './TrackpadZoom'

type Point = {id: number; x: number; y: number; downX: number; downY: number; ruler: boolean; button: boolean}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export interface LiteLaneGesture {
    begin(event: PointerEvent): boolean
    move(event: PointerEvent): void
    end(event: PointerEvent): void
    cancel(): void
}

export function installLiteTimelineGestures(arrangement: HTMLElement, lanes: HTMLElement, ruler: HTMLElement,
    getProject: () => Project | undefined, getExtent: () => number, updatePosition: () => void, laneGesture?: LiteLaneGesture) {
    const controls = document.createElement('nav')
    controls.className = 'ft-lite-zoom-controls'
    const button = (action: string, label: string, invoke: () => void) => {
        const element=document.createElement('button')
        element.type='button'; element.dataset.gesture=action; element.textContent=label; element.onclick=invoke
        controls.append(element); return element
    }
    let zoom=1, lastProject: Project | undefined, ticksSignature='', blockClickUntil=0
    const points=new Map<number, Point>()
    let mode: 'idle'|'scrub'|'pan'|'lane'|'pinch'|'finished'='idle'
    let initialScroll=0, initialZoom=1, initialSpan=1, anchor=0
    let safariPinch: {scale:number; fraction:number; x:number}|undefined
    let mousePan: {id:number; x:number; left:number}|undefined
    const rulerRow=ruler.parentElement!, axisLabel=arrangement.querySelector<HTMLElement>('.ft-lite-axis-label')!
    const gutter=()=>axisLabel.offsetWidth
    const width=()=>Math.max(1,arrangement.clientWidth-gutter())
    const local=(clientX:number)=>clientX-arrangement.getBoundingClientRect().left-arrangement.clientLeft-gutter()
    const rawFraction=(clientX:number)=>(local(clientX)+arrangement.scrollLeft)/(width()*zoom)
    const displayTime=(seconds:number)=>{
        const hundredths=Math.round(seconds*100)
        const minor=(hundredths%6000/100).toFixed(2).padStart(5,'0').replace(/\.00$/,'').replace(/(\.\d)0$/,'$1')
        return Math.floor(hundredths/6000)+':'+minor
    }
    const zoomOut=button('zoom-out','−',()=>scaleAt(zoom/2))
    const reset=button('fit','1×',()=>scaleAt(1))
    const zoomIn=button('zoom-in','＋',()=>scaleAt(zoom*2))
    const previous=button('previous-frame','−1f',()=>nudge(-1))
    const next=button('next-frame','+1f',()=>nudge(1))
    function labels(){
        controls.setAttribute('aria-label',tr('Timeline'))
        for (const [el,label] of [[zoomOut,'Zoom out'],[reset,'Fit timeline'],[zoomIn,'Zoom in'],[previous,'Previous frame'],[next,'Next frame']] as const) {
            el.setAttribute('aria-label',tr(label));el.title=tr(label)
        }
    }
    function drawTicks() {
        const length=Math.max(.01,getExtent()), view=width(), full=view*zoom
        const wanted=length*76/full, power=10**Math.floor(Math.log10(wanted))
        const step=Math.max(.01,([1,2,5,10].find(n=>n*power>=wanted) ?? 10)*power)
        const first=Math.max(0,Math.floor(arrangement.scrollLeft/full*length/step)-1)
        const last=Math.min(Math.floor(length/step),Math.ceil((arrangement.scrollLeft+view)/full*length/step)+1)
        const signature=[length,step,first,last].join('/')
        if(signature===ticksSignature)return
        ticksSignature=signature
        ruler.replaceChildren(...Array.from({length:Math.max(0,last-first+1)},(_,i)=>{
            const t=(first+i)*step, tick=document.createElement('span')
            tick.textContent=displayTime(t);tick.style.left=(t/length*100)+'%';return tick
        }))
        ruler.style.backgroundSize=(100*step/length)+'% 4px, auto'
        ruler.style.backgroundImage='linear-gradient(90deg,#697e8c 1px,transparent 1px),linear-gradient(#1d2934,#1d2934)'
        ruler.style.backgroundRepeat='repeat-x, no-repeat'
    }
    const maxZoom=()=>Math.max(24,Math.min(8192,Math.ceil(Math.max(.01,getExtent())*2)))
    function draw() {
        const total=gutter()+width()*zoom
        lanes.style.width=rulerRow.style.width=total+'px'
        drawTicks()
        reset.textContent=(Math.round(zoom*10)/10)+'×';zoomIn.disabled=zoom>=maxZoom();zoomOut.disabled=zoom<=1
        next.disabled=previous.disabled=!getProject()
    }
    function scaleAt(value:number, x?:number, fraction?:number) {
        const p=getProject(), view=width()
        if (x===undefined) {
            const cursor=p ? p.tempoMap.ppqnToSeconds(timelinePosition(p))/Math.max(.01,getExtent())*view*zoom-arrangement.scrollLeft : view/2
            x=cursor>=0 && cursor<=view ? cursor : view/2
        }
        const selected=fraction ?? (x+arrangement.scrollLeft)/(view*zoom)
        zoom=clamp(value,1,maxZoom())
        draw()
        arrangement.scrollLeft=selected*view*zoom-x
    }
    function seekAt(x:number) {
        const p=getProject();if (!p) return
        const tempo=p.tempoMap, length=getExtent(), raw=tempo.secondsToPPQN(clamp(rawFraction(x),0,1)*length)
        const grid=timeSettings.display==='time' ? .01 : frameToSeconds(1,getFrameRate(timeSettings.fps))
        seekTimeline(p,clamp(snapTimePosition(tempo,raw,grid,'round'),0,Math.round(tempo.secondsToPPQN(length))));updatePosition()
    }
    function nudge(delta:number) {
        const p=getProject();if (!p) return
        const tempo=p.tempoMap, frame=frameToSeconds(1,getFrameRate(timeSettings.fps))
        const position=timelinePosition(p), i=timeGridIndex(tempo,position,frame,delta>0?'floor':'ceil')+delta
        const target=clamp(timeGridPosition(tempo,i,frame),0,Math.round(tempo.secondsToPPQN(getExtent())))
        seekTimeline(p,target);updatePosition()
        const x=tempo.ppqnToSeconds(target)/Math.max(.01,getExtent())*zoom*width()
        if (x<arrangement.scrollLeft || x>arrangement.scrollLeft+width()) arrangement.scrollLeft=x-width()/2
    }
    const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y)
    function down(e:PointerEvent){
        if(e.button===1 && e.pointerType==='mouse' && getProject()){
            e.preventDefault()
            mousePan={id:e.pointerId,x:e.clientX,left:arrangement.scrollLeft}
            arrangement.setPointerCapture(e.pointerId)
            arrangement.style.cursor='grabbing'
            return
        }
        if(e.button!==0 || !getProject() || !(e.target instanceof Element) || points.size>=2) return
        if(e.target.closest('.ft-lite-axis-label,.ft-lite-cue-label'))return
        const p:Point={id:e.pointerId,x:e.clientX,y:e.clientY,downX:e.clientX,downY:e.clientY,ruler:ruler.contains(e.target),button:!!e.target.closest('button')}
        points.set(p.id,p)
        if(points.size===2){
            const [a,b]=[...points.values()]
            laneGesture?.cancel(); mode='pinch'; initialSpan=Math.max(8,distance(a,b)); initialZoom=zoom; anchor=rawFraction((a.x+b.x)/2)
            for(const point of [a,b]) arrangement.setPointerCapture(point.id)
        }else{
            mode='idle';initialScroll=arrangement.scrollLeft
            if (laneGesture?.begin(e)) {mode='lane'; arrangement.setPointerCapture(p.id); return}
            if(!p.button) arrangement.setPointerCapture(p.id)
            if(e.pointerType==='mouse' && !p.button) {mode='scrub';seekAt(e.clientX)}
        }
    }
    function move(e:PointerEvent) {
        if(mousePan?.id===e.pointerId){arrangement.scrollLeft=mousePan.left+mousePan.x-e.clientX;return}
        const p=points.get(e.pointerId);if(!p) return
        p.x=e.clientX;p.y=e.clientY
        if(mode==='lane'){laneGesture?.move(e);return}
        if(mode==='pinch' && points.size===2){
            const [a,b]=[...points.values()]
            scaleAt(initialZoom*distance(a,b)/initialSpan,local((a.x+b.x)/2),anchor);return
        }
        if(mode==='idle' && Math.abs(p.x-p.downX)>6 && Math.abs(p.x-p.downX)>=Math.abs(p.y-p.downY)){
            if(p.ruler || (!p.button && zoom===1)) mode='scrub'
            else if(zoom>1) mode='pan'
            else return
            arrangement.setPointerCapture(p.id)
        }
        if(mode==='scrub')seekAt(p.x)
        if(mode==='pan')arrangement.scrollLeft=initialScroll+p.downX-p.x
    }
    function release(e:PointerEvent) {
        // Touch starts with implicit capture on the tapped clip. Moving capture to the
        // scroller emits a bubbling loss on that clip while the gesture is still live.
        if(e.type==='lostpointercapture' && e.target!==arrangement) return
        if(mousePan?.id===e.pointerId){mousePan=undefined;arrangement.style.removeProperty('cursor');return}
        const p=points.get(e.pointerId);if(!p) return
        if(mode==='lane'){
            if(e.type==='pointerup')laneGesture?.end(e)
            else laneGesture?.cancel()
        }
        if(e.type==='pointerup' && mode==='idle' && !p.button && Math.hypot(e.clientX-p.downX,e.clientY-p.downY)<7)seekAt(e.clientX)
        if(mode!=='idle')blockClickUntil=performance.now()+180
        points.delete(e.pointerId);mode=points.size?'finished':'idle'
    }
    function wheel(e:WheelEvent) {
        if (!getProject()) return
        if (!e.ctrlKey && !e.metaKey) {
            // Trackpads pan natively. A mouse with only a vertical wheel pans using Shift.
            if(e.shiftKey && !e.deltaX && e.deltaY && zoom>1) {
                e.preventDefault()
                arrangement.scrollLeft+=e.deltaY*([1,16,width()][e.deltaMode] ?? 1)
            }
            return
        }
        e.preventDefault()
        if(!safariPinch && mode!=='lane')scaleAt(zoom*Math.exp(-pinchZoomLogDelta(e.deltaY,e.deltaMode)),local(e.clientX))
    }
    type SafariGesture = Event & {scale?:number; clientX?:number}
    function gestureStart(e:SafariGesture) {
        if(!getProject() || mode==='lane')return
        e.preventDefault()
        const x=typeof e.clientX==='number'?clamp(local(e.clientX),0,width()):width()/2
        safariPinch={scale:zoom/(e.scale && e.scale>0?e.scale:1),fraction:(x+arrangement.scrollLeft)/(width()*zoom),x}
    }
    function gestureChange(e:SafariGesture) {
        if(!safariPinch)return
        e.preventDefault()
        if(e.scale && Number.isFinite(e.scale) && e.scale>0) {
            const x=typeof e.clientX==='number'?clamp(local(e.clientX),0,width()):safariPinch.x
            scaleAt(safariPinch.scale*e.scale,x,safariPinch.fraction)
        }
    }
    function gestureEnd(e:Event) {if(safariPinch){e.preventDefault();safariPinch=undefined}}
    function click(e:MouseEvent){if(performance.now()<blockClickUntil){e.stopImmediatePropagation();e.preventDefault()}}
    const controller=new AbortController(), options={signal:controller.signal}
    arrangement.addEventListener('pointerdown',down,options);arrangement.addEventListener('pointermove',move,options)
    for(const name of ['pointerup','pointercancel','lostpointercapture'] as const)arrangement.addEventListener(name,release,options)
    arrangement.addEventListener('wheel',wheel,{...options,passive:false})
    arrangement.addEventListener('scroll',drawTicks,{...options,passive:true})
    const resize=new ResizeObserver(()=>{if(arrangement.clientWidth)draw()})
    resize.observe(arrangement)
    arrangement.addEventListener('gesturestart',gestureStart,{...options,passive:false})
    arrangement.addEventListener('gesturechange',gestureChange,{...options,passive:false})
    arrangement.addEventListener('gestureend',gestureEnd,{...options,passive:false})
    window.addEventListener('blur',()=>{safariPinch=undefined;mousePan=undefined;arrangement.style.removeProperty('cursor')},options)
    arrangement.addEventListener('click',click,{...options,capture:true})
    // A finger on a clip can scroll the page. Keep the ruler available for reserved precision gestures.
    ruler.style.touchAction='none';arrangement.style.overflowX='auto'
    const unwatch=watchStudioLanguage(labels);labels()
    return {controls,scale(factor:number){scaleAt(zoom*factor)},refresh(){
        if(lastProject!==getProject()){lastProject=getProject();zoom=1;arrangement.scrollLeft=0;points.clear();mode='idle';safariPinch=undefined;mousePan=undefined}
        draw()
    },dispose(){laneGesture?.cancel();resize.disconnect();controller.abort();unwatch();controls.remove()}}
}
