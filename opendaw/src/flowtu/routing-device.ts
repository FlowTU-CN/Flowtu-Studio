import {appendChildren} from '@opendaw/lib-jsx'
import {Terminator} from '@opendaw/lib-std'
import type {AudioEffectDeviceAdapter} from '@opendaw/studio-adapters'
import type {StudioService} from '@/service/StudioService'
import {DeviceEditorFactory} from '@/ui/devices/DeviceEditorFactory'

/** Bind directly to the existing insert, exactly as the track inspector does. */
export function mountRoutingDevice(doc: Document, service: StudioService, fx: AudioEffectDeviceAdapter) {
    const frame = doc.createElement('div')
    frame.className = 'ft-routing-device'
    const host = fx.deviceHost()
    const life = new Terminator()
    const controls = life.own(new Terminator())
    const render = () => {
        controls.terminate()
        frame.replaceChildren()
        appendChildren(frame, DeviceEditorFactory.toAudioEffectDeviceEditor(service, controls, fx.box, host))
    }
    const freeze = service.project.audioUnitFreeze
    const updateFrozen = () => {frame.inert = freeze.isFrozen(host.audioUnitBoxAdapter())}
    try {
        render()
        updateFrozen()
        life.ownAll(freeze.subscribe(updateFrozen), fx.minimizedField.subscribe(render))
    } catch (error) {
        life.terminate()
        throw error
    }
    return {frame, host, dispose: () => life.terminate()}
}
