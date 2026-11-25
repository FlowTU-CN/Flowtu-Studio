import {deferNextFrame, Html} from "@opendaw/lib-dom"
import type {Lifecycle} from "@opendaw/lib-std"
import {MetaData} from "@opendaw/studio-adapters"
import type {Project, TimelineRange} from "@opendaw/studio-core"
import {formatTimelineTime, getFrameRate} from "@/flowtu/time-format"
import {timeSettings} from "@/flowtu/time-settings"
import "./TimelineNotes.css"
import {WheelScaling} from "./WheelScaling"

type TimelineNote = {pulse: number, text: string}
const origin = "flowtu:timeline-notes:v1"
const read = (project: Project): TimelineNote[] => {
    const stored = MetaData.read(project.rootBox, origin)
    if (!Array.isArray(stored)) {return []}
    return stored.flatMap(item => {
        if (!item || typeof item !== "object" || Array.isArray(item) ||
            typeof item.pulse !== "number" || !Number.isSafeInteger(item.pulse) || item.pulse < 0 ||
            typeof item.text !== "string") {return []}
        return [{pulse: item.pulse, text: item.text}]
    }).sort((a, b) => a.pulse - b.pulse)
}

export function editTimelineNote(project: Project, at: number, lifecycle: Lifecycle) {
    const pulse = Math.max(0, Math.round(at))
    const note = read(project).find(note => note.pulse === pulse)
    const dialog = document.createElement("dialog")
    dialog.dataset.i18n = ""
    dialog.className = "ft-note-editor"
    dialog.setAttribute("aria-label", "Timeline note")
    dialog.innerHTML = `<form><header><strong>Timeline note</strong><time></time></header>
        <textarea data-i18n aria-label="Note text" rows="4" maxlength="4096" required></textarea>
        <footer><button type="button" data-delete>Delete</button><button type="button" data-cancel>Cancel</button>
        <button type="submit">Save</button></footer></form>`
    const field = dialog.querySelector("textarea")!
    dialog.querySelector("time")!.textContent = formatTimelineTime(project.tempoMap.ppqnToSeconds(pulse), "time", getFrameRate(timeSettings.fps))
    field.value = note?.text ?? ""
    const save = (text: string) => {
        project.editing.modify(() => {
            const notes = read(project).filter(item => item.pulse !== pulse)
            if (text) {notes.push({pulse, text})}
            MetaData.store(project.rootBox, notes, origin)
        }, true)
        dialog.close()
    }
    const remove = dialog.querySelector<HTMLButtonElement>("[data-delete]")!
    remove.hidden = !note
    remove.onclick = () => save("")
    dialog.querySelector<HTMLButtonElement>("[data-cancel]")!.onclick = () => dialog.close()
    dialog.querySelector("form")!.onsubmit = event => {
        event.preventDefault()
        const value = field.value.trim()
        if (value) {save(value)} else {field.focus()}
    }
    const cleanup = lifecycle.spawn()
    cleanup.own({terminate: () => dialog.remove()})
    dialog.onclose = () => cleanup.terminate()
    document.body.append(dialog)
    dialog.showModal()
    field.focus()
}

export function createNotesLane(project: Project, range: TimelineRange, lifecycle: Lifecycle) {
    const lane = document.createElement("div")
    lane.className = "ft-timeline-notes"
    lane.setAttribute("aria-label", "Timeline notes")
    lane.title = "Double-click to add a note here"
    let notes: TimelineNote[] = []
    const {request} = lifecycle.own(deferNextFrame(() => {
        if (!lane.offsetWidth) {return}
        const items = document.createDocumentFragment()
        const groups: {left: number, entries: TimelineNote[]}[] = []
        for (const note of notes) {
            const left = range.unitToX(note.pulse)
            if (left < 0 || left >= range.width) {continue}
            const last = groups.at(-1)
            if (last && left - last.left < 35) {last.entries.push(note)}
            else {groups.push({left, entries: [note]})}
        }
        for (const [i, {left, entries}] of groups.entries()) {
            let flag: HTMLButtonElement | HTMLSelectElement
            if (entries.length === 1) {
                const [note] = entries
                const button = document.createElement("button")
                button.textContent = button.title = note.text
                button.onclick = () => editTimelineNote(project, note.pulse, lifecycle)
                flag = button
            } else {
                const choice = document.createElement("select")
                choice.setAttribute("aria-label", "Choose a nearby note")
                choice.add(new Option(`${entries.length} notes`, ""))
                choice.options[0].disabled = true
                entries.forEach(note => choice.add(new Option(note.text, String(note.pulse))))
                choice.onchange = () => {
                    editTimelineNote(project, Number(choice.value), lifecycle)
                    choice.selectedIndex = 0
                }
                flag = choice
            }
            flag.style.left = `${left}px`
            flag.style.maxWidth = `${Math.min(230, (groups[i + 1]?.left ?? range.width) - left - 1)}px`
            items.append(flag)
        }
        lane.replaceChildren(items)
    }))
    lane.ondblclick = e => {
        if (e.target === lane) {editTimelineNote(project, range.xToUnit(e.clientX - lane.getBoundingClientRect().left), lifecycle)}
    }
    lifecycle.ownAll(range.subscribe(request), Html.watchResize(lane, request), WheelScaling.install(lane, range),
        MetaData.catchupAndSubscribe(project.rootBox, origin, () => {notes = read(project); request()}))
    return lane
}
