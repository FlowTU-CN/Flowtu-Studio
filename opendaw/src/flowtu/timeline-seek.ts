import type {Project} from '@opendaw/studio-core'

interface PendingSeek {target: number; superseded: Set<number>}
interface SeekState {pending?: PendingSeek}
const states = new WeakMap<Project, SeekState>()

/** A stopped locate is available to editing commands before the next audio worklet report. */
export function timelinePosition(project: Project): number {
    return states.get(project)?.pending?.target ?? project.engine.position.getValue()
}

export function seekTimeline(project: Project, pulse: number): void {
    const {engine} = project
    let state = states.get(project)
    if (!state) {
        const shared: SeekState = {}
        states.set(project, shared)
        state = shared
        project.own(engine.isPlaying.subscribe(() => {shared.pending = undefined}))
        project.own(engine.position.subscribe(owner => {
            const pending = shared.pending
            if (!pending) return
            const reported = owner.getValue()
            // Ignore reports for older seeks still in flight. A different engine-originated
            // position (for example a transport reset) also ends the pending seek.
            if (reported === pending.target || !pending.superseded.has(reported)) shared.pending = undefined
        }))
    }
    if (!engine.isPlaying.getValue()) {
        if (state.pending) {
            state.pending.superseded.add(state.pending.target)
            state.pending.target = pulse
        } else if (pulse !== engine.position.getValue()) {
            state.pending = {target: pulse, superseded: new Set()}
        }
    }
    engine.setPosition(pulse)
}
