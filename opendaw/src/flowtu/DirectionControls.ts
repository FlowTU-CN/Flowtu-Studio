import {boundPad, directionText, neutralDirection, readDirection, styleNames, type ScoreDirection, type ScoreStyle} from './scoring-direction'
import type {DirectionPad} from './direction-rag'
import './direction-controls.css'
import {installControlReset, resetHint} from '@/ui/hooks/control-reset'

const pads = [
    {pad: 'melodyArrangement', title: 'Melody & arrangement', x: 'melody', y: 'arrangement', xName: 'Melody', yName: 'Voicing',
        lowX: 'Simple', highX: 'Intricate', lowY: 'Spare', highY: 'Layered'},
    {pad: 'emotionStyle', title: 'Emotion & style', x: 'emotion', y: 'character', xName: 'Expression', yName: 'Character',
        lowX: 'Restrained', highX: 'Expressive', lowY: 'Neutral', highY: 'Distinct'}
] as const

export function createDirectionControls(onChange: (direction?: ScoreDirection, pad?: DirectionPad) => void) {
    const element = document.createElement('div')
    element.className = 'ft-direction-controls'
    element.innerHTML = `<label>Style<select aria-label="Music style"><option value="prompt">From prompt</option></select></label>
        <div class="ft-direction-pads"></div><output class="ft-direction-brief" aria-label="Prompt direction" hidden></output>`
    const style = element.querySelector('select')!
    for (const {value, label} of styleNames) style.add(new Option(label, value))
    const brief = element.querySelector('output')!, container = element.querySelector('.ft-direction-pads')!
    let value = {...neutralDirection}
    const commit = (pad?: DirectionPad) => onChange(readDirection(value), pad)
    const wheels = pads.map(spec => {
        const details = document.createElement('details')
        details.open = true
        details.dataset.pad = spec.x
        details.innerHTML = `<summary>${spec.title}</summary>
            <div class="ft-direction-body"><button type="button" class="ft-direction-wheel" aria-label="${spec.title} direction" title="Drag to adjust · Arrow keys to step · Home or ${resetHint}">
            <i></i></button>
            <div class="ft-direction-values"><label><span data-i18n>${spec.xName}</span><small><span data-i18n>${spec.lowX}</span> → <span data-i18n>${spec.highX}</span></small><input aria-label="${spec.xName} direction" type="number" min="-100" max="100" step="1"></label>
            <label><span data-i18n>${spec.yName}</span><small><span data-i18n>${spec.lowY}</span> ↑ <span data-i18n>${spec.highY}</span></small><input aria-label="${spec.yName} direction" type="number" min="-100" max="100" step="1"></label></div></div>`
        const wheel = details.querySelector('button')!, inputs = [...details.querySelectorAll('input')], marker = wheel.querySelector('i')!
        const draw = () => {
            const x = value[spec.x], y = value[spec.y]
            marker.style.left = (50 + x * .41) + '%'
            marker.style.top = (50 - y * .41) + '%'
            inputs[0].value = String(x)
            inputs[1].value = String(y)
        }
        const set = (x: number, y: number) => {
            const [nextX, nextY] = boundPad(x, y)
            value = {...value, [spec.x]: nextX, [spec.y]: nextY}
            draw(); updateBrief()
        }
        inputs.forEach((input, axis) => input.onchange = () => {
            if (!Number.isFinite(input.valueAsNumber)) {draw(); return}
            set(axis === 0 ? input.valueAsNumber : value[spec.x], axis === 1 ? input.valueAsNumber : value[spec.y])
            commit(spec.pad)
        })
        let drag: {id: number; before: ScoreDirection} | undefined
        const dragTo = (e: PointerEvent) => {
            const rect = wheel.getBoundingClientRect(), radius = .41 * rect.width
            if (radius > 0) set((e.clientX - rect.left - rect.width / 2) * 100 / radius, (rect.top + rect.height / 2 - e.clientY) * 100 / radius)
        }
        installControlReset(wheel, () => {set(0, 0); commit(spec.pad)})
        wheel.onpointerdown = e => {
            if (e.button !== 0 || drag) return
            e.preventDefault(); wheel.focus({preventScroll: true})
            drag = {id: e.pointerId, before: value}
            wheel.setPointerCapture(e.pointerId); dragTo(e)
        }
        wheel.onpointermove = e => {if (drag?.id === e.pointerId) dragTo(e)}
        wheel.onpointerup = e => {
            if (drag?.id !== e.pointerId) return
            dragTo(e); drag = undefined; wheel.releasePointerCapture(e.pointerId); commit(spec.pad)
        }
        wheel.onlostpointercapture = () => {
            if (drag) {value = drag.before; drag = undefined; draw(); updateBrief()}
        }
        wheel.onkeydown = e => {
            const step = e.shiftKey ? 10 : 1
            const delta = {ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0]}[e.key]
            if (!delta && e.key !== 'Home') return
            e.preventDefault(); e.stopPropagation()
            set(delta ? value[spec.x] + delta[0] : 0, delta ? value[spec.y] + delta[1] : 0)
            commit(spec.pad)
        }
        container.append(details)
        return {draw, cancel() {if (drag) {const {id} = drag; drag = undefined; if (wheel.hasPointerCapture(id)) wheel.releasePointerCapture(id)}}}
    })
    function updateBrief() {
        const text = directionText(value)
        brief.hidden = !text
        brief.textContent = text
    }
    function setValue(direction?: ScoreDirection) {
        value = {...(direction ?? neutralDirection)}
        for (const wheel of wheels) {wheel.cancel(); wheel.draw()}
        style.value = value.style; updateBrief()
    }
    style.onchange = () => {value = {...value, style: style.value as ScoreStyle}; updateBrief(); commit()}
    setValue()
    return {element, setValue}
}
