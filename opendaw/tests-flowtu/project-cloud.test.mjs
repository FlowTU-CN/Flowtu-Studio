import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {cloudProjects} from '../server/project-cloud.mjs'

function storage() {
    const objects=new Map()
    return {
        async put(key,value,opts={}) {
            const existing=objects.get(key), condition=opts.onlyIf
            if((condition?.etagDoesNotMatch==='*' && existing) || (condition?.etagMatches && condition.etagMatches!==existing?.etag)) return null
            const bytes=Buffer.from(value), metadata={key,size:bytes.length,etag:createHash('sha256').update(bytes).digest('hex'),customMetadata:opts.customMetadata,checksums:{sha256:opts.sha256}}
            objects.set(key,{...metadata,bytes});return metadata
        },
        async get(key) {const object=objects.get(key);return object && {...object,json:()=>JSON.parse(object.bytes),body:new Blob([object.bytes]).stream()}},
        async head(key) {return objects.get(key)},
        async delete(key) {objects.delete(key)},
        async list({prefix}) {return {objects:[...objects.values()].filter(o=>o.key.startsWith(prefix)),truncated:false}},
        keys:()=>[...objects.keys()]
    }
}
test('projects are isolated by account and only a complete matching revision can become current',async()=>{
    const env={BUCKET:storage()},id=crypto.randomUUID(),partId=crypto.randomUUID(),path='/api/projects/'+id
    const api=(method,path,owner='a',headers={},body)=>cloudProjects(new Request('https://test.example'+path,{method,body,headers:{
        ...(owner?{'oai-authenticated-user-id':owner,'X-Project-Account':owner}:{}),...headers
    }}),env)
    assert.equal((await api('GET','/api/projects','')).status,401)
    const create={'If-None-Match':'*','X-Project-Name':encodeURIComponent('短片')}
    const data=await api('PUT',path,'a',create,'first')
    assert.equal(data.status,201)
    const {revision}=await data.json()
    assert.equal((await api('GET',path,'b')).status,404)
    assert.deepEqual((await (await api('GET','/api/projects','b')).json()).projects,[])
    const update={'If-Match':'"'+revision+'"','X-Project-Name':'Second'}
    const manifest={...update,'X-Project-Upload':partId,'X-Project-Parts':'2','X-Project-Size':'4'}
    assert.equal((await api('PUT',path+'/uploads/'+partId+'/0','a',{},'ab')).status,204)
    assert.equal((await api('PUT',path,'a',manifest)).status,409)
    assert.equal(await (await api('GET',path)).text(),'first')
    assert.equal((await api('PUT',path+'/uploads/'+partId+'/1','a',{},'cd')).status,204)
    assert.equal((await api('PUT',path,'a',manifest)).status,200)
    assert.equal((await api('PUT',path,'a',update,'stale')).status,412)
    assert.equal((await api('GET',path,'a',{'If-Match':update['If-Match']})).status,412)
    assert.equal((await api('PUT',path,'a',{...create,'X-Project-Account':'b'},'mismatch')).status,409)
    assert.equal(await (await api('GET',path)).text(),'abcd')
})
test('only the owner can delete a project and deletion removes its parts',async()=>{
    const bucket=storage(),env={BUCKET:bucket},id=crypto.randomUUID(),partId=crypto.randomUUID(),path='/api/projects/'+id
    const api=(method,path,owner='a',headers={},body)=>cloudProjects(new Request('https://test.example'+path,{method,body,headers:{
        ...(owner?{'oai-authenticated-user-id':owner,'X-Project-Account':owner}:{}),...headers
    }}),env)
    const created=await api('PUT',path,'a',{'If-None-Match':'*','X-Project-Name':'Demo'},'payload')
    assert.equal(created.status,201)
    const {revision}=await created.json()
    assert.equal((await api('PUT',path+'/uploads/'+partId+'/0','a',{},'part')).status,204)
    assert.equal((await api('DELETE',path,'b')).status,404)
    assert.equal((await api('DELETE',path,'a',{'If-Match':'"other"'})).status,412)
    const deleted=await api('DELETE',path,'a',{'If-Match':'"'+revision+'"'})
    assert.equal(deleted.status,204)
    assert.equal((await api('GET',path,'a')).status,404)
    assert.equal(bucket.keys().filter(key=>key.includes('/'+id+'/')).length,0)
})
