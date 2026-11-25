import type {Editing, Lifecycle} from '@opendaw/lib-std'
import type {RevampDeviceBoxAdapter} from '@opendaw/studio-adapters'
import {ColorSets, xAxis, yAxis} from './constants'

/** Visual handles edit the very same parameters as the numeric inspector, including automation. */
export function bandHandles(lifecycle: Lifecycle, editing: Editing, adapter: RevampDeviceBoxAdapter) {
    const layer = document.createElement('div')
    layer.className = 'ft-eq-handles'
    const {highPass, lowShelf, lowBell, midBell, highBell, highShelf, lowPass} = adapter.namedParameter
    const names = ['High pass', 'Low shelf', 'Low bell', 'Mid bell', 'High bell', 'High shelf', 'Low pass']
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
    const bands = [highPass, lowShelf, lowBell, midBell, highBell, highShelf, lowPass]
    bands.forEach((band, index) => {
        const point = document.createElement('button')
        const gain = 'gain' in band ? band.gain : undefined
        const q = 'q' in band ? band.q : undefined
        point.type = 'button'
        point.setAttribute('aria-label', names[index] + ' EQ band')
        point.textContent = String(index + 1)
        point.style.setProperty('--band-color', ColorSets[index].full.toString())
        layer.append(point)
        function refresh() {
            point.style.left = (100 * xAxis.unitToNorm(band.frequency.getValue())) + '%'
            point.style.top = (100 * (1 - yAxis.unitToNorm(gain?.getValue() ?? 0))) + '%'
            point.dataset.enabled = String(band.enabled.getValue())
            point.title = names[index] + ' · ' + Math.round(band.frequency.getValue()) + ' Hz' +
                (gain ? ' · ' + gain.getValue().toFixed(1) + ' dB' : '') +
                (q ? ' · Q ' + q.getValue().toFixed(2) + ' (Alt + scroll)' : '')
        }
        let drag: {id: number; x: number; y: number; hz: number; db: number} | undefined
        point.onpointerdown = event => {
            if (drag || !event.isPrimary || event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            drag = {id: event.pointerId, x: event.clientX, y: event.clientY, hz: band.frequency.getValue(), db: gain?.getValue() ?? 0}
            point.focus({preventScroll:true})
            point.setPointerCapture(event.pointerId)
        }
        point.onpointermove = event => {
            if (!drag || event.pointerId !== drag.id) return
            const {width, height} = layer.getBoundingClientRect()
            if (!width || !height) return
            const hz = xAxis.normToUnit(clamp01(xAxis.unitToNorm(drag.hz) + (event.clientX - drag.x) / width))
            const db = yAxis.normToUnit(clamp01(yAxis.unitToNorm(drag.db) - (event.clientY - drag.y) / height))
            editing.modify(() => {
                band.enabled.setValue(true)
                band.frequency.setValue(band.frequency.valueMapping.clamp(hz))
                if (gain) gain.setValue(gain.valueMapping.clamp(db))
            }, false)
        }
        const finish = () => {if (drag) {drag = undefined; editing.mark()}}
        point.onpointerup = point.onpointercancel = point.onlostpointercapture = finish
        point.onkeydown = event => {
            if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(event.key)) return
            event.preventDefault(); event.stopPropagation()
            editing.modify(() => {
                if (event.key === 'Enter' || event.key === ' ') {band.enabled.setValue(!band.enabled.getValue()); return}
                band.enabled.setValue(true)
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    const step = (event.key === 'ArrowRight' ? 1 : -1) / (event.shiftKey ? 120 : 12)
                    band.frequency.setValue(band.frequency.valueMapping.clamp(band.frequency.getValue() * 2 ** step))
                } else if (gain) {
                    const step = (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 0.1 : 1)
                    gain.setValue(gain.valueMapping.clamp(gain.getValue() + step))
                }
            })
        }
        if (q) {
            point.addEventListener('wheel', event => {
                if (!event.altKey) return
                event.preventDefault(); event.stopPropagation()
                editing.modify(() => {band.enabled.setValue(true); q.setUnitValue(clamp01(q.getUnitValue() - Math.sign(event.deltaY) * .025))})
            }, {passive:false})
            lifecycle.own(q.subscribe(refresh))
        }
        if (gain) lifecycle.own(gain.subscribe(refresh))
        lifecycle.ownAll(band.frequency.subscribe(refresh), band.enabled.subscribe(refresh), {terminate: finish})
        refresh()
    })
    return layer
}
