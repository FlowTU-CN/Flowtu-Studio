import test from 'node:test'
import {studioAudioHeaders, fetchStudioAudio} from '../src/flowtu/studio-audio.ts'
import assert from 'node:assert/strict'
import {buildGenerationRequest, toApiDirection, fromApiDirection, toApiStyle, fromApiStyle, submitGeneration, pollGeneration,
    nextPollDelay, fetchGeneration, fetchStudioModels, listProjectGenerations, regenerateGeneration,
    pendingGenerations, resumeGeneration, generationFailureMessage, forgetGeneration, StudioGenerationError, isAuthError, isCreditsError} from '../src/flowtu/studio-generations.ts'

function withFetch(handler) {
    const calls = []
    const original = globalThis.fetch
    globalThis.fetch = async (url, init) => {calls.push({url: String(url), init: init ?? {}}); return handler(url, init)}
    return {calls, restore: () => {globalThis.fetch = original}}
}
function withStorage() {
    const map = new Map()
    globalThis.localStorage = {getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key)}
    return {map, restore: () => {delete globalThis.localStorage}}
}
const model = {model: 'mureka-9.5', label: 'Mureka 9.5', maxCount: 2, creditHint: 15,
    capabilities: {withLyrics: true, instrumental: true, refAudio: true, refMidi: true, humming: false, refImage: false}}
const okEnvelope = data => Response.json({ok: true, code: 200, message: 'success', logid: 'log-1', data})

test('direction pads convert between bipolar dials and centered API coordinates', () => {
    const api = toApiDirection({style: 'cinematic', melody: 30, arrangement: -20, emotion: 40, character: -10})
    assert.deepEqual(api, {melodyArrangement: {x: 80, y: 30}, emotionStyle: {x: 90, y: 40}})
    assert.deepEqual(fromApiDirection(api), {melody: 30, arrangement: -20, emotion: 40, character: -10})
    // Out-of-range dials clamp into the pad bounds.
    assert.deepEqual(toApiDirection({style: 'ambient', melody: 200, arrangement: -200, emotion: 0, character: 100}),
        {melodyArrangement: {x: 100, y: 0}, emotionStyle: {x: 50, y: 100}})
    // A neutral prompt direction carries no information and is omitted entirely.
    assert.equal(toApiDirection({style: 'prompt', melody: 0, arrangement: 0, emotion: 0, character: 0}), undefined)
    assert.equal(toApiDirection(undefined), undefined)
    assert.equal(fromApiDirection(undefined), undefined)
    assert.equal(toApiStyle('prompt'), 'follow')
    assert.equal(fromApiStyle('follow'), 'prompt')
    assert.equal(fromApiStyle('electronic'), 'electronic')
})

test('request assembly validates input and mirrors the 1124 field contract', () => {
    const input = {prompt: '  紧张悬疑的追逐段落  ', contentType: 'instrumental', model: 'mureka-9.5', count: 2,
        style: 'electronic', direction: {style: 'cinematic', melody: 30, arrangement: -20, emotion: 40, character: -10},
        inSec: 12.3456, outSec: 30, refAudioKeys: ['s-1']}
    assert.deepEqual(buildGenerationRequest(input, 'req-1', model), {
        clientRequestId: 'req-1', prompt: '紧张悬疑的追逐段落', lyrics: '', contentType: 'instrumental',
        model: 'mureka-9.5', count: 2, style: 'electronic', refAudioKeys: ['s-1'],
        direction: {melodyArrangement: {x: 80, y: 30}, emotionStyle: {x: 90, y: 40}},
        inSec: 12.346, outSec: 30})
    // A prompt-following style maps to "follow"; optional keys stay absent when empty.
    const minimal = buildGenerationRequest({prompt: 'ambience', contentType: 'instrumental', model: 'mureka-9.5',
        style: 'prompt', inSec: 0, outSec: 8}, 'req-2', model)
    assert.equal(minimal.style, 'follow')
    assert.ok(!('direction' in minimal) && !('refAudioKeys' in minimal) && !('hummingKey' in minimal))
    const rejects = (overrides, code) => assert.throws(() =>
        buildGenerationRequest({...input, ...overrides}, 'req-x', model), error => error instanceof StudioGenerationError && error.code === code)
    rejects({prompt: '   '}, 'invalid_params')
    rejects({count: 3}, 'invalid_params')
    rejects({contentType: 'withLyrics', lyrics: '  '}, 'invalid_params')
    rejects({inSec: 30, outSec: 30}, 'invalid_time_range')
    rejects({outSec: -1}, 'invalid_time_range')
    rejects({hummingKey: 'up-1'}, 'model_capability')
    const lyricModel = {...model, capabilities: {...model.capabilities, withLyrics: false}}
    assert.throws(() => buildGenerationRequest({...input, contentType: 'withLyrics', lyrics: '词'}, 'req-x', lyricModel),
        error => error.code === 'model_capability')
})

test('submissions carry the Bearer session, parse the envelope and journal idempotency', async () => {
    const storage = withStorage()
    const stub = withFetch((url, init) => {
        assert.equal(String(url), '/api/e/me/studio-generations')
        assert.equal(init.method, 'POST')
        assert.equal(init.credentials, 'same-origin')
        assert.equal(init.headers.Authorization, 'Bearer jwt-1')
        const body = JSON.parse(init.body)
        assert.equal(body.clientRequestId.length, 36)
        return okEnvelope({generationKey: 'gen-1', status: 'running', estimatedSeconds: 60, billing: {credits: 15}})
    })
    storage.map.set('flowtu_go_jwt', 'jwt-1')
    try {
        const result = await submitGeneration({prompt: 'chase', contentType: 'instrumental', model: 'mureka-9.5', inSec: 0, outSec: 12.35}, model)
        assert.equal(result.generationKey, 'gen-1')
        assert.equal(result.billing.credits, 15)
        const journal = pendingGenerations()
        assert.equal(journal.length, 1)
        assert.equal(journal[0].generationKey, 'gen-1')
        assert.equal(journal[0].request.inSec, 0)
    } finally {stub.restore(); storage.restore()}
})

test('a server-rejected submission clears the journal, a network failure keeps it', async () => {
    const storage = withStorage()
    const insufficient = withFetch(() => Response.json({ok: false, code: 402, error: 'insufficient_credits', message: '积分不足', data: null}, {status: 402}))
    try {
        await assert.rejects(submitGeneration({prompt: 'x', contentType: 'instrumental', model: 'mureka-9.5', inSec: 1, outSec: 2}, model),
            error => isCreditsError(error) && error.status === 402)
        assert.equal(pendingGenerations().length, 0)
    } finally {insufficient.restore()}
    const offline = withFetch(() => {throw new TypeError('fetch failed')})
    try {
        await assert.rejects(submitGeneration({prompt: 'x', contentType: 'instrumental', model: 'mureka-9.5', inSec: 1, outSec: 2}, model), TypeError)
        assert.equal(pendingGenerations().length, 1)
        forgetGeneration(pendingGenerations()[0].clientRequestId)
        assert.equal(pendingGenerations().length, 0)
    } finally {offline.restore(); storage.restore()}
    assert.ok(isAuthError(new StudioGenerationError('gone', 401, 'unauthenticated')))
    assert.ok(!isCreditsError(new StudioGenerationError('no', 429, 'rate_limit')))
})

test('polling walks 3s then 5s, stops at terminal states and retires the journal entry', async () => {
    const storage = withStorage()
    storage.map.set('flowtu.studio-generations.v1', JSON.stringify([{clientRequestId: 'req-1', generationKey: 'gen-1', request: {}, submittedAt: 0}]))
    let polls = 0
    const stub = withFetch(url => {
        assert.equal(String(url), '/api/e/me/studio-generations/gen-1')
        polls++
        return okEnvelope(polls < 3
            ? {generationKey: 'gen-1', status: 'running'}
            : {generationKey: 'gen-1', status: 'succeeded', errorCode: null,
                songs: [{songKey: 's-1', title: 'Demo', durationMs: 180000, playUrl: 'https://signed.example/a', coverUrl: null}]})
    })
    try {
        const delays = []
        const states = []
        const state = await pollGeneration('gen-1', {delay: async ms => delays.push(ms), onState: s => states.push(s.status), journalClientRequestId: 'req-1'})
        assert.equal(state.status, 'succeeded')
        assert.equal(state.songs[0].songKey, 's-1')
        assert.deepEqual(delays, [3000, 3000])
        assert.deepEqual(states, ['running', 'running', 'succeeded'])
        assert.equal(pendingGenerations().length, 0)
        assert.equal(nextPollDelay(4), 3000)
        assert.equal(nextPollDelay(5), 5000)
    } finally {stub.restore(); storage.restore()}
})

test('a failed generation resolves with its error code and polling can time out', async () => {
    let polls = 0
    const failed = withFetch(() => okEnvelope({generationKey: 'gen-2', status: 'failed', errorCode: 'generation_failed'}))
    try {
        const state = await pollGeneration('gen-2', {delay: async () => {}})
        assert.equal(state.status, 'failed')
        assert.equal(state.errorCode, 'generation_failed')
    } finally {failed.restore()}
    const endless = withFetch(() => {polls++; return okEnvelope({generationKey: 'gen-3', status: 'running'})})
    try {
        await assert.rejects(pollGeneration('gen-3', {delay: async () => {}, maxPolls: 3}),
            error => error instanceof StudioGenerationError && error.code === 'generation_timeout')
        assert.equal(polls, 3)
    } finally {endless.restore()}
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(pollGeneration('gen-3', {signal: controller.signal, delay: async () => {}}), Error)
})

test('models, per-project history and regeneration use the contracted endpoints', async () => {
    const models = withFetch(url => {
        assert.equal(String(url), '/api/e/me/studio-models')
        return okEnvelope({models: [model]})
    })
    try {assert.deepEqual(await fetchStudioModels(), [model])} finally {models.restore()}
    const history = withFetch(url => {
        assert.equal(String(url), '/api/e/me/studio-generations?projectId=p1')
        return okEnvelope({generations: [{generationKey: 'gen-9', songs: [{songKey: 's-9', title: 'T', durationMs: 1, playUrl: 'u', coverUrl: null}],
            input: {prompt: 'p', lyrics: '', contentType: 'instrumental', model: 'mureka-9.5', count: 1, style: 'follow',
                direction: {melodyArrangement: {x: 80, y: 30}, emotionStyle: {x: 90, y: 40}}, inSec: 1, outSec: 2}}]})
    })
    try {
        const records = await listProjectGenerations('p1')
        assert.equal(records[0].generationKey, 'gen-9')
        assert.equal(fromApiStyle(records[0].input.style), 'prompt')
        assert.deepEqual(fromApiDirection(records[0].input.direction), {melody: 30, arrangement: -20, emotion: 40, character: -10})
    } finally {history.restore()}
    const again = withFetch((url, init) => {
        assert.equal(String(url), '/api/e/me/studio-generations/gen-9/regenerate')
        assert.equal(init.method, 'POST')
        assert.equal(init.body, undefined)
        return okEnvelope({generationKey: 'gen-10', status: 'running'})
    })
    try {
        const result = await regenerateGeneration('gen-9')
        assert.equal(result.generationKey, 'gen-10')
    } finally {again.restore()}
})


test('502 preserves the exact request; scoped recovery reuses its key and deduplicates concurrent retries', async () => {
    const storage = withStorage(), context = {accountId: 'u1', projectScope: 'local-project-1'}
    const requests = []
    let phase = 'fail'
    const stub = withFetch((url, init) => {
        requests.push(JSON.parse(init.body))
        // A business code is not an HTTP status; classification must use response.status.
        if (phase === 'fail') return Response.json({ok: false, code: 1001, error: 'upstream_failed'}, {status: 502})
        return okEnvelope({generationKey: 'gen-partial', status: 'running', partial: true, billing: {credits: 15}, replayed: true})
    })
    try {
        await assert.rejects(submitGeneration({projectId: 'cloud-p1', prompt: 'x', count: 2, contentType: 'instrumental', model: model.model, inSec: 0, outSec: 2}, model, {context}), e => e.status === 502)
        const [entry] = pendingGenerations(context)
        assert.equal(entry.request.projectId, 'cloud-p1')
        assert.equal(pendingGenerations({...context, accountId: 'u2'}).length, 0)
        assert.equal(pendingGenerations({...context, projectScope: 'other'}).length, 0)
        await assert.rejects(resumeGeneration(entry.clientRequestId, {...context, accountId: 'u2'}))
        assert.equal(requests.length, 1)
        phase = 'success'
        const [first, second] = await Promise.all([resumeGeneration(entry.clientRequestId, context), resumeGeneration(entry.clientRequestId, context)])
        assert.deepEqual(first, second)
        assert.deepEqual(requests[0], requests[1])
        assert.equal(requests.length, 2)
        assert.equal(first.partial, true)
        assert.equal(first.billing.credits, 15)
        const resumed = await resumeGeneration(entry.clientRequestId, context)
        assert.equal(resumed.generationKey, 'gen-partial')
        assert.equal(resumed.partial, true)
        assert.equal(requests.length, 2, 'known generation keys resume polling without another POST')
    } finally {stub.restore(); storage.restore()}
})

test('malformed success stays recoverable and disabled references are rejected before submission', async () => {
    const storage = withStorage(), stub = withFetch(() => okEnvelope({status: 'running'}))
    try {
        const input = {prompt: 'x', model: model.model, contentType: 'instrumental', inSec: 0, outSec: 2}
        await assert.rejects(submitGeneration(input, model))
        assert.equal(pendingGenerations().length, 1)
        assert.throws(() => buildGenerationRequest({...input, refAudioKeys: ['old-ref']}, 'req', {...model, capabilities: {...model.capabilities, refAudio: false}}), e => e.code === 'model_capability')
        const state = {generationKey: 'g', status: 'failed', errorCode: 'upstream_client_error', songs: [{failLabel: '生成请求被拒绝', failMessage: '请调整内容后重试'}]}
        assert.equal(generationFailureMessage(state), '请调整内容后重试')
        assert.equal(generationFailureMessage({...state, songs: [{failLabel: '生成请求被拒绝'}]}), '生成请求被拒绝')
        assert.equal(generationFailureMessage({...state, songs: []}), undefined)
    } finally {stub.restore(); storage.restore()}
})


test('audio sends Bearer only to same-origin ext endpoints and rejects non-audio responses', async () => {
    const storage = withStorage(); storage.map.set('flowtu_go_jwt', 'fixture-jwt')
    try {
        assert.equal(studioAudioHeaders('/api/e/me/songs/s1/audio', 'https://dev.flowtu.cn/studio/').Authorization, 'Bearer fixture-jwt')
        assert.deepEqual(studioAudioHeaders('https://oss.example/audio.mp3', 'https://dev.flowtu.cn/studio/'), {})
        assert.deepEqual(studioAudioHeaders('https://dev.flowtu.cn.evil.example/api/e/audio', 'https://dev.flowtu.cn/studio/'), {})
        assert.deepEqual(studioAudioHeaders('/other/audio', 'https://dev.flowtu.cn/studio/'), {})
        const stub = withFetch((url, init) => {
            assert.equal(init.headers.Authorization, 'Bearer fixture-jwt')
            return new Response(new Blob(['audio'], {type:'audio/mpeg'}))
        })
        try {assert.equal((await fetchStudioAudio('/api/e/me/songs/s1/audio')).size, 5)} finally {stub.restore()}
        const html = withFetch(() => new Response('<html>login</html>', {headers:{'Content-Type':'text/html'}}))
        try {await assert.rejects(fetchStudioAudio('/api/e/me/songs/s1/audio'), /could not be downloaded/)} finally {html.restore()}
    } finally {storage.restore()}
})


test('lyrics-only songs are accepted and switching to instrumental omits stale lyrics', () => {
    const vocal = buildGenerationRequest({prompt:' ',lyrics:'  雨落在空站台  ',contentType:'withLyrics',model:model.model,inSec:0,outSec:10},'req-lyrics',model)
    assert.equal(vocal.prompt,'')
    assert.equal(vocal.lyrics,'雨落在空站台')
    const instrumental = buildGenerationRequest({prompt:'soft piano',lyrics:'old lyrics',contentType:'instrumental',model:model.model,inSec:0,outSec:10},'req-instrumental',model)
    assert.equal(instrumental.lyrics,'')
})
