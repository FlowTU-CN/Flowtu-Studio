import {createLiteComposerDock} from './LiteComposerDock'
import {tr, watchStudioLanguage} from './studio-language'

/** Both text fields edit the Music Creation form. The project owns its cue, settings and takes. */
export function createProComposerDock(field: HTMLTextAreaElement, generate: HTMLButtonElement, status: HTMLOutputElement, save: () => void, clearSelection: () => void) {
    const prompt = document.createElement('textarea')
    const send = document.createElement('button')
    const feedback = document.createElement('output')
    const holder = document.createDocumentFragment()
    holder.append(prompt, send, feedback)
    send.type = 'button'
    prompt.maxLength = field.maxLength
    const dock = createLiteComposerDock(prompt, send, feedback, {surface:'pro',clearSelection})
    document.body.append(dock.element)
    function sync() {
        if (prompt.value !== field.value) prompt.value = field.value
        send.disabled = generate.disabled || !field.value.trim()
        prompt.disabled = field.disabled
    }
    prompt.oninput = () => {field.value = prompt.value; sync()}
    prompt.onchange = () => field.dispatchEvent(new Event('change', {bubbles:true}))
    field.addEventListener('input', sync)
    send.onclick = () => generate.click()
    prompt.onkeydown = event => {
        if (event.key === 'Tab') return
        event.stopPropagation()
        if (event.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            if (!event.repeat) send.click()
        } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()
            field.dispatchEvent(new Event('change', {bubbles:true}))
            save()
        }
    }
    const updates = new MutationObserver(() => {
        feedback.textContent = status.textContent
        feedback.title = status.textContent ?? ''
        feedback.dataset.error = status.dataset.error
    })
    updates.observe(status, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['data-error']})
    const labels = () => {dock.labels(); prompt.ariaLabel = tr('Music Creation')}
    const unwatch = watchStudioLanguage(labels)
    labels()
    return {sync, setActive:dock.setActive, setScope:dock.setScope, dispose() {
        updates.disconnect(); unwatch(); field.removeEventListener('input',sync); dock.dispose()
    }}
}
