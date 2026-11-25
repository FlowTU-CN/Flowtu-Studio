import type {Project, TimelineRange} from '@opendaw/studio-core'
import {keyProfile} from './tool-shortcuts'
import {seekTimeline} from './timeline-seek'

export function navigateWithProfile(event: KeyboardEvent, project: Project, range: Pick<TimelineRange,'scaleBy'|'center'>) {
    if (event.altKey || event.shiftKey || event.ctrlKey || event.metaKey || event.isComposing) return false
    const profile = keyProfile()
    const key = event.key.toLowerCase()
    let zoom = 0
    if (profile === 'protools') zoom = key === 'r' ? 1 : key === 't' ? -1 : 0
    if (profile === 'cubase') zoom = key === 'g' ? 1 : key === 'h' ? -1 : 0
    if (zoom) {
        range.scaleBy(.2 * zoom, range.center)
    } else if (profile === 'cubase' && ['Numpad1','Numpad2','NumpadDivide'].includes(event.code)) {
        const loop = project.timelineBox.loopArea
        if (event.code === 'NumpadDivide') {
            if (!event.repeat) project.editing.modify(() => loop.enabled.setValue(!loop.enabled.getValue()))
        } else {
            seekTimeline(project, (event.code === 'Numpad1' ? loop.from : loop.to).getValue())
        }
    } else return false
    event.preventDefault()
    event.stopImmediatePropagation()
    return true
}
