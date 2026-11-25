import {type AudioUnitBoxAdapter, InstrumentFactories, TrackType, type Soundfont} from "@opendaw/studio-adapters"
import {SoundfontStorage, type PresetEntry} from "@opendaw/studio-core"
import {TubularDeviceBox} from "@opendaw/studio-boxes"
import {Terminator} from "@opendaw/lib-std"
import type {StudioService} from "@/service/StudioService"
import {TubularCartridges, type TubularCartridge} from "@/ui/devices/instruments/TubularDeviceEditor/TubularCartridges"
import {loadUprightPiano, uprightPiano} from "./upright-piano"
import {tones, type Tone} from "./commands"
import {setUnitDx7Voice, setUnitSoundfont, setUnitTone} from "./track-sound"
import {midiTrackName, setMidiTrackName} from "./track-name"
import {tr} from "./studio-language"
import "./track-sound.css"

type Choice = {id: string, name: string, group: string, keywords?: string, apply: () => void | Promise<void>}

const aliases: Record<Tone, string> = {
    keys: "电钢琴 钢琴 electric piano epiano rhodes", bass: "贝斯 贝司 低音",
    pad: "氛围 垫底 铺底 音垫", pluck: "拨弦 弹拨", lead: "主音 领奏", bell: "钟声 铃 铃铛"
}

/** Opens against a specific project and audio unit, even if focus changes while a library loads. */
export function chooseTrackSound(service: StudioService, unit: AudioUnitBoxAdapter) {
    const project = service.project
    const alive = () => service.hasProfile && service.project === project && unit.box.isAttached()
        && !project.audioUnitFreeze.isFrozen(unit) && unit.input.adapter().unwrapOrNull()?.accepts === "midi"
    if (!alive()) return
    const dialog = document.createElement("dialog")
    dialog.className = "ft-track-sound"
    dialog.setAttribute("aria-label", tr("Choose instrument sound"))
    dialog.innerHTML = '<form><header><h3></h3><button type="button" data-close>×</button></header><input type="search"><select size="12"></select><output role="status"></output><footer><button type="button" data-import></button><button type="submit"></button></footer></form>'
    const form = dialog.querySelector("form")!, search = form.querySelector("input")!, list = form.querySelector("select")!
    const apply = form.querySelector<HTMLButtonElement>('[type=submit]')!, close = form.querySelector<HTMLButtonElement>('[data-close]')!
    const browse = form.querySelector<HTMLButtonElement>('[data-import]')!, status = form.querySelector("output")!
    form.querySelector("h3")!.textContent = tr("Choose instrument sound") + " · " + (midiTrackName(unit.box) ?? unit.label)
    close.title = tr("Close"); close.setAttribute("aria-label", close.title)
    search.placeholder = tr("Search sounds or banks"); search.setAttribute("aria-label", search.placeholder)
    list.setAttribute("aria-label", tr("Instrument sounds"))
    browse.textContent = tr("Import SoundFont…")
    apply.textContent = tr("Apply sound")
    let banks: ReadonlyArray<TubularCartridge> = [], soundfonts: ReadonlyArray<Soundfont> = [], bankError = "", busy = false
    const subscriptions = new Terminator()
    let choices = new Map<string, Choice>()
    // In older projects a renamed track shared its device label. Carry an unrecognized
    // label forward as the track name when the musician changes its sound for the first time.
    const legacyName = () => {
        if (midiTrackName(unit.box)) return
        const name = unit.label.trim(), input = unit.input.adapter().unwrapOrNull()
        if (!input || !name || /^\d+\s*[·•]\s*MIDI\s*\/\s*SYNTH$/i.test(name)) return
        const device = InstrumentFactories.keyOfBox(input.box)
        if (device && name.replace(/\s+\d+$/, "") === InstrumentFactories.Named[device].defaultName) return
        if (Object.values(tones).some(tone => tone.label === name) || name === uprightPiano.name
            || service.presets.presets().some(preset => preset.name === name) || soundfonts.some(font => font.name === name)
            || banks.some(bank => bank.voices.some(voice => voice.name === name))) return
        if (input.box instanceof TubularDeviceBox && input.box.voiceLoad.getValue() > 0 && !banks.length) return
        return name
    }
    const edit = (change: () => void) => {
        const previous = legacyName()
        project.editing.modify(() => {
            change()
            if (previous) setMidiTrackName(unit.box, previous)
        }, true)
    }
    const choosePreset = async (preset: PresetEntry) => {
        const input = unit.input.adapter().unwrapOrNull()
        if (input?.type !== "instrument") return
        const previous = legacyName()
        dialog.close()
        await service.presets.applyPresetTo(input, preset, () => {
            if (previous && !midiTrackName(unit.box)) setMidiTrackName(unit.box, previous)
        })
    }
    const render = () => {
        if (!dialog.open) return
        const query = search.value.trim().toLocaleLowerCase()
        const previous = list.value, groups = new Map<string, HTMLOptGroupElement>()
        const fragment = document.createDocumentFragment()
        choices = new Map()
        const add = (choice: Choice) => {
            if (!(choice.name + " " + choice.group + " " + (choice.keywords ?? "")).toLocaleLowerCase().includes(query)) return
            let group = groups.get(choice.group)
            if (!group) {
                group = document.createElement("optgroup"); group.label = choice.group
                groups.set(choice.group, group); fragment.append(group)
            }
            group.append(new Option(choice.name, choice.id))
            choices.set(choice.id, choice)
        }
        add({id: uprightPiano.uuid, name: tr("Upright Piano"), group: tr("Sampled instruments"),
            keywords: "钢琴 原声钢琴 立式钢琴 acoustic upright piano KW", apply: async () => {
                status.textContent = tr("Loading piano…")
                const font = await loadUprightPiano(service)
                if (alive() && dialog.open) edit(() => setUnitSoundfont(project, unit.box, font))
            }})
        for (const [id, tone] of Object.entries(tones)) {
            add({id, name: tr(tone.label), keywords: tone.label + " " + aliases[id as Tone], group: tr("Studio sounds"), apply: () => edit(() => setUnitTone(project, unit.box, id as Tone))})
        }
        for (const bank of banks) bank.voices.forEach((voice, index) =>
            add({id: bank.file + "#" + index, name: voice.name, group: "DX7 · " + bank.name,
                apply: () => edit(() => setUnitDx7Voice(project, unit.box, voice))}))
        for (const preset of service.presets.presets()) {
            if (preset.category !== "instrument" || InstrumentFactories.Named[preset.device]?.trackType !== TrackType.Notes) continue
            add({id: preset.source + "-" + preset.uuid, name: preset.name, group: tr("Preset") + " · " + preset.device,
                apply: () => choosePreset(preset)})
        }
        for (const font of soundfonts) {
            if (font.uuid === uprightPiano.uuid) continue
            add({id: "sf2-" + font.uuid, name: font.name, group: "SoundFont", apply: () => edit(() => setUnitSoundfont(project, unit.box, font))})
        }
        list.replaceChildren(fragment)
        list.value = choices.has(previous) ? previous : [...choices.values()].find(item => item.name === tr(unit.label) || (item.id === uprightPiano.uuid && unit.label === uprightPiano.name))?.id ?? list.options[0]?.value ?? ""
        apply.disabled = busy || !list.value
        status.textContent = bankError || tr("{0} sounds", choices.size)
    }
    const run = async (action: () => Promise<void> | void) => {
        if (busy || !dialog.open) return
        if (!alive()) {dialog.close(); return}
        busy = true; apply.disabled = true; browse.disabled = true
        try {
            await action()
            if (dialog.open) dialog.close()
        } catch (error) {
            status.textContent = String(error instanceof Error ? error.message : error)
        } finally {
            busy = false; apply.disabled = !list.value; browse.disabled = false
        }
    }
    close.onclick = () => dialog.close()
    dialog.onclose = () => {subscriptions.terminate(); dialog.remove()}
    search.oninput = render
    form.onsubmit = event => {
        event.preventDefault()
        const selected = choices.get(list.value)
        if (selected) void run(selected.apply)
    }
    list.ondblclick = () => form.requestSubmit()
    search.onkeydown = event => {if (event.key === "ArrowDown") {event.preventDefault(); list.focus()}}
    list.onkeydown = event => {if (event.key === "Enter") {event.preventDefault(); form.requestSubmit()}}
    browse.onclick = () => {
        // The native importer can open its own confirmation / progress dialogs.
        // Release this modal first so its top layer cannot cover those controls.
        dialog.close()
        void service.soundfontService.browse(false).then(([font]) => {
            if (font && alive()) edit(() => setUnitSoundfont(project, unit.box, font))
        }).catch(error => console.warn("SoundFont import failed", error))
    }
    document.body.append(dialog); dialog.showModal(); search.focus()
    render()
    subscriptions.ownAll(service.presets.userIndex.subscribe(render), service.presets.cloudIndex.subscribe(render))
    void TubularCartridges.get().load().then(value => {banks = value; render()}, () => {
        bankError = tr("Could not load the DX7 banks."); render()
    })
    void SoundfontStorage.get().list().then(value => {soundfonts = value; render()}, error => console.warn("SoundFont storage unavailable", error))
}
