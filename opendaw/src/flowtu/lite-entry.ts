import {Browser} from '@opendaw/lib-dom'

// Capture the launch intent before Studio's project router normalizes /create.
const search = new URLSearchParams(location.search)
const requested = search.get('mode')
export const startInLite = requested === 'lite' || (requested !== 'pro' && Browser.isMobile())
export const startWithLiteDemo = requested === 'lite' && search.get('example') === 'last-train'
export const showExampleEdit = startWithLiteDemo && search.get('focus') === 'edit'
