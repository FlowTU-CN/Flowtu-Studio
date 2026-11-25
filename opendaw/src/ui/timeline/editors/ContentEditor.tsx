import {seekTimeline, timelinePosition} from '@/flowtu/timeline-seek'
import css from "./ContentEditor.sass?inline"
import {Lifecycle, Option, Terminator, ValueMapping} from "@opendaw/lib-std"
import {createElement, Frag, replaceChildren} from "@opendaw/lib-jsx"
import {StudioService} from "@/service/StudioService.ts"
import {
    AudioClipBox,
    AudioRegionBox,
    BoxVisitor,
    NoteClipBox,
    NoteRegionBox,
    ValueClipBox,
    ValueRegionBox
} from "@opendaw/studio-boxes"
import {NoteEditor} from "@/ui/timeline/editors/notes/NoteEditor.tsx"
import {
    AudioClipBoxAdapter,
    AudioRegionBoxAdapter,
    NoteClipBoxAdapter,
    NoteRegionBoxAdapter,
    ValueClipBoxAdapter,
    ValueRegionBoxAdapter
} from "@opendaw/studio-adapters"
import {Box, PointerField, Vertex} from "@opendaw/lib-box"
import {SnapSelector} from "@/ui/timeline/SnapSelector.tsx"
import {Snapping} from "@/ui/timeline/Snapping.ts"
import {MenuItem, TimelineRange} from "@opendaw/studio-core"
import {TimeAxis} from "@/ui/timeline/TimeAxis.tsx"
import {TimelineRangeSlider} from "@/ui/timeline/TimelineRangeSlider.tsx"
import {ValueEventsEditor} from "./value/ValueEventsEditor.tsx"
import {FlexSpacer} from "@/ui/components/FlexSpacer.tsx"
import {PPQN} from "@opendaw/lib-dsp"
import {AudioEditor} from "@/ui/timeline/editors/audio/AudioEditor.tsx"
import {MenuButton} from "@/ui/components/MenuButton"
import {EditorMenuCollector} from "@/ui/timeline/editors/EditorMenuCollector.ts"

import {ClipReader} from "@/ui/timeline/editors/ClipReader.ts"
import {RegionBound} from "./RegionBound"
import {
    AudioEventOwnerReader,
    EventOwnerReader,
    NoteEventOwnerReader,
    ValueEventOwnerReader
} from "@/ui/timeline/editors/EventOwnerReader.ts"
import {RegionReader} from "@/ui/timeline/editors/RegionReader.ts"
import {Colors, Pointers} from "@opendaw/studio-enums"
import {ParameterValueEditing} from "@/ui/timeline/editors/value/ParameterValueEditing.ts"
import {deferNextFrame, Html, ShortcutManager} from "@opendaw/lib-dom"
import {ContentEditorShortcuts} from "@/ui/shortcuts/ContentEditorShortcuts"
import {RegionModifyContext} from "@/ui/timeline/editors/RegionModifyContext.ts"
import {subscribeTimeSettings} from "@/flowtu/time-settings"
import {getFrameRate} from "@/flowtu/time-format"
import {installContentEditorFocus, primaryContentCanvas} from "./ContentEditorFocus"
import {PanelType} from "@/ui/workspace/PanelType"
import {GlobalShortcuts} from "@/ui/shortcuts/GlobalShortcuts"

const className = Html.adoptStyleSheet(css, "ContentEditor")

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
}

export const ContentEditor = ({lifecycle, service}: Construct) => {
    const range = new TimelineRange({padding: 12})
    range.minimum = 48
    const snapping = new Snapping(range)
    const modifyContext = lifecycle.own(new RegionModifyContext())
    const runtime = lifecycle.own(new Terminator())
    const editingSubject = service.project.userEditingManager.timeline
    const contentEditor = <div className="editor"/>
    const menu: EditorMenuCollector = {
        viewMenu: MenuItem.root(),
        editMenu: MenuItem.root()
    }
    let owner: Option<EventOwnerReader<unknown>> = Option.None
    let restoreEditorFocus = false
    let editingAudio = false
    const syncAudioSnap = (source: Snapping) => {
        snapping.index = source.index
        snapping.enabled = source.enabled
        snapping.target = source.target
    }
    const zoomToLoopDuration = () => owner.ifSome(reader =>
        range.zoomRange(reader.offset, reader.offset + reader.loopDuration + PPQN.Bar, 16))
    const attachGenericViewMenu = () => runtime.own(menu.viewMenu.attach(collector => {
        return collector.addItems(
            MenuItem.default({
                label: "Zoom to loop duration",
                selectable: editingSubject.get().nonEmpty(),
                shortcut: ContentEditorShortcuts["zoom-to-loop-duration"].shortcut.format()
            }).setTriggerProcedure(zoomToLoopDuration),
            MenuItem.default({
                label: "Close Editor",
                shortcut: GlobalShortcuts["toggle-content-editor-panel"].shortcut.format()
            }).setTriggerProcedure(() => {
                service.panelLayout.getByType(PanelType.ContentEditor).hide()
                element.ownerDocument.querySelector<HTMLElement>('[data-scope="regions"]')?.focus({preventScroll: true})
            })
        )
    }))
    lifecycle.ownAll(
        {terminate: () => {owner = Option.None}},
        snapping.registerSignatureTrackAdapter(service.project.timelineBoxAdapter.signatureTrack),
        snapping.registerTempoMap(service.project.tempoMap),
        service.timeline.snapping.catchupAndSubscribe(source => {if (editingAudio) {syncAudioSnap(source)}}),
        {terminate: subscribeTimeSettings(settings => snapping.setFrameRate(getFrameRate(settings.fps)))}
    )
    const element: HTMLElement = (
        <div className={className} tabIndex={-1} data-scope="content-editor">
            <div className="generic">
                <div className="tool">
                    <SnapSelector lifecycle={lifecycle} snapping={snapping}/>
                    <FlexSpacer/>
                    <div className="menu">
                        <MenuButton root={menu.viewMenu}
                                    appearance={{color: Colors.gray, activeColor: Colors.bright}}
                                    groupId="content-editor">
                            <span style={{padding: "0 0.5em"}}>View</span>
                        </MenuButton>
                        <MenuButton root={menu.editMenu}
                                    appearance={{color: Colors.gray, activeColor: Colors.bright}}
                                    groupId="content-editor">
                            <span style={{padding: "0 0.5em"}}>Edit</span>
                        </MenuButton>
                    </div>
                </div>
                <div className="time-axis">
                    <RegionBound lifecycle={lifecycle}
                                 service={service}
                                 range={range}
                                 snapping={snapping}
                                 modifyContext={modifyContext}/>
                    <TimeAxis lifecycle={lifecycle}
                              service={service}
                              snapping={snapping}
                              range={range}
                              mapper={{
                                  mapPlaybackCursor: (position: number): number => owner.match({
                                      none: () => position,
                                      some: reader => reader.mapPlaybackCursor(position)
                                  })
                              }}/>
                </div>
                {contentEditor}
                <div className="space"/>
                <TimelineRangeSlider lifecycle={lifecycle} range={range}/>
            </div>
        </div>
    )
    const fallback = (box: Box) => (
        <Frag>
            <div className="empty-header"/>
            <div className="label">
                {`No Region Editor for ${box.name} yet.`}&nbsp;<span
                style={{textDecoration: "underline", cursor: "pointer"}}
                onclick={() => editingSubject.clear()}>Close</span>
            </div>
        </Frag>
    )
    const editorKind = (kind: string) => {
        const wasAudio = editingAudio
        editingAudio = kind === "audio"
        element.dataset.editorKind = kind
        if (editingAudio) {syncAudioSnap(service.timeline.snapping)}
        else if (wasAudio) {snapping.index = 0; snapping.enabled = true; snapping.target = "both"}
    }

    const createNoteEditor = (owner: NoteEventOwnerReader) => (
        <NoteEditor lifecycle={runtime}
                    service={service}
                    menu={menu}
                    range={range}
                    snapping={snapping}
                    reader={owner}/>
    )

    const createAudioEditor = (reader: AudioEventOwnerReader) => (
        <AudioEditor lifecycle={runtime}
                     service={service}
                     menu={menu}
                     range={range}
                     snapping={snapping}
                     reader={reader}/>
    )

    const createValueEditor = (reader: ValueEventOwnerReader,
                               collection: PointerField<Pointers.RegionCollection | Pointers.ClipCollection>) => {
        const context = runtime.own(new ParameterValueEditing(service.project, collection))
        return (
            <ValueEventsEditor lifecycle={runtime}
                               service={service}
                               context={context}
                               menu={menu}
                               range={range}
                               snapping={snapping}
                               eventMapping={ValueMapping.unipolar()}
                               reader={reader}/>
        )
    }

    const updateEditor = deferNextFrame(() => editingSubject.get().match({
        some: (vertex: Vertex) => {
            // A timeline click can take focus after the subject notification but before this deferred redraw.
            restoreEditorFocus = restoreEditorFocus && (element.contains(document.activeElement) || document.activeElement === document.body)
            const {project: {boxAdapters, timelineBoxAdapter}} = service
            replaceChildren(contentEditor, vertex.box.accept<BoxVisitor<Element>>({
                visitNoteClipBox: (box: NoteClipBox): Element => {
                    editorKind("notes")
                    const reader = ClipReader
                        .forNoteClipBoxAdapter(boxAdapters.adapterFor(box, NoteClipBoxAdapter), timelineBoxAdapter)
                    owner = Option.wrap(reader)
                    return createNoteEditor(reader)
                },
                visitNoteRegionBox: (box: NoteRegionBox): Element => {
                    editorKind("notes")
                    const adapter = boxAdapters.adapterFor(box, NoteRegionBoxAdapter)
                    const reader = RegionReader.forNoteRegionBoxAdapter(adapter, timelineBoxAdapter, modifyContext)
                    owner = Option.wrap(reader)
                    return createNoteEditor(reader)
                },
                visitValueClipBox: (box: ValueClipBox): Element => {
                    editorKind("value")
                    const adapter = boxAdapters.adapterFor(box, ValueClipBoxAdapter)
                    const reader = ClipReader.forValueClipBoxAdapter(adapter, timelineBoxAdapter)
                    owner = Option.wrap(reader)
                    return createValueEditor(reader, box.clips)
                },
                visitValueRegionBox: (box: ValueRegionBox): Element => {
                    editorKind("value")
                    const adapter = boxAdapters.adapterFor(box, ValueRegionBoxAdapter)
                    const reader = RegionReader.forValueRegionBoxAdapter(adapter, timelineBoxAdapter, modifyContext)
                    owner = Option.wrap(reader)
                    return createValueEditor(reader, box.regions)
                },
                visitAudioClipBox: (box: AudioClipBox): Element => {
                    editorKind("audio-clip")
                    const adapter = boxAdapters.adapterFor(box, AudioClipBoxAdapter)
                    const reader = ClipReader.forAudioClipBoxAdapter(adapter, timelineBoxAdapter)
                    owner = Option.wrap(reader)
                    return createAudioEditor(reader)
                },
                visitAudioRegionBox: (box: AudioRegionBox): Element => {
                    editorKind("audio")
                    const adapter = boxAdapters.adapterFor(box, AudioRegionBoxAdapter)
                    const reader = RegionReader.forAudioRegionBoxAdapter(adapter, timelineBoxAdapter, modifyContext)
                    owner = Option.wrap(reader)
                    return createAudioEditor(reader)
                }
            }) ?? (() => fallback(vertex.box))())
            attachGenericViewMenu()
            range.width = contentEditor.clientWidth
            owner.ifSome(reader =>
                range.zoomRange(reader.offset, reader.offset + reader.loopDuration + PPQN.Bar, 16))
            if (restoreEditorFocus) {primaryContentCanvas(contentEditor)?.focus({preventScroll: true}); restoreEditorFocus = false}
        },
        none: () => {
            owner = Option.None
            editorKind("none")
            element.classList.add("disabled")
            replaceChildren(contentEditor, (
                <Frag>
                    <div className="empty-header"/>
                    <div className="label">
                        <p className="help-section">Double-click a region or clip to edit</p>
                    </div>
                </Frag>
            ))
        }
    }))

    const {project} = service
    const {engine} = project
    const shortcuts = ShortcutManager.get().createContext(element, "ContentEditor")
    lifecycle.ownAll(
        updateEditor,
        installContentEditorFocus(element, contentEditor),
        editingSubject.catchupAndSubscribe(() => {
            restoreEditorFocus = element.contains(document.activeElement)
            element.classList.remove("disabled")
            runtime.terminate()
            updateEditor.request()
        }),
        Html.watchResize(element, () =>
            element.style.setProperty("--cursor-height", `${(contentEditor.clientHeight + 1)}px`)),
        Html.watchResize(contentEditor, () => range.width = contentEditor.clientWidth),
        range.subscribe((() => {
            // FIXME Tried it with a timeout, but it did not behave correctly
            const mainTimelineRange = service.timeline.range
            range.maxUnits = mainTimelineRange.maxUnits
            return () => {
                if (range.maxUnits !== mainTimelineRange.maxUnits) {
                    range.maxUnits = mainTimelineRange.maxUnits
                }
            }
        })()),
        shortcuts,
        shortcuts.register(ContentEditorShortcuts["position-increment"].shortcut, () => {
            if (!engine.isPlaying.getValue()) {
                const pos = timelinePosition(project)
                seekTimeline(project, snapping.next(pos))
            }
        }, {allowRepeat: true}),
        shortcuts.register(ContentEditorShortcuts["position-decrement"].shortcut, () => {
            if (!engine.isPlaying.getValue()) {
                const pos = timelinePosition(project)
                seekTimeline(project, Math.max(0, snapping.previous(pos)))
            }
        }, {allowRepeat: true}),
        shortcuts.register(ContentEditorShortcuts["zoom-to-loop-duration"].shortcut, zoomToLoopDuration),
        shortcuts.register(ContentEditorShortcuts["snapping-finer"].shortcut, () => snapping.stepFiner(), {allowRepeat: true}),
        shortcuts.register(ContentEditorShortcuts["snapping-coarser"].shortcut, () => snapping.stepCoarser(), {allowRepeat: true})
    )
    return element
}
