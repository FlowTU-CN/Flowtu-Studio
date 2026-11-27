// Flowtu Studio cloud generation client (1124 contract, §三).
// The generation endpoints live behind the main-site ext gateway (/api/e/me/…), same-origin.
// Auth is dual-track: Bearer JWT read from the host page's localStorage ('flowtu_go_jwt')
// plus the session cookie. The binary project-sync protocol in project-library.ts is a
// deliberate exception and does not use this {ok,…} envelope.
import {studioAuthHeaders} from './studio-auth.ts'
import type {ScoreDirection} from './scoring-direction'

export type DirectionPadPoint = {x: number; y: number}
export type ApiDirection = {melodyArrangement: DirectionPadPoint; emotionStyle: DirectionPadPoint}
export type StudioModelCapabilities = {withLyrics: boolean; instrumental: boolean; refAudio: boolean; refMidi: boolean; humming: boolean; refImage: boolean}
export type StudioModel = {model: string; label: string; maxCount: number; capabilities: StudioModelCapabilities; creditHint: number}
export type GenerationSong = {songKey: string; title: string; durationMs?: number; playUrl: string | null; coverUrl?: string | null; errorCode?: string | null; failLabel?: string; failMessage?: string}
export type SubmitResult = {generationKey: string; status: string; estimatedSeconds?: number; billing?: {credits: number}; partial?: boolean; replayed?: boolean}
export type GenerationState = {generationKey: string; status: 'running' | 'succeeded' | 'failed'; songs?: GenerationSong[]; errorCode?: string | null; createdAt?: string; completedAt?: string}
export type GenerationInput = {
    projectId?: string; prompt: string; lyrics?: string; contentType: 'instrumental' | 'withLyrics'; model: string
    count?: number; style?: string; direction?: ScoreDirection
    inSec: number; outSec: number
    refAudioKeys?: string[]; refMidiKeys?: string[]; hummingKey?: string
}
export type GenerationRequest = {
    clientRequestId: string; projectId?: string; prompt: string; lyrics: string; contentType: 'instrumental' | 'withLyrics'
    model: string; count: number; style: string; direction?: ApiDirection
    inSec: number; outSec: number
    refAudioKeys?: string[]; refMidiKeys?: string[]; hummingKey?: string
}
// The input snapshot returned by the per-project listing; style uses API values ('follow' etc.).
export type GenerationInputSnapshot = Omit<GenerationRequest, 'clientRequestId'>
export type GenerationRecord = {generationKey: string; songs?: GenerationSong[]; input?: GenerationInputSnapshot}

export class StudioGenerationError extends Error {
    readonly status: number | undefined
    readonly code: string | undefined
    constructor(message: string, status?: number, code?: string) {
        super(message)
        this.status = status
        this.code = code
    }
}
export const isAuthError = (error: unknown): boolean => error instanceof StudioGenerationError && error.status === 401
export const isCreditsError = (error: unknown): boolean => error instanceof StudioGenerationError && (error.status === 402 || error.code === 'insufficient_credits')

const gateway = (path: string) => '/api/e/me/' + path
type ApiEnvelope<T> = {ok?: boolean; code?: number; message?: string; error?: string; data?: T}
async function callApi<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = studioAuthHeaders(init.headers as Record<string,string> | undefined)
    const response = await fetch(gateway(path), {...init, headers, credentials: 'same-origin', signal: init.signal ?? AbortSignal.timeout(20000)})
    let body: ApiEnvelope<T> | undefined
    try {body = await response.json() as ApiEnvelope<T>} catch { /* Non-JSON gateway error. */ }
    if (response.ok && body?.ok === true) return body.data as T
    throw new StudioGenerationError(body?.message ?? 'Studio request failed (HTTP ' + response.status + ').',
        response.status, body?.error)
}

// The Studio direction dials are four bipolar axes (−100…100). The API wants two pads with
// 0…100 coordinates centered at 50. A neutral 'prompt' direction maps to nothing at all.
const clampAxis = (value: number) => Math.max(-100, Math.min(100, Math.round(value)))
const padAxis = (value: number) => Math.max(0, Math.min(100, clampAxis(value) + 50))
export function toApiDirection(direction?: ScoreDirection): ApiDirection | undefined {
    if (!direction) return undefined
    const pad = (x: number, y: number): DirectionPadPoint => ({x: padAxis(x), y: padAxis(y)})
    const converted = {melodyArrangement: pad(direction.melody, direction.arrangement), emotionStyle: pad(direction.emotion, direction.character)}
    const neutral = (point: DirectionPadPoint) => point.x === 50 && point.y === 50
    if (direction.style === 'prompt' && neutral(converted.melodyArrangement) && neutral(converted.emotionStyle)) return undefined
    return converted
}
export function fromApiDirection(direction?: ApiDirection): {melody: number; arrangement: number; emotion: number; character: number} | undefined {
    if (!direction) return undefined
    const axis = (value: number) => clampAxis((Number.isFinite(value) ? value : 50) - 50)
    return {melody: axis(direction.melodyArrangement?.x), arrangement: axis(direction.melodyArrangement?.y),
        emotion: axis(direction.emotionStyle?.x), character: axis(direction.emotionStyle?.y)}
}
export const toApiStyle = (style?: string): string => !style || style === 'prompt' ? 'follow' : style
export const fromApiStyle = (style?: string): string => !style || style === 'follow' ? 'prompt' : style

const roundedSeconds = (seconds: number) => Math.round(seconds * 1000) / 1000
export function buildGenerationRequest(input: GenerationInput, clientRequestId: string, model?: StudioModel): GenerationRequest {
    const prompt = (input.prompt ?? '').trim()
    const contentType = input.contentType === 'withLyrics' ? 'withLyrics' : 'instrumental'
    let lyrics = contentType === 'withLyrics' ? input.lyrics ?? '' : ''
    if (contentType === 'withLyrics') {
        lyrics = lyrics.trim()
        if (!lyrics) throw new StudioGenerationError('Lyrics are required for songs with vocals.', undefined, 'invalid_params')
    }
    if (!prompt && !lyrics) throw new StudioGenerationError('Describe the music before submitting a generation.', undefined, 'invalid_params')
    if (!input.model) throw new StudioGenerationError('Choose a generation model first.', undefined, 'invalid_params')
    const count = Math.floor(input.count ?? 1)
    const maxCount = model?.maxCount ?? 2
    if (!Number.isSafeInteger(count) || count < 1 || count > maxCount)
        throw new StudioGenerationError('Song count must be between 1 and ' + maxCount + '.', undefined, 'invalid_params')
    const inSec = roundedSeconds(input.inSec), outSec = roundedSeconds(input.outSec)
    if (!Number.isFinite(inSec) || !Number.isFinite(outSec) || inSec < 0 || outSec <= inSec)
        throw new StudioGenerationError('The generation range must end after it starts.', undefined, 'invalid_time_range')
    const capabilities = model?.capabilities
    if (capabilities) {
        const label = model?.label ?? model?.model ?? 'This model'
        if (contentType === 'withLyrics' && !capabilities.withLyrics)
            throw new StudioGenerationError(label + ' cannot generate songs with lyrics.', undefined, 'model_capability')
        if (input.hummingKey && !capabilities.humming)
            throw new StudioGenerationError(label + ' does not support humming input.', undefined, 'model_capability')
        if (input.refAudioKeys?.length && !capabilities.refAudio)
            throw new StudioGenerationError(label + ' does not support reference audio.', undefined, 'model_capability')
        if (input.refMidiKeys?.length && !capabilities.refMidi)
            throw new StudioGenerationError(label + ' does not support reference MIDI.', undefined, 'model_capability')
    }
    const generation: GenerationRequest = {clientRequestId, prompt, lyrics, contentType, model: input.model, count,
        style: toApiStyle(input.style), inSec, outSec,
        ...(input.projectId ? {projectId: input.projectId} : {}),
        ...(input.refAudioKeys?.length ? {refAudioKeys: input.refAudioKeys} : {}),
        ...(input.refMidiKeys?.length ? {refMidiKeys: input.refMidiKeys} : {}),
        ...(input.hummingKey ? {hummingKey: input.hummingKey} : {})}
    const direction = toApiDirection(input.direction)
    if (direction) generation.direction = direction
    return generation
}

// Submissions survive a reload: the journal keeps the request with its clientRequestId so the
// same idempotency key can be resumed or retried. Server-rejected submissions (billing,
// validation) are removed again — they never started a generation.
export type GenerationContext = {accountId: string; projectScope: string}
type JournalEntry = {clientRequestId: string; generationKey?: string; request: GenerationRequest; submittedAt: number; context?: GenerationContext; result?: SubmitResult}
const journalStorageKey = 'flowtu.studio-generations.v1'
const readJournal = (): JournalEntry[] => {
    try {
        const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(journalStorageKey) ?? '[]')
        return Array.isArray(parsed) ? parsed as JournalEntry[] : []
    } catch {return []}
}
const writeJournal = (entries: JournalEntry[]) => {
    try {globalThis.localStorage?.setItem(journalStorageKey, JSON.stringify(entries))} catch { /* Storage may be unavailable. */ }
}
export const pendingGenerations = (context?: GenerationContext): JournalEntry[] => readJournal().filter(entry =>
    entry && typeof entry.clientRequestId === 'string' && entry.request &&
    (!context || (entry.context?.accountId === context.accountId && entry.context.projectScope === context.projectScope)))
export const forgetGeneration = (clientRequestId: string): void =>
    writeJournal(readJournal().filter(entry => entry.clientRequestId !== clientRequestId))

type SubmitOptions = {signal?: AbortSignal; context?: GenerationContext}
const submissions = new Map<string, Promise<{clientRequestId: string} & SubmitResult>>()
async function sendJournalEntry(entry: JournalEntry, signal?: AbortSignal): Promise<{clientRequestId: string} & SubmitResult> {
    const {clientRequestId, request} = entry
    try {
        const data = await callApi<SubmitResult>('studio-generations', {method: 'POST',
            headers: {'Content-Type': 'application/json'}, body: JSON.stringify(request), signal})
        if (!data?.generationKey) throw new StudioGenerationError('The gateway did not return a generation key.')
        writeJournal(readJournal().map(item => item.clientRequestId === clientRequestId ? {...item, generationKey: data.generationKey, result: data} : item))
        return {clientRequestId, ...data}
    } catch (error) {
        // Only a definitive client rejection retires the request. A 5xx may follow a charge.
        if (error instanceof StudioGenerationError && error.status !== undefined && error.status >= 400 && error.status < 500)
            forgetGeneration(clientRequestId)
        throw error
    }
}
export async function resumeGeneration(clientRequestId: string, context: GenerationContext, options: {signal?: AbortSignal} = {}): Promise<{clientRequestId: string} & SubmitResult> {
    const entry = pendingGenerations(context).find(item => item.clientRequestId === clientRequestId)
    if (!entry) throw new StudioGenerationError('No pending generation for this account and project.')
    if (entry.generationKey) return {...entry.result, generationKey: entry.generationKey, status: entry.result?.status ?? 'running', clientRequestId}
    const active = submissions.get(clientRequestId)
    if (active) return active
    const task = sendJournalEntry(entry, options.signal).finally(() => submissions.delete(clientRequestId))
    submissions.set(clientRequestId, task)
    return task
}
export async function submitGeneration(input: GenerationInput, model?: StudioModel, options: SubmitOptions = {}): Promise<{clientRequestId: string} & SubmitResult> {
    const clientRequestId = crypto.randomUUID()
    const request = buildGenerationRequest(input, clientRequestId, model)
    const entry: JournalEntry = {clientRequestId, request, submittedAt: Date.now(), context: options.context}
    writeJournal([...readJournal(), entry])
    const task = sendJournalEntry(entry, options.signal).finally(() => submissions.delete(clientRequestId))
    submissions.set(clientRequestId, task)
    return task
}
export const generationFailureMessage = (state: GenerationState): string | undefined =>
    state.songs?.find(song => song.failMessage)?.failMessage ?? state.songs?.find(song => song.failLabel)?.failLabel

export async function fetchGeneration(generationKey: string, signal?: AbortSignal): Promise<GenerationState> {
    return callApi<GenerationState>('studio-generations/' + encodeURIComponent(generationKey), {signal})
}
export async function listProjectGenerations(projectId: string, signal?: AbortSignal): Promise<GenerationRecord[]> {
    const data = await callApi<{generations: GenerationRecord[]}>('studio-generations?projectId=' + encodeURIComponent(projectId), {signal})
    return Array.isArray(data.generations) ? data.generations : []
}
export async function regenerateGeneration(generationKey: string, options: {signal?: AbortSignal} = {}): Promise<SubmitResult> {
    const data = await callApi<SubmitResult>('studio-generations/' + encodeURIComponent(generationKey) + '/regenerate', {method: 'POST', signal: options.signal})
    if (!data.generationKey) throw new StudioGenerationError('The gateway did not return a generation key.')
    return data
}
export async function fetchStudioModels(signal?: AbortSignal): Promise<StudioModel[]> {
    const data = await callApi<{models: StudioModel[]}>('studio-models', {signal})
    return Array.isArray(data.models) ? data.models : []
}

// Polling cadence per §2.1: 3s for the first five checks, then 5s; stop at a terminal state.
export function nextPollDelay(completedPolls: number): number {return completedPolls < 5 ? 3000 : 5000}
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (!signal) {setTimeout(resolve, ms); return}
    const done = () => {signal.removeEventListener('abort', onAbort); clearTimeout(timer); resolve()}
    const onAbort = () => {clearTimeout(timer); signal.removeEventListener('abort', onAbort);
        reject(signal.reason instanceof Error ? signal.reason : new Error('Generation polling was cancelled.'))}
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', onAbort)
})
export async function pollGeneration(generationKey: string, options: {signal?: AbortSignal; delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
    onState?: (state: GenerationState) => void; maxPolls?: number; journalClientRequestId?: string} = {}): Promise<GenerationState> {
    const delay = options.delay ?? (ms => sleep(ms, options.signal))
    const maxPolls = options.maxPolls ?? 360
    for (let poll = 0; poll < maxPolls; poll++) {
        if (options.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new Error('Generation polling was cancelled.')
        const state = await fetchGeneration(generationKey, options.signal)
        options.onState?.(state)
        if (state.status === 'succeeded' || state.status === 'failed') {
            if (options.journalClientRequestId) forgetGeneration(options.journalClientRequestId)
            return state
        }
        await delay(nextPollDelay(poll), options.signal)
    }
    throw new StudioGenerationError('The generation is taking unusually long. Check back later.', undefined, 'generation_timeout')
}
