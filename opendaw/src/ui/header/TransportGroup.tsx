import {tr} from "@/flowtu/studio-language"
import css from "./TransportGroup.sass?inline"
import {Icon} from "@/ui/components/Icon.tsx"
import {createElement} from "@opendaw/lib-jsx"
import {StudioService} from "@/service/StudioService"
import {Button} from "@/ui/components/Button.tsx"
import {DefaultObservableValue, Lifecycle, Option, Terminator} from "@opendaw/lib-std"
import {Colors, IconSymbol} from "@opendaw/studio-enums"
import {Checkbox} from "@/ui/components/Checkbox"
import {Surface} from "@/ui/surface/Surface"
import {CountIn} from "@/ui/header/CountIn"
import {Html} from "@opendaw/lib-dom"
import {ContextMenu, MenuItem, ProjectProfile} from "@opendaw/studio-core"
import {GlobalShortcuts} from "@/ui/shortcuts/GlobalShortcuts"
import {ShortcutTooltip} from "@/ui/shortcuts/ShortcutTooltip"

const className = Html.adoptStyleSheet(css, "TransportGroup")

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
}

export const TransportGroup = ({lifecycle, service}: Construct) => {
    const {engine, projectProfileService} = service
    const {preferences: {settings: {playback}}} = engine
    const loop = new DefaultObservableValue(false)
    const recordButton: HTMLElement = (
        <Button lifecycle={lifecycle}
                appearance={{
                    color: Colors.shadow,
                    activeColor: Colors.red,
                    tooltip: ShortcutTooltip.create("Start Recording", GlobalShortcuts["start-recording"].shortcut)
                }}
                onClick={event => {
                    service.runIfProject(project => {
                        if (project.isRecording()) {
                            project.stopRecording()
                        } else {
                            project.startRecording(!event.shiftKey)
                            document.querySelector<HTMLElement>("[data-scope=\"regions\"]")?.focus()
                        }
                    })
                }}><Icon symbol={IconSymbol.Record}/></Button>)
    const playButton: HTMLButtonElement = (
        <button type="button" className="play-toggle" aria-label="Play or pause" title="Play / pause · Space"
                onclick={() => engine.isPlaying.getValue() ? engine.stop() : engine.play()}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
                <path className="play" d="M6 3.8a.9.9 0 0 1 1.4-.75l9 6.2a.9.9 0 0 1 0 1.5l-9 6.2A.9.9 0 0 1 6 16.2Z"/>
                <path className="pause" d="M5 4h3.5v12H5zm6.5 0H15v12h-3.5z"/>
            </svg>
        </button>
    )
    const loopLifecycle = lifecycle.own(new Terminator())
    const countInLifecycle = lifecycle.own(new Terminator())
    const recordingObserver = () => recordButton.classList.toggle("active",
        engine.isCountingIn.getValue() || engine.isRecording.getValue())
    lifecycle.ownAll(
        engine.isPlaying.catchupAndSubscribe(owner => playButton.setAttribute("aria-pressed", String(owner.getValue()))),
        engine.isCountingIn.subscribe(recordingObserver),
        engine.isRecording.subscribe(recordingObserver),
        engine.isCountingIn.subscribe(owner => {
            if (owner.getValue()) {
                Surface.get(recordButton).body.appendChild(CountIn({lifecycle: countInLifecycle, engine}))
            } else {
                countInLifecycle.terminate()
            }
        }),
        ContextMenu.subscribe(playButton, collector => collector
            .addItems(
                MenuItem.default({
                    label: tr("Resume from last playback starting position"),
                    checked: playback.timestampEnabled
                }).setTriggerProcedure(() => playback.timestampEnabled = !playback.timestampEnabled),
                MenuItem.default({
                    label: tr("Pause playback on loop end if loop is disabled"),
                    checked: playback.pauseOnLoopDisabled
                }).setTriggerProcedure(() => playback.pauseOnLoopDisabled = !playback.pauseOnLoopDisabled)
            )),
        projectProfileService.catchupAndSubscribe((optProfile: Option<ProjectProfile>) => {
            playButton.disabled = optProfile.isEmpty()
            loopLifecycle.terminate()
            optProfile.match({
                none: () => loop.setValue(false),
                some: ({project}) => {
                    const {editing, timelineBox: {loopArea: {enabled}}} = project
                    loop.setValue(enabled.getValue())
                    loopLifecycle.ownAll(
                        loop.subscribe(owner => {
                            editing.modify(() => enabled.setValue(owner.getValue()))
                        }),
                        enabled.subscribe(owner => loop.setValue(owner.getValue()))
                    )
                }
            })
        })
    )
    return (
        <div className={className}>
            {recordButton}
            {playButton}
            <Button lifecycle={lifecycle}
                    onClick={() => {engine.stop(true)}}
                    appearance={{
                        color: Colors.shadow,
                        activeColor: Colors.bright,
                        tooltip: ShortcutTooltip.create("Stop", GlobalShortcuts["stop-playback"].shortcut)
                    }}>
                <Icon symbol={IconSymbol.Stop}/>
            </Button>
            <Checkbox lifecycle={lifecycle}
                      model={loop}
                      appearance={{
                          color: Colors.shadow,
                          activeColor: Colors.white,
                          tooltip: ShortcutTooltip.create("Loop", GlobalShortcuts["toggle-loop"].shortcut)
                      }}>
                <Icon symbol={IconSymbol.Loop}/>
            </Checkbox>
        </div>
    )
}
