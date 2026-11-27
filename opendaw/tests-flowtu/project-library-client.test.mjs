import test from 'node:test'
import assert from 'node:assert/strict'
import {cloudLibrary, deleteCloudProject, syncRequestHeaders, ProjectConflict} from '../src/flowtu/project-library.ts'

// Installs a fetch stub that records every call. Handlers receive (url, init) and return a Response.
function withFetch(handler) {
    const calls = []
    const original = globalThis.fetch
    globalThis.fetch = async (url, init) => {calls.push({url: String(url), init: init ?? {}}); return handler(url, init)}
    return {calls, restore: () => {globalThis.fetch = original}}
}
const entry = {owner: 'account:u1', id: 'p1', name: 'Demo', size: 1, updatedAt: '', version: 'v1', revision: 'r1', pending: false}

test('cloud library reads the studio sync endpoint and treats 401 as guest', async () => {
    const stub = withFetch(() => Response.json({accountId: 'u1', projects: [{id: 'p1', name: 'Demo', revision: 'r1', updatedAt: '2026-11-25T00:00:00Z', size: 10}]}))
    try {
        const status = await cloudLibrary()
        assert.equal(status.kind, 'online')
        assert.equal(status.library.accountId, 'u1')
        assert.equal(stub.calls[0].url, '/api/e/studio/projects')
        assert.equal(stub.calls[0].init.credentials, 'same-origin')
    } finally {stub.restore()}
    const guest = withFetch(() => new Response(null, {status: 401}))
    try {assert.equal((await cloudLibrary()).kind, 'guest')}
    finally {guest.restore()}
})

test('sync headers express the optimistic-lock protocol and the generation link', () => {
    const update = syncRequestHeaders(entry)
    assert.equal(update['If-Match'], '"r1"')
    assert.ok(!('If-None-Match' in update))
    assert.equal(update['X-Project-Account'], 'u1')
    assert.equal(update['X-Project-Name'], encodeURIComponent('Demo'))
    const fresh = syncRequestHeaders({...entry, revision: undefined})
    assert.equal(fresh['If-None-Match'], '*')
    assert.ok(!('If-Match' in fresh))
    const linked = syncRequestHeaders(entry, 'gen-abc123')
    assert.equal(linked['X-Studio-Generation-Key'], 'gen-abc123')
})

test('cloud deletion targets the sync endpoint and maps HTTP errors to project semantics', async () => {
    const stub = withFetch(() => new Response(null, {status: 204}))
    try {
        await deleteCloudProject('account:u1', 'p1', 'r1')
        assert.equal(stub.calls[0].url, '/api/e/studio/projects/p1')
        assert.equal(stub.calls[0].init.method, 'DELETE')
        assert.equal(stub.calls[0].init.credentials, 'same-origin')
        assert.equal(stub.calls[0].init.headers['If-Match'], '"r1"')
        assert.equal(stub.calls[0].init.headers['X-Project-Account'], 'u1')
    } finally {stub.restore()}
    // A project already gone on the server still counts as deleted.
    const missing = withFetch(() => new Response(null, {status: 404}))
    try {await deleteCloudProject('account:u1', 'p1', 'r1')}
    finally {missing.restore()}
    const stale = withFetch(() => new Response(null, {status: 412}))
    try {await assert.rejects(deleteCloudProject('account:u1', 'p1', 'r1'), ProjectConflict)}
    finally {stale.restore()}
    const signedOut = withFetch(() => new Response(null, {status: 401}))
    try {await assert.rejects(deleteCloudProject('account:u1', 'p1', 'r1'), /Sign in on flowtu.cn/)}
    finally {signedOut.restore()}
    const refused = withFetch(() => Response.json({error: 'quota_exceeded'}, {status: 409}))
    try {await assert.rejects(deleteCloudProject('account:u1', 'p1', 'r1'), /quota_exceeded/)}
    finally {refused.restore()}
    // A first deletion without a known revision omits If-Match.
    const unconditional = withFetch(() => new Response(null, {status: 204}))
    try {
        await deleteCloudProject('account:u1', 'p1')
        assert.ok(!('If-Match' in unconditional.calls[0].init.headers))
    } finally {unconditional.restore()}
})


test('sync uses the same host Bearer login as generation, alongside the account guard', async () => {
    globalThis.localStorage = {getItem: key => key === 'flowtu_go_jwt' ? 'fixture-jwt' : null}
    const stub = withFetch((url, init) => {
        assert.equal(init.headers.Authorization, 'Bearer fixture-jwt')
        if (init.method === 'DELETE') return new Response(null, {status: 204})
        return Response.json({accountId: 'u1', projects: []})
    })
    try {
        assert.equal((await cloudLibrary()).kind, 'online')
        await deleteCloudProject('account:u1', 'p1')
        const headers = syncRequestHeaders(entry)
        assert.equal(headers.Authorization, 'Bearer fixture-jwt')
        assert.equal(headers['X-Project-Account'], 'u1')
    } finally {stub.restore(); delete globalThis.localStorage}
})
