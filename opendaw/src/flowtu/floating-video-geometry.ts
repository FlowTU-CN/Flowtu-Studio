export type FloatingVideoGeometry = {x: number; y: number; width: number; height: number}
export type FloatingVideoViewport = Pick<FloatingVideoGeometry, 'width' | 'height'>
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const defaultHeight = (width: number) => Math.round(154 + width * 9 / 16)

export function fitFloatingVideo(geometry: FloatingVideoGeometry, viewport: FloatingVideoViewport): FloatingVideoGeometry {
    const margin = Math.min(10, viewport.width / 4, viewport.height / 4)
    const availableWidth = viewport.width - 2 * margin
    const availableHeight = viewport.height - 2 * margin
    const width = clamp(geometry.width, Math.min(260, availableWidth), availableWidth)
    const height = clamp(geometry.height, Math.min(220, availableHeight), availableHeight)
    return {
        x: clamp(geometry.x, margin, viewport.width - margin - width),
        y: clamp(geometry.y, margin, viewport.height - margin - height),
        width, height
    }
}

export function defaultFloatingVideo(viewport: FloatingVideoViewport): FloatingVideoGeometry {
    return fitFloatingVideo({x: viewport.width - 404, y: 110, width: 380, height: defaultHeight(380)}, viewport)
}

export function readFloatingVideoGeometry(value: string | null): FloatingVideoGeometry | undefined {
    if (!value) return
    try {
        const {x, y, width, height = defaultHeight(width)} = JSON.parse(value)
        if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) return {x, y, width, height}
    } catch { /* Ignore invalid layout preferences. */ }
    return undefined
}
