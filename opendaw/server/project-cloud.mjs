const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i
const maxPart = 16 * 1024 * 1024
const privacy = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie'}
function json(data,status=200) {return Response.json(data,{status,headers:privacy})}
function fail(status,message) {return json({error:message},status)}
function dataKey(owner,id,upload,i) {return 'data/'+owner+'/'+id+'/'+upload+'/'+i}
const isCount = (n,max) => Number.isSafeInteger(n) && n>0 && n<=max
async function readPart(request) {
    const stream=request.body?.getReader()
    if (!stream) return null
    const chunks=[]
    let size=0
    for (;;) {
        const {done,value}=await stream.read()
        if(done) break
        size+=value.byteLength
        if(size>maxPart){await stream.cancel();return null}
        chunks.push(value)
    }
    return size ? new Blob(chunks).arrayBuffer() : null
}
async function streamProject(bucket, owner, id, record, revision) {
    const {upload,parts,size}=record
    let index=0, reader=null
    const stream=new ReadableStream({
        async pull(controller) {
            for (;;) {
                if (!reader) {
                    if(index===parts){controller.close();return}
                    const part=await bucket.get(dataKey(owner,id,upload,index++))
                    if(!part) throw new Error('Incomplete cloud project.')
                    reader=part.body.getReader()
                }
                const {done,value}=await reader.read()
                if(!done){controller.enqueue(value);return}
                reader.releaseLock();reader=null
            }
        },
        async cancel(){if(reader) await reader.cancel()}
    })
    return new Response(stream,{headers:{...privacy,'Content-Type':'application/octet-stream','Content-Length':String(size),'ETag':'"'+revision+'"'}})
}
export async function cloudProjects(request,env) {
    const url=new URL(request.url), visitor=request.headers.get('oai-authenticated-user-id')
    if(!visitor) return fail(401,'Sign in to access your cloud projects.')
    const owner=encodeURIComponent(visitor), bucket=env.BUCKET
    const expectedAccount=request.headers.get('X-Project-Account')
    if(expectedAccount!==null && expectedAccount!==visitor) return fail(409,'The signed-in account changed.')
    if(!bucket) return fail(503,'Project storage is unavailable.')
    const prefix='projects/'+owner+'/'
    if(url.pathname==='/api/projects' && request.method==='GET') {
        const projects=[]
        let cursor
        do {
            const batch=await bucket.list({prefix,cursor,include:['customMetadata']})
            for(const object of batch.objects) {
                const m=object.customMetadata
                projects.push({id:object.key.slice(prefix.length),name:m.name,updatedAt:m.updatedAt,revision:m.revision,size:Number(m.size)})
            }
            cursor=batch.truncated?batch.cursor:undefined
        } while(cursor)
        projects.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))
        return json({accountId:visitor,projects})
    }
    const [,api,projects,id,uploads,uploadId,index,...extra]=url.pathname.split('/')
    if(api!=='api' || projects!=='projects' || !uuid.test(id) || extra.length) return fail(404,'Project not found.')
    const key=prefix+id
    if(request.method==='GET' && !uploads) {
        const result=await bucket.get(key)
        if(!result) return fail(404,'Project not found.')
        const match=request.headers.get('If-Match')
        if(match && match!=='"'+result.customMetadata.revision+'"') return fail(412,'Another device saved a newer revision.')
        return streamProject(bucket,owner,id,await result.json(),result.customMetadata.revision)
    }
    if(request.method==='DELETE') {
        if(!expectedAccount) return fail(400,'Expected account is required.')
        const current=await bucket.head(key)
        if(!current) return fail(404,'Project not found.')
        const match=request.headers.get('If-Match')
        if(match && match!=='"'+current.customMetadata.revision+'"') return fail(412,'A newer revision exists. Refresh before deleting.')
        await bucket.delete(key)
        let cursor
        do {
            const batch=await bucket.list({prefix:'data/'+owner+'/'+id+'/',cursor})
            for(const object of batch.objects) await bucket.delete(object.key)
            cursor=batch.truncated?batch.cursor:undefined
        } while(cursor)
        return new Response(null,{status:204,headers:privacy})
    }
    if(request.method!=='PUT') return fail(405,'Unsupported request.')
    if(request.headers.get('Origin') && request.headers.get('Origin')!==url.origin) return fail(403,'Cross-origin write denied.')
    if(!expectedAccount) return fail(400,'Expected account is required.')
    if(uploads) {
        if(uploads!=='uploads' || !uuid.test(uploadId) || !/^(0|[1-9]\d{0,3})$/.test(index)) return fail(400,'Invalid upload part.')
        const bytes=await readPart(request)
        if(!bytes) return fail(413,'A part must contain up to 16 MiB.')
        const partKey=dataKey(owner,id,uploadId,Number(index))
        const checksum=await crypto.subtle.digest('SHA-256',bytes)
        const opts={onlyIf:{etagDoesNotMatch:'*'},sha256:checksum}
        if(!await bucket.put(partKey,bytes,opts)) {
            const stored=await bucket.head(partKey)
            const hash=stored?.checksums?.sha256
            if(!hash || !new Uint8Array(hash).every((n,i)=>n===new Uint8Array(checksum)[i])) return fail(409,'Upload part already contains different data.')
        }
        return new Response(null,{status:204,headers:privacy})
    }
    const current=await bucket.head(key), create=request.headers.get('If-None-Match')==='*'
    const revision=current?.customMetadata?.revision, match=request.headers.get('If-Match')
    if(!create && !match) return fail(428,'Specify the project revision.')
    if(create ? !!current : !current || match!=='"'+revision+'"') return fail(412,'A newer revision exists. Open it or save a separate copy.')
    let name
    try {name=decodeURIComponent(request.headers.get('X-Project-Name')??'').trim()} catch {return fail(400,'Invalid project name.')}
    if(!name || name.length>256) return fail(400,'Use a project name between 1 and 256 characters.')
    let upload=request.headers.get('X-Project-Upload'), parts=1, size
    if(upload) {
        parts=Number(request.headers.get('X-Project-Parts'))
        size=Number(request.headers.get('X-Project-Size'))
        if(!uuid.test(upload) || !isCount(parts,10000) || !isCount(size,maxPart*parts)) return fail(400,'Invalid upload manifest.')
        let received=0
        for(let i=0;i<parts;i+=16) {
            const batch=await Promise.all(Array.from({length:Math.min(16,parts-i)},(_,j)=>bucket.head(dataKey(owner,id,upload,i+j))))
            if(batch.some(p=>!p)) return fail(409,'Some project parts are missing.')
            received+=batch.reduce((n,p)=>n+p.size,0)
        }
        if(size!==received) return fail(409,'The upload size does not match.')
    } else {
        const bytes=await readPart(request)
        if(!bytes) return fail(413,'Split large project uploads into parts.')
        size=bytes.byteLength;upload=crypto.randomUUID()
        await bucket.put(dataKey(owner,id,upload,0),bytes)
    }
    const meta={name,updatedAt:new Date().toISOString(),revision:crypto.randomUUID(),size:String(size)}
    const stored=await bucket.put(key,JSON.stringify({upload,parts,size,revision:meta.revision}),{customMetadata:meta,onlyIf:current?{etagMatches:current.etag}:{etagDoesNotMatch:'*'}})
    if(!stored) return fail(412,'Another device saved this project first.')
    return json({id,...meta,size},create?201:200)
}
