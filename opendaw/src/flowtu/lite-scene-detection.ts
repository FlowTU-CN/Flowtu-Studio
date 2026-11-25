export interface LitePictureScene {
    start: number
    end: number
    thumbnail: string
    keyframeTime: number
    brightness: number
    motion: number
    warmth: number
    boundary: 'opening' | 'cut' | 'duration'
    contextFrames?: Array<{time:number; thumbnail:string}>
}

interface Frame {
    time: number
    colors: Float32Array
    luma: Float32Array
    blocks: Float32Array
    brightness: number
    warmth: number
}

const sampleWidth = 48, sampleHeight = 32
const maxSamples = 600
const maxCues = 1000

function describe(pixels: Uint8ClampedArray, time: number): Frame {
    const colors = new Float32Array(64), luma = new Float32Array(16), blocks = new Float32Array(8 * 4 * 3)
    const size = sampleWidth * sampleHeight
    const blockScale = 1 / (6 * 8 * 255)
    let light = 0, warmth = 0
    for (let i = 0; i < size; i++) {
        const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2]
        const y = .2126 * r + .7152 * g + .0722 * b
        colors[(r >> 6) * 16 + (g >> 6) * 4 + (b >> 6)] += 1 / size
        luma[Math.min(15, y >> 4)] += 1 / size
        const block = (Math.floor(i / (sampleWidth * 8)) * 8 + Math.floor(i % sampleWidth / 6)) * 3
        blocks[block] += r * blockScale; blocks[block + 1] += g * blockScale; blocks[block + 2] += b * blockScale
        light += y; warmth += r - b
    }
    return {time, colors, luma, blocks, brightness: light / (255 * size), warmth: warmth / (255 * size)}
}

function distance(a: Float32Array, b: Float32Array): number {
    let n = 0
    for (let i = 0; i < a.length; i++) n += Math.abs(a[i] - b[i])
    return n
}

function spatialChange(a: Frame, b: Frame): number {
    return distance(a.blocks, b.blocks) / a.blocks.length
}

function difference(a: Frame, b: Frame): number {
    return .48 * spatialChange(a, b) + .175 * distance(a.colors, b.colors) + .085 * distance(a.luma, b.luma)
}

function cutCandidates(frames: Frame[]): number[] {
    const deltas = frames.map((frame, i) => i ? difference(frames[i - 1], frame) : 0)
    const candidates: number[] = []
    for (let i = 1; i < frames.length; i++) {
        // The first frame of a new shot should differ more than normal camera movement.
        const neighbors = deltas.slice(Math.max(1, i - 4), i).concat(deltas.slice(i + 1, i + 5)).sort((a, b) => a - b)
        const baseline = neighbors[Math.floor((neighbors.length - 1) / 2)] ?? 0
        if (deltas[i] < Math.max(.105, baseline * 2.45 + .018) || spatialChange(frames[i - 1], frames[i]) < .025) continue
        const next = frames[i + 1]
        if (next && difference(frames[i - 1], next) < deltas[i] * .35) {
            i++ // A flash that returns to the previous image within one sample.
            continue
        }
        candidates.push(i)
    }
    return candidates
}

function waitForVideo(video: HTMLVideoElement, event: string, signal: AbortSignal, begin: () => void) {
    return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            window.clearTimeout(timeout)
            video.removeEventListener(event, ready); video.removeEventListener('error', error)
            signal.removeEventListener('abort', abort)
        }
        const ready = () => { cleanup(); resolve() }
        const fail = (reason: unknown) => { cleanup(); reject(reason) }
        const error = () => fail(new Error(video.error?.message || 'Unable to decode the selected video.'))
        const abort = () => fail(signal.reason ?? new DOMException('Analysis cancelled.', 'AbortError'))
        const timeout = window.setTimeout(() => fail(new Error('Timed out while decoding the selected video.')), 15000)
        video.addEventListener(event, ready); video.addEventListener('error', error)
        signal.addEventListener('abort', abort, {once: true})
        if (signal.aborted) abort()
        else try { begin() } catch (reason) { fail(reason) }
    })
}

type SceneRange = Pick<LitePictureScene, 'start' | 'end' | 'boundary'>
function sections(cuts: number[], duration: number, maxLength: number): SceneRange[] {
    const starts = [0, ...cuts, duration]
    const result: SceneRange[] = []
    for (let i = 0; i < starts.length - 1; i++) {
        const start = starts[i], end = starts[i + 1], count = Math.ceil((end - start) / maxLength)
        if (result.length + count > maxCues) throw new Error('The picture needs more than the 1,000 sections supported by this project.')
        for (let j = 0; j < count; j++) result.push({
            start: start + (end - start) * j / count,
            end: j + 1 === count ? end : start + (end - start) * (j + 1) / count,
            boundary: j ? 'duration' : i ? 'cut' : 'opening'
        })
    }
    return result
}

/** A private muted decoder reads the local File. All returned times are source-relative seconds. */
export async function analyzeLitePicture(file: File, options: {
    signal: AbortSignal
    onProgress: (progress: number) => void
    maxSceneSeconds: number
}): Promise<{duration: number; scenes: LitePictureScene[]}> {
    const {signal, maxSceneSeconds, onProgress} = options
    signal.throwIfAborted()
    if (!(maxSceneSeconds > 0) || !Number.isFinite(maxSceneSeconds)) throw new Error('Choose a positive maximum section duration.')
    const video = document.createElement('video')
    video.muted = true; video.playsInline = true; video.preload = 'auto'
    const canvas = document.createElement('canvas')
    canvas.width = sampleWidth; canvas.height = sampleHeight
    const ctx = canvas.getContext('2d', {willReadFrequently: true})
    const thumbnail = document.createElement('canvas'), thumbContext = thumbnail.getContext('2d')
    if (!ctx || !thumbContext) throw new Error('Frame analysis requires a 2D canvas.')
    const url = URL.createObjectURL(file)
    try {
        onProgress(0)
        await waitForVideo(video, 'loadedmetadata', signal, () => { video.src = url; video.load() })
        const duration = video.duration
        if (!Number.isFinite(duration) || duration <= 0 || !video.videoWidth || !video.videoHeight) throw new Error('Choose a video with a readable picture and duration.')
        if (duration / maxSceneSeconds > maxCues) throw new Error('The picture needs more than the 1,000 sections supported by this project.')
        const seek = async (time: number) => {
            signal.throwIfAborted()
            const target = Math.min(Math.max(0, time), Math.max(0, duration - .001))
            if (Math.abs(video.currentTime - target) < .0001 && !video.seeking) {
                if (video.readyState < video.HAVE_CURRENT_DATA) await waitForVideo(video, 'loadeddata', signal, () => {})
            } else {
                await waitForVideo(video, 'seeked', signal, () => { video.currentTime = target })
            }
        }
        const readFrame = async (time: number) => {
            await seek(time)
            ctx.drawImage(video, 0, 0, sampleWidth, sampleHeight)
            return describe(ctx.getImageData(0, 0, sampleWidth, sampleHeight).data, time)
        }
        const frames: Frame[] = []
        const count = Math.max(2, Math.min(maxSamples, Math.ceil(duration / .42) + 1))
        const finalSample = Math.max(0, duration - Math.min(.04, duration / 10))
        for (let i = 0; i < count; i++) {
            frames.push(await readFrame(finalSample * i / (count - 1)))
            onProgress(.7 * (i + 1) / count)
        }
        const candidates = cutCandidates(frames)
        const cuts: number[] = []
        for (const [n, index] of candidates.entries()) {
            const before = frames[index - 1], after = frames[index]
            let left = before.time, right = after.time
            for (let step = 0; step < 9 && right - left > .025; step++) {
                const mid = (left + right) / 2, frame = await readFrame(mid)
                if (difference(frame, before) <= difference(frame, after)) left = mid
                else right = mid
            }
            const cut = Math.round(right * 1000) / 1000
            if (cut > (cuts.at(-1) ?? 0) + .2 && duration - cut >= .2) cuts.push(cut)
            onProgress(.7 + .12 * (n + 1) / candidates.length)
        }
        const ranges = sections(cuts, duration, maxSceneSeconds)
        const scenes: LitePictureScene[] = []
        const scale = Math.min(1, 224 / video.videoWidth, 140 / video.videoHeight)
        thumbnail.width = Math.max(1, Math.round(video.videoWidth * scale))
        thumbnail.height = Math.max(1, Math.round(video.videoHeight * scale))
        const captureThumbnail = () => {
            thumbContext.drawImage(video, 0, 0, thumbnail.width, thumbnail.height)
            return thumbnail.toDataURL('image/jpeg', .64)
        }
        for (const [i, range] of ranges.entries()) {
            const inside = frames.filter(frame => frame.time >= range.start && frame.time < range.end)
            const center = (range.start + range.end) / 2
            const quality = (f: Frame) => Math.abs(f.time - center) / (range.end - range.start) + (f.brightness < .045 || f.brightness > .96 ? .45 : 0)
            let selected = inside[0]
            for (const frame of inside) if (quality(frame) < quality(selected)) selected = frame
            // A very short shot can fall between adjacent samples after cut refinement.
            if (!selected || selected.time - range.start < .08 || range.end - selected.time < .08) selected = await readFrame(center)
            else await seek(selected.time)
            let motion = 0, brightness = 0, warmth = 0
            const samples = inside.length ? inside : [selected]
            for (const [j, frame] of samples.entries()) {
                brightness += frame.brightness; warmth += frame.warmth
                if (j) motion += spatialChange(samples[j - 1], frame) / Math.max(.15, Math.min(1, frame.time - samples[j - 1].time))
            }
            const mainImage = captureThumbnail()
            const contextFrames = []
            // Two sparse temporal references help describe a continuous shot. Bound total
            // retained pixels and provider image count on long, densely cut projects.
            if (range.end - range.start >= 8 && ranges.length <= 100) {
                for (const ratio of [.13, .87]) {
                    const time = range.start + (range.end - range.start) * ratio
                    if (Math.abs(time - selected.time) < 1) continue
                    await seek(time)
                    contextFrames.push({time, thumbnail:captureThumbnail()})
                }
            }
            scenes.push({...range, keyframeTime: selected.time, thumbnail:mainImage, ...(contextFrames.length ? {contextFrames} : {}),
                brightness: brightness / samples.length, warmth: warmth / samples.length,
                motion: Math.min(1, 3 * motion / Math.max(1, samples.length - 1))})
            onProgress(.82 + .18 * (i + 1) / ranges.length)
        }
        signal.throwIfAborted()
        return {duration, scenes}
    } finally {
        video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url)
        canvas.width = thumbnail.width = 1
    }
}
