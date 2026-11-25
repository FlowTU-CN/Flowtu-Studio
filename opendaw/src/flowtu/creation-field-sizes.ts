const preferenceKey = 'flowtu.studio.creation-field-sizes'
const sections = {
    name: '.ft-score-cue-name',
    range: '.ft-score-range',
    start: '.ft-score-range label:has([data-field=start])',
    end: '.ft-score-range label:has([data-field=end])',
    prompt: '[data-field=prompt]',
    style: '.ft-direction-controls > label',
    melody: '[data-pad=melody]',
    emotion: '[data-pad=emotion]',
    instrument: '.ft-score-generate-row > label'
} as const

type Size = {width?: string, height?: string}

/** Store only dimensions explicitly set on a field, so responsive layout changes never become preferences. */
export function installCreationFieldSizes(form: HTMLElement) {
    let sizes: Record<string, Size> = {}
    try {
        const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? '{}')
        if (saved && typeof saved === 'object') sizes = saved
    } catch { /* Embedded or private sessions can still resize for this visit. */ }
    const fitPad = (field: HTMLElement) => {
        const body = field.querySelector<HTMLElement>('.ft-direction-body')
        if (!body) return
        if (field.style.height) body.style.setProperty('--ft-pad-size', Math.max(54, parseFloat(field.style.height) - 44) + 'px')
        else body.style.removeProperty('--ft-pad-size')
    }
    const abort = new AbortController()
    const observer = new MutationObserver(records => {
        for (const {target} of records) {
            const field = target as HTMLElement
            fitPad(field)
            sizes[field.dataset.creationSize!] = {width: field.style.width, height: field.style.height}
        }
        try {localStorage.setItem(preferenceKey, JSON.stringify(sizes))} catch { /* Keep session sizing. */ }
    })
    for (const [name, selector] of Object.entries(sections)) {
        const field = form.querySelector<HTMLElement>(selector)!
        field.dataset.creationSize = name
        field.dataset.i18n = ''
        field.title = 'Resize at the lower right · Alt + arrows to adjust · Alt + Home to reset'
        if (field.tabIndex < 0) field.tabIndex = 0
        for (const axis of ['width', 'height'] as const) {
            const saved = sizes[name]?.[axis]
            if (typeof saved === 'string' && /^\d+(\.\d+)?px$/.test(saved)) field.style[axis] = saved
        }
        fitPad(field)
        field.addEventListener('keydown', event => {
            if (event.target !== field || !event.altKey || event.metaKey || event.ctrlKey) return
            const {key} = event
            if (!['Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return
            event.preventDefault()
            event.stopPropagation()
            if (key === 'Home') {
                field.style.removeProperty('width')
                field.style.removeProperty('height')
                return
            }
            const axis = key === 'ArrowLeft' || key === 'ArrowRight' ? 'width' : 'height'
            const delta = key === 'ArrowLeft' || key === 'ArrowUp' ? -12 : 12
            field.style[axis] = Math.max(1, field.getBoundingClientRect()[axis] + delta) + 'px'
        }, {signal: abort.signal})
        observer.observe(field, {attributes: true, attributeFilter: ['style']})
    }
    return () => {observer.disconnect(); abort.abort()}
}
