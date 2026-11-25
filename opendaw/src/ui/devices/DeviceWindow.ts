import {localizeStudioDocument} from '@/flowtu/studio-language'
import {appendChildren} from '@opendaw/lib-jsx'
import {UUID} from '@opendaw/lib-std'
import type {DeviceBoxAdapter} from '@opendaw/studio-adapters'
import type {StudioService} from '@/service/StudioService'
import {Surface} from '@/ui/surface/Surface'
import {DeviceEditorFactory} from './DeviceEditorFactory'
import {linkStudioSkin} from '@/flowtu/studio-skin'

const opening = new Set<string>()

/** Each window mounts controls on the existing adapter, sharing playback, automation and undo. */
export async function openDeviceWindow(service: StudioService, adapter: DeviceBoxAdapter) {
    const {project} = service
    const id = 'device-' + UUID.toString(adapter.uuid)
    const existing = Surface.getById(id).unwrapOrNull()
    if (existing && !existing.owner.closed) {existing.owner.focus(); return}
    if (opening.has(id) || !adapter.box.isAttached()) return
    const parent = Surface.get().root()
    opening.add(id)
    try {
        const title = adapter.labelField.getValue()
        const surface = (await parent.new(780, 370, id, title)).unwrapOrNull()
        if (!surface) {parent.toast('Allow pop-ups to open the device window.'); return}
        if (!service.hasProfile || service.project !== project || !adapter.box.isAttached()) {surface.close(); return}
        try {
            const owner = surface.owner.document
            surface.own({terminate: linkStudioSkin(owner)})
            surface.own({terminate: localizeStudioDocument(owner)})
            const frame = document.createElement('main')
            frame.className = 'ft-device-window'
            surface.ground.appendChild(frame)
            const editor = surface.spawn()
            let host = adapter.deviceHost()
            const refreshFrozen = () => {frame.inert = project.audioUnitFreeze.isFrozen(host.audioUnitBoxAdapter())}
            const render = () => {
                editor.terminate()
                frame.replaceChildren()
                const create = adapter.type === 'audio-effect' ? DeviceEditorFactory.toAudioEffectDeviceEditor
                    : adapter.type === 'midi-effect' ? DeviceEditorFactory.toMidiEffectDeviceEditor
                    : DeviceEditorFactory.toInstrumentDeviceEditor
                appendChildren(frame, create(service, editor, adapter.box, host))
                refreshFrozen()
            }
            render()
            surface.ownAll(
                project.audioUnitFreeze.subscribe(refreshFrozen),
                adapter.minimizedField.subscribe(render),
                adapter.labelField.subscribe(field => {owner.title = field.getValue()}),
                service.projectProfileService.subscribe(() => {if (!service.hasProfile || service.project !== project) surface.close()}),
                project.editing.subscribe(() => {
                    if (!adapter.box.isAttached()) {surface.close(); return}
                    const next = adapter.deviceHost()
                    if (host !== next) {host = next; render()}
                })
            )
        } catch (error) {surface.close(); throw error}
    } catch (error) {
        console.error('Could not open device window', error)
        parent.toast('Could not open the device window.')
    } finally {opening.delete(id)}
}
