import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import {EventEmitter} from 'node:events'
import {createScoreVisionMiddleware} from '../server/score-vision.mjs'

const path = '/api/flowtu/score-vision', origin = 'http://127.0.0.1:4173'
const still = {id:'s1', start:0, end:12, keyframeTime:6, boundary:'opening', thumbnail:'data:image/jpeg;base64,/9j/2Q==',
    brightness:.4, motion:.12, warmth:-.25, contextFrames:[{time:1,thumbnail:'data:image/jpeg;base64,/9j/3w=='},{time:11,thumbnail:'data:image/jpeg;base64,/9j/4A=='}]}
const scene = {id:'s1',title:'Platform',observation:'A train at a platform',musicPrompt:'Warm piano chords',startsNewBeat:false,mood:'Expectant'}
const nowhere = async () => {throw new Error('No external request expected.')}
async function request(middleware, method = 'GET', body, headers = {}) {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
    Object.assign(req, {method,url:path,headers:{host:'127.0.0.1:4173',origin,'content-type':'application/json',...headers},socket:{remoteAddress:'127.0.0.1'}})
    const res = new EventEmitter()
    res.writeHead = (status, headers) => {res.status = status; res.headers = headers}
    res.end = value => {res.body = JSON.parse(value); res.writableEnded = true}
    await middleware(req,res,() => {throw Error('Missing middleware.')})
    return {status:res.status, body:res.body}
}

test('unconfigured local relay reports capability without contacting any provider', async () => {
    const relay = createScoreVisionMiddleware({env:{},local:async()=>({localVisionAvailable:()=>false}), fetcher:nowhere})
    assert.deepEqual(await request(relay), {status:200,body:{configured:false,provider:'none'}})
    const r = await request(relay,'POST',{scenes:[still]})
    assert.equal(r.status,503); assert.equal(r.body.code,'not_configured')
})

test('remote API receives ordered real image inputs, continuity, strict schema and server-side credential', async () => {
    const relay = createScoreVisionMiddleware({env:{OPENAI_API_KEY:'fixture'},fetcher:async (url, options) => {
        assert.equal(String(url),'https://api.openai.com/v1/responses')
        const req = JSON.parse(options.body)
        assert.equal(req.model,'gpt-4.1-mini'); assert.equal(req.store,false)
        assert.equal(req.text.format.type,'json_schema'); assert.equal(req.text.format.strict,true)
        assert.equal(options.headers.Authorization,'Bearer fixture')
        assert.deepEqual(req.input[0].content.filter(i=>i.type==='input_image').map(i=>i.image_url),[still.contextFrames[0].thumbnail,still.thumbnail,still.contextFrames[1].thumbnail])
        assert.match(req.input[0].content[0].text,/Simplified Chinese/); assert.match(req.input[0].content[0].text,/piano chords/)
        return Response.json({status:'completed',model:'gpt-fixture-2026',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({scenes:[scene]})}]}]})
    }})
    const r = await request(relay,'POST',{language:'zh-CN',scenes:[still],previous:scene})
    assert.deepEqual(r,{status:200,body:{model:'gpt-fixture-2026',scenes:[scene]}})
})

test('local classifier receives the validated frame and returns real labels with source identity', async () => {
    const relay = createScoreVisionMiddleware({env:{},fetcher:nowhere,local:async()=>({
        localVisionAvailable:()=>true, classifyLocalScenes:async(frames, _signal, language)=>{
            assert.equal(language,'en'); assert.equal(frames[0].thumbnail,still.thumbnail); return [scene]
        }
    })})
    assert.equal((await request(relay)).body.provider,'device')
    assert.equal((await request(relay,'POST',{scenes:[still]})).body.model,'Apple Vision · local')
})

test('rejects foreign origins, missing origins, forwarded hosts, invalid image data and swapped model ids', async () => {
    const relay = createScoreVisionMiddleware({env:{FLOWTU_VISION_API_KEY:'fixture'},fetcher:async()=>{
        return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({scenes:[{...scene,id:'s100'}]})}]}]})
    }})
    for (const headers of [{origin:'https://example.com'}, {origin:''}, {'x-forwarded-for':'9.9.9.9'}, {host:'example.com'}])
        assert.equal((await request(relay,'POST',{scenes:[still]},headers)).status,403)
    assert.equal((await request(relay,'POST',{scenes:[{...still,thumbnail:'https://example.com/input'}]})).status,400)
    assert.equal((await request(relay,'POST',{scenes:[still]})).status,502)
})
