import test from 'node:test'
import assert from 'node:assert/strict'
import {studioWorker} from '../server/studio-site.mjs'

test('media proxy preserves range playback and isolates visitor credentials from public build assets',async t=>{
    const base='https://cdn.example/releases/42'
    const paths=[]
    t.mock.method(globalThis,'fetch',async (url,request)=>{
        paths.push(url)
        assert.equal(request.headers.get('Cookie'),null)
        assert.equal(request.headers.get('oai-authenticated-user-id'),null)
        return request.headers.has('Range') ? new Response('bc',{status:206,headers:{'Content-Range':'bytes 1-2/4','Content-Type':'video/mp4'}}) : new Response('<!doctype html>')
    })
    const site=studioWorker(base,['/film.mp4','/index.html'])
    const get=(path,headers)=>site.fetch(new Request('https://studio.example'+path,{headers}),{})
    const res=await get('/film.mp4',{range:'bytes=1-2',Cookie:'session=abc','oai-authenticated-user-id':'alice'})
    assert.equal(res.status,206); assert.equal(await res.text(),'bc'); assert.equal(res.headers.get('Content-Range'),'bytes 1-2/4')
    assert.equal(res.headers.get('Cross-Origin-Embedder-Policy'),'require-corp')
    assert.equal((await get('/create',{'Accept':'text/html'})).status,200)
    assert.equal((await get('/missing.wav')).status,404)
    assert.equal((await get('/api/projects')).status,401)
    assert.deepEqual(paths,[base+'/film.mp4',base+'/'])
})

test('reused media is pinned to its own release for range requests and redirects',async t=>{
    const active='b'.repeat(24),old='a'.repeat(24),origin='https://cdn.example/releases/'
    const worker=studioWorker(origin+active,['/index.html','/source.html','/clip.mp4'],{'/source.html':old,'/clip.mp4':old})
    const calls=[]
    t.mock.method(globalThis,'fetch',async(url,init)=>{
        calls.push(url)
        assert.equal(init.headers.get('authorization'),null)
        if(url.endsWith('/source.html'))return Response.redirect(origin+old+'/source',301)
        if(url.endsWith('/clip.mp4'))return Response.redirect(origin+active+'/clip.mp4',302)
        return new Response('ok')
    })
    const request=path=>worker.fetch(new Request('https://studio.example'+path,{headers:{Authorization:'private'}}),{})
    assert.equal((await request('/')).status,200)
    assert.equal((await request('/source.html')).status,200)
    assert.equal((await request('/clip.mp4')).status,502)
    assert.equal((await request('/unknown')).status,404)
    assert.deepEqual(calls,[origin+active+'/',origin+old+'/source.html',origin+old+'/source',origin+old+'/clip.mp4'])
    assert.throws(()=>studioWorker(origin+active,['/clip.mp4'],{'/clip.mp4':'https://another.example/'}))
    assert.throws(()=>studioWorker(origin+active,['/clip.mp4'],{'/absent':old}))
})
