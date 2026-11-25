type Point = {x:number; y:number}
type Bounds = {width:number; height:number}
type PinchEvent = Event & {scale:number; clientX?:number; clientY?:number}

/** Keep node and wire geometry in graph pixels; transform the entire drawing once. */
export function routingViewport(scroll: HTMLElement, frame: HTMLElement, world: HTMLElement, bounds: () => Bounds,
                                display: HTMLButtonElement) {
    let scale = 1
    let gestureScale: number | undefined
    const size = () => {
        const {width, height} = bounds()
        const w = Math.max(scroll.clientWidth / scale, width), h = Math.max(scroll.clientHeight / scale, height)
        world.style.width = w + 'px'
        world.style.height = h + 'px'
        world.style.transform = 'scale(' + scale + ')'
        frame.style.width = Math.ceil(w * scale) + 'px'
        frame.style.height = Math.ceil(h * scale) + 'px'
        display.textContent = Number((scale * 100).toFixed(scale < .1 ? 1 : 0)) + '%'
    }
    const zoom = (value: number, anchor?: Point, minimum = Math.min(scale, .12)) => {
        const rect = scroll.getBoundingClientRect()
        const x = anchor ? anchor.x - rect.left : scroll.clientWidth / 2
        const y = anchor ? anchor.y - rect.top : scroll.clientHeight / 2
        const graphX = (scroll.scrollLeft + x) / scale, graphY = (scroll.scrollTop + y) / scale
        scale = Math.max(minimum, Math.min(3, value))
        size()
        scroll.scrollLeft = graphX * scale - x
        scroll.scrollTop = graphY * scale - y
    }
    const fit = () => {
        const {width,height} = bounds()
        if (scroll.clientWidth < 4 || scroll.clientHeight < 4) return
        zoom(Math.min(1, (scroll.clientWidth - 3) / Math.max(1,width), (scroll.clientHeight - 3) / Math.max(1,height)), undefined, .0001)
        scroll.scrollTo(0,0)
    }
    const wheel = (e: WheelEvent) => {
        if (e.shiftKey || !e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
        e.preventDefault()
        if (gestureScale !== undefined) return
        const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroll.clientHeight : 1)
        zoom(scale * Math.exp(-Math.max(-300,Math.min(300,delta)) * (e.ctrlKey ? .01 : .0025)), {x:e.clientX,y:e.clientY})
    }
    const begin = (e: Event) => {e.preventDefault(); gestureScale = scale}
    const change = (e: Event) => {
        e.preventDefault()
        const event = e as PinchEvent
        if (gestureScale === undefined || !(event.scale > 0)) return
        const anchor = typeof event.clientX === 'number' && typeof event.clientY === 'number'
            ? {x:event.clientX, y:event.clientY} : undefined
        zoom(gestureScale * event.scale, anchor)
    }
    const end = (e: Event) => {e.preventDefault(); gestureScale = undefined}
    scroll.addEventListener('wheel',wheel,{passive:false})
    scroll.addEventListener('gesturestart',begin,{passive:false})
    scroll.addEventListener('gesturechange',change,{passive:false})
    scroll.addEventListener('gestureend',end,{passive:false})
    const resize = new ResizeObserver(size)
    resize.observe(scroll)
    return {size, zoom, fit, get scale() {return scale}, dispose() {
        resize.disconnect()
        scroll.removeEventListener('wheel',wheel)
        scroll.removeEventListener('gesturestart',begin)
        scroll.removeEventListener('gesturechange',change)
        scroll.removeEventListener('gestureend',end)
    }}
}
