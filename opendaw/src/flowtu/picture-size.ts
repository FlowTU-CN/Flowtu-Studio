/** Half the source's display dimensions in CSS pixels, constrained to the available space. */
export function halfPicture(width: number, height: number, maxWidth: number, maxHeight: number) {
    const scale = Math.min(.5, maxWidth / width, maxHeight / height)
    return {width: Math.round(width * scale), height: Math.round(height * scale)}
}
