import {openComposerWorkspace, closeComposerWorkspace} from './composer-workspaces'
import {UUID} from '@opendaw/lib-std'
import type {Project} from '@opendaw/studio-core'
import {AudioRegionBoxAdapter} from '@opendaw/studio-adapters'
import type {StudioService} from '../service/StudioService'
import {projectAssets} from './scoring-assets'
import {takeRegion} from './scoring-model'
import {deckVersions, saveDeckVersion, type DeckEdit} from './flowdeck-model'
import type {createTakeAudition} from './take-audition'
import './flowdeck.css'

type Commands = {audition: ReturnType<typeof createTakeAudition>; edit(id: string): void; save(): void; tell(message: string): void}

export function createFlowDeck(service: StudioService, commands: Commands) {
    const element = document.createElement('div'), sheet = document.createElement('section'), dialog = document.createElement('dialog')
    element.className = 'ft-deck-dock'; element.hidden = true
    dialog.className = 'ft-deck-dialog'; dialog.setAttribute('aria-label', 'FlowDeck canvas')
    sheet.className = 'ft-deck'; sheet.setAttribute('aria-label', 'FlowDeck')
    sheet.innerHTML = `<div class="ft-deck-grip" role="separator" aria-label="Resize FlowDeck" aria-orientation="horizontal" tabindex="0"></div>
        <header><strong>FlowDeck</strong><button type="button" data-deck="expand" aria-label="Expand canvas">⤢</button><button type="button" data-deck="close" aria-label="Close FlowDeck">×</button></header>
        <div class="ft-deck-tools"><select aria-label="FlowDeck source asset"></select><button type="button" data-deck="out" aria-label="Zoom out">−</button><button type="button" data-deck="zoom" aria-label="Reset canvas zoom">100%</button><button type="button" data-deck="in" aria-label="Zoom in">+</button></div>
        <div class="ft-deck-view" tabindex="0"><div class="ft-deck-board"><svg class="ft-deck-wires" aria-hidden="true"></svg><article class="ft-deck-source"></article>
        <form class="ft-deck-edit"><small>Adjustment</small><div class="ft-deck-fields"></div><button type="submit">Save version</button></form>
        <div class="ft-deck-outputs"></div></div><p class="ft-deck-empty"></p></div><output class="ft-deck-status" role="status"></output>`
    element.append(sheet); document.body.append(dialog)
    const q = <T extends HTMLElement>(s: string) => sheet.querySelector<T>(s)!
    const button = (action: string) => q<HTMLButtonElement>(`[data-deck="${action}"]`)
    const picker = q<HTMLSelectElement>('select'), view = q('.ft-deck-view'), board = q('.ft-deck-board')
    const source = q('.ft-deck-source'), form = q<HTMLFormElement>('form'), fields = q('.ft-deck-fields'), outputs = q('.ft-deck-outputs')
    const empty = q('.ft-deck-empty'), status = q<HTMLOutputElement>('output'), wires = sheet.querySelector<SVGSVGElement>('svg')!
    let id = '', project: Project | undefined, zoom = 1, signature = '', pickerSignature = '', initialized = '', raf = 0
    let previewOwner = '', previewState = ''
    function stopPreview() {
        if (previewOwner && commands.audition.current() === previewOwner) commands.audition.stop()
        previewOwner = ''
    }
    function refreshPreview() {
        if (element.hidden) return
        const current = commands.audition.current(), loading = commands.audition.loading()
        const state = [current, loading].join('/')
        if (state === previewState) return
        previewState = state
        for (const control of board.querySelectorAll<HTMLButtonElement>('button[data-preview]')) {
            const active = current === control.dataset.preview
            control.setAttribute('aria-pressed', String(active))
            control.textContent = active ? (loading ? 'Cancel' : 'Stop') : 'Preview'
        }
    }
    function draw() {
        if (raf) cancelAnimationFrame(raf)
        raf = requestAnimationFrame(() => {
            raf = 0
            if (board.hidden || element.hidden) return
            const rect = board.getBoundingClientRect()
            const link = (a: HTMLElement, b: HTMLElement) => {
                const first = a.getBoundingClientRect(), second = b.getBoundingClientRect(), vertical = second.left < first.right
                const x1 = ((vertical ? first.left+first.width/2 : first.right)-rect.left)/zoom
                const y1 = ((vertical ? first.bottom : first.top+first.height/2)-rect.top)/zoom
                const x2 = ((vertical ? second.left+second.width/2 : second.left)-rect.left)/zoom
                const y2 = ((vertical ? second.top : second.top+second.height/2)-rect.top)/zoom
                const path = document.createElementNS(wires.namespaceURI,'path')
                path.setAttribute('d', vertical ? `M${x1} ${y1} C${x1} ${(y1+y2)/2} ${x2} ${(y1+y2)/2} ${x2} ${y2}` : `M${x1} ${y1} C${(x1+x2)/2} ${y1} ${(x1+x2)/2} ${y2} ${x2} ${y2}`)
                return path
            }
            wires.replaceChildren(link(source, form), ...Array.from(outputs.children, el => link(form, el as HTMLElement)))
        })
    }
    const resize = new ResizeObserver(draw); resize.observe(board)
    function setZoom(value: number) {
        zoom = Math.max(.55, Math.min(1.7, value))
        board.style.zoom = String(zoom)
        button('zoom').textContent = Math.round(100*zoom)+'%'
        draw()
    }
    button('out').onclick = () => setZoom(zoom-.15)
    button('in').onclick = () => setZoom(zoom+.15)
    button('zoom').onclick = () => setZoom(1)
    function setExpanded(expanded: boolean) {
        if (expanded && !dialog.open) {dialog.append(sheet); openComposerWorkspace(dialog)}
        else if (!expanded && dialog.open) {element.append(sheet); closeComposerWorkspace(dialog)}
        button('expand').textContent = expanded ? '↙' : '⤢'
        button('expand').setAttribute('aria-label', expanded ? 'Dock canvas' : 'Expand canvas')
        draw()
    }
    dialog.oncancel = e => {e.preventDefault(); setExpanded(false)}
    button('expand').onclick = () => setExpanded(!dialog.open)
    const close = () => {stopPreview(); setExpanded(false); element.hidden = true}
    button('close').onclick = close
    picker.onchange = () => {stopPreview(); id = picker.value; refresh()}
    function card(node: HTMLElement, kind: string, title: string, assetId: string) {
        const label = document.createElement('small'), name = document.createElement('strong'), play = document.createElement('button')
        label.textContent = kind; name.textContent = title || 'Untitled'; name.title = name.textContent
        play.type = 'button'; play.textContent = 'Preview'; play.dataset.preview = assetId
        play.onclick = () => {
            previewOwner = assetId
            void commands.audition.play(assetId).catch(error => commands.tell(error instanceof Error ? error.message : String(error)))
            refreshPreview()
        }
        node.replaceChildren(label,name,play)
        const action = document.createElement('button')
        action.type = 'button'; action.textContent = assetId === id ? 'Edit' : 'Refine'
        action.onclick = () => {
            stopPreview()
            if (assetId === id) {setExpanded(false); commands.edit(assetId)}
            else {id = assetId; refresh()}
        }
        node.append(action)
    }
    function field(label: string, key: string, value: string, min: number, max: number, step = 1) {
        const wrap = document.createElement('label'), input = document.createElement('input')
        input.type = 'number'; input.name = key; input.value = value; input.required = value !== ''
        input.min = String(min); input.max = String(max); input.step = String(step)
        if (!input.required) input.placeholder = 'Keep'
        wrap.append(label, input); return wrap
    }
    function refresh() {
        if (element.hidden) return
        const next = service.hasProfile ? service.project : undefined
        if (next !== project) {
            project = next; initialized = ''; pickerSignature = ''; signature = ''
        }
        const assets = project ? projectAssets(project) : [], asset = assets.find(a => a.id === id)
        const key = JSON.stringify(assets.map(a => [a.id,a.name]))
        if (key !== pickerSignature) {
            pickerSignature = key
            picker.replaceChildren(new Option('Choose an asset…',''), ...assets.map(a => new Option(a.name || 'Untitled',a.id)))
        }
        picker.value = asset?.id ?? ''
        board.hidden = !asset; empty.hidden = !!asset
        if (!asset || !project) {
            initialized = ''; signature = ''
            empty.textContent = assets.length ? 'Choose a source to refine.' : 'Import audio or generate a take to open it in FlowDeck.'
            return
        }
        const region = takeRegion(project, id)
        if (!region) return
        const audio = region instanceof AudioRegionBoxAdapter
        if (initialized !== id) {
            initialized = id; signature = ''; status.value = ''; view.scrollTo(0,0)
            fields.replaceChildren(...(audio ? [
                field('Gain · dB','gain',region.gain.getValue().toFixed(1),-60,12,.1),
                field('Fade in · ms','fadeIn','',0,86400000), field('Fade out · ms','fadeOut','',0,86400000)
            ] : [field('Pitch · st','transpose','0',-48,48),field('Velocity · %','velocity','100',1,200)]))
        }
        const versions = deckVersions(project,id), nextSignature = JSON.stringify([asset.name,asset.kind,asset.cue,versions])
        if (signature === nextSignature) return
        signature = nextSignature
        card(source, [asset.cue && 'Cue '+asset.cue, asset.kind].filter(Boolean).join(' · '), asset.name,id)
        outputs.replaceChildren(...versions.map(v => {
            const node = document.createElement('article')
            card(node,'Version '+v.number,v.name,v.id); return node
        }))
        previewState = ''; refreshPreview(); draw()
    }
    dialog.onkeydown = e => {
        if (e.key !== 'Tab') e.stopPropagation()
        if (!project || e.defaultPrevented || e.isComposing || e.altKey || !(e.metaKey || e.ctrlKey)) return
        const key = e.key.toLowerCase()
        if (key === 's' && !e.shiftKey) {e.preventDefault(); if (!e.repeat) commands.save(); return}
        if (key !== 'z' || (e.target instanceof Element && e.target.closest('input,textarea,select'))) return
        e.preventDefault()
        if (e.shiftKey) project.editing.redo()
        else project.editing.undo()
        status.value = ''; refresh()
    }
    const number = (key: string) => (form.elements.namedItem(key) as HTMLInputElement).valueAsNumber
    const optional = (key: string) => Number.isNaN(number(key)) ? undefined : number(key)
    form.onsubmit = event => {
        event.preventDefault()
        if (!project || project !== service.project || !id) return
        const edit: DeckEdit = form.elements.namedItem('gain') ? {kind:'audio',gain:number('gain'),fadeIn:optional('fadeIn'),fadeOut:optional('fadeOut')}
            : {kind:'midi',transpose:number('transpose'),velocity:number('velocity')}
        try {
            const version = saveDeckVersion(project,id,edit)
            refresh()
            status.value = 'Saved '+takeRegion(project,version)!.label
            outputs.lastElementChild?.scrollIntoView({block:'nearest',inline:'nearest'})
        } catch (error) {status.value = error instanceof Error ? error.message : String(error); commands.tell(status.value)}
    }
    const grip = q('.ft-deck-grip')
    const height = (h: number) => element.style.setProperty('--deck-height', Math.round(Math.max(150, Math.min(h,window.innerHeight*.75)))+'px')
    let resizing: {y:number; h:number} | undefined
    grip.onpointerdown = e => {if (e.button===0) {resizing={y:e.clientY,h:sheet.offsetHeight};grip.setPointerCapture(e.pointerId);e.preventDefault()}}
    grip.onpointermove = e => {if (resizing) height(resizing.h+resizing.y-e.clientY)}
    grip.onlostpointercapture = () => {resizing=undefined}
    grip.onkeydown = e => {if (e.key==='ArrowUp'||e.key==='ArrowDown') {e.preventDefault();height(sheet.offsetHeight+(e.key==='ArrowUp'?16:-16))}}
    let pan: {x:number;y:number;left:number;top:number} | undefined
    view.onpointerdown = e => {
        if (e.button || !(e.target instanceof Element) || e.target.closest('form,article,p,button')) return
        pan={x:e.clientX,y:e.clientY,left:view.scrollLeft,top:view.scrollTop};view.setPointerCapture(e.pointerId);e.preventDefault()
    }
    view.onpointermove = e => {if(pan) view.scrollTo(pan.left+pan.x-e.clientX,pan.top+pan.y-e.clientY)}
    view.onlostpointercapture = () => {pan=undefined}
    return {element,refresh,refreshPreview,close, open(assetId?:string,expanded=false) {
        if (!assetId && service.hasProfile) {
            const selected = service.project.regionSelection.selected().find(r => takeRegion(service.project,UUID.toString(r.uuid)))
            if (selected) assetId = UUID.toString(selected.uuid)
        }
        if (assetId && assetId !== id) {stopPreview(); id = assetId}
        element.hidden=false;setExpanded(expanded);refresh();draw()
    }, dispose() {
        stopPreview(); element.hidden=true; resize.disconnect()
        if (raf) cancelAnimationFrame(raf)
        if(dialog.open)closeComposerWorkspace(dialog)
        dialog.remove();element.remove()
    }}
}
