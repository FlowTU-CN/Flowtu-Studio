import {chooseFileDestination, saveCancelled} from './file-destination'
import {tr} from './studio-language'
import {type Project} from '@opendaw/studio-core'
import {formatTimelineTime, getFrameRate} from './time-format'
import {timeSettings} from './time-settings'
import {exportArea, exportTracks, type ExportMode, type ExportArea} from './work-area-render'
import {getWorkArea} from './work-area'
import type {StudioService} from '../service/StudioService'
import './video-import.css'

export function workAreaLabel(project: Project, area: ExportArea) {
    const clock = (tick: number) => formatTimelineTime(project.tempoMap.ppqnToSeconds(tick),
        timeSettings.display, getFrameRate(timeSettings.fps))
    return tr('Work area') + '   ' + clock(area.start) + '  →  ' + clock(area.end)
}

export function showWavExport(service: StudioService, initial: ExportMode = 'mix'): Promise<void> {
    if (!service.hasProfile) return Promise.reject(new Error('Open a project before exporting.'))
    const project = service.project
    const area = getWorkArea(project)
    const count = exportTracks(project).length
    const title = service.profile.meta.name
    const dialog = document.createElement('dialog')
    dialog.className = 'flowtu-video-import ft-media-import'
    dialog.setAttribute('aria-label', 'Export WAV')
    dialog.innerHTML = `<form><h2>Export WAV</h2><p class="video-import-name"></p>
        <fieldset><legend>Output</legend><label><input name="mode" type="radio" value="mix">Stereo mix</label>
        <label><input name="mode" type="radio" value="stems"><span>All tracks (.zip)<small class="track-count"></small></span></label></fieldset>
        <fieldset><legend>Processing</legend><label><input name="fx" type="radio" value="wet" checked><span>With effects<small>Include inserts, sends and master effects.</small></span></label>
        <label><input name="fx" type="radio" value="dry"><span>Dry<small>Keep instruments, clip edits, volume and pan.</small></span></label></fieldset>
        <p role="status" class="video-import-hint"></p>
        <footer><button type="button">Cancel</button><button type="submit" class="video-import-confirm">Export</button></footer></form>`
    dialog.querySelector('.video-import-name')!.textContent = workAreaLabel(project, area)
    dialog.querySelector('.track-count')!.textContent = count + ' aligned stereo WAV files'
    const status = dialog.querySelector<HTMLElement>('[role=status]')!
    const submit = dialog.querySelector<HTMLButtonElement>('[type=submit]')!
    const stems = dialog.querySelector<HTMLInputElement>('[value=stems]')!
    stems.disabled = !count
    dialog.querySelector<HTMLInputElement>(initial === 'stems' && count ? '[value=stems]' : '[value=mix]')!.checked = true
    submit.disabled = area.end <= area.start
    status.textContent = submit.disabled ? 'Select a work area on the timeline first.' : '48 kHz · 32-bit float · stereo'
    const abort = new AbortController()
    const form = dialog.querySelector('form')!
    let rendering = false
    const cancel = () => {
        abort.abort()
        if (rendering) status.textContent = 'Cancelling…'
        else dialog.close()
    }
    dialog.oncancel = event => {event.preventDefault(); cancel()}
    dialog.querySelector<HTMLButtonElement>('[type=button]')!.onclick = cancel
    return new Promise(resolve => {
        dialog.onclose = () => {dialog.remove(); resolve()}
        form.onsubmit = async event => {
            event.preventDefault()
            if (rendering) return
            if (!service.hasProfile || service.project !== project) {dialog.close(); return}
            if (service.engine.isRecording.getValue()) {status.textContent = 'Finish recording before exporting.'; return}
            const data = new FormData(form)
            const mode = data.get('mode') === 'stems' ? 'stems' : 'mix'
            const wet = data.get('fx') === 'wet'
            rendering = true
            submit.disabled = true
            form.querySelectorAll('fieldset').forEach(field => {field.disabled = true})
            const name = title + (wet ? ' - With FX' : ' - Dry') + (mode === 'mix' ? '.wav' : ' - Stems.zip')
            try {
                const dest = await chooseFileDestination(name)
                if (!dest || abort.signal.aborted || !service.hasProfile || service.project !== project) {dialog.close();return}
                service.engine.stop()
                status.textContent = 'Preparing audio…'
                const blob = await exportArea(project, area, mode, wet, abort.signal, fraction => {
                    if (!abort.signal.aborted) status.textContent = 'Rendering ' + Math.round(fraction * 100) + '%'
                })
                if (!abort.signal.aborted) await dest.write(blob)
                dialog.close()
            } catch (error) {
                if (abort.signal.aborted || saveCancelled(error)) {dialog.close(); return}
                console.error(error)
                status.textContent = 'Export failed. ' + (error instanceof Error ? error.message : String(error))
                rendering = false
                submit.disabled = false
                form.querySelectorAll('fieldset').forEach(field => {field.disabled = false})
            }
        }
        document.body.append(dialog)
        dialog.showModal()
        submit.focus()
    })
}
