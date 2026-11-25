import {cloudProjects} from './project-cloud.mjs'

// Baked into the release by the hosting build. No account or request credentials are forwarded to the public assets site.
export function studioWorker(assetsBase,assetPaths,revisions={}) {
    const files=new Set(assetPaths)
    const origin=new URL(assetsBase).origin
    const pinned=new Map()
    for(const [path,revision] of Object.entries(revisions)) {
        if(!files.has(path) || typeof revision!=='string' || !/^[0-9a-f]{24}$/.test(revision)) throw new Error('Invalid pinned asset revision.')
        pinned.set(path,new URL(revision,assetsBase).href)
    }
    return {async fetch(request,env) {
        const {pathname}=new URL(request.url)
        try {
            if(pathname==='/api/projects' || pathname.startsWith('/api/projects/')) return await cloudProjects(request,env)
            if(pathname==='/api/flowtu/score-vision' && request.method==='GET') return Response.json({configured:false})
            if(pathname.startsWith('/api/')) return new Response(null,{status:404})
            if(request.method!=='GET' && request.method!=='HEAD') return new Response(null,{status:405})
            const decoded=decodeURIComponent(pathname)
            const path=files.has(decoded) ? decoded : (request.headers.get('Accept')??'').includes('text/html') || pathname==='/' ? '/index.html' : undefined
            if(!path || !files.has(path)) return new Response(null,{status:404})
            const headers=new Headers()
            for(const key of ['range','if-none-match','if-modified-since','if-range']) {
                const value=request.headers.get(key)
                if(value)headers.set(key,value)
            }
            const canonical=path==='/index.html'?'/':path.split('/').map(encodeURIComponent).join('/')
            const fileBase=pinned.get(path)??assetsBase
            let url=fileBase+canonical
            const options={method:request.method,headers,redirect:'manual'}
            let upstream=await fetch(url,options)
            // Static Sites canonicalizes HTML names, e.g. source.html to source.
            for(let n=0;n<3 && [301,302,303,307,308].includes(upstream.status);n++) {
                const location=upstream.headers.get('location')
                if(!location) break
                const next=new URL(location,url)
                if(next.origin!==origin || !next.pathname.startsWith(new URL(fileBase).pathname+'/')) break
                url=next.href
                upstream=await fetch(url,options)
            }
            if(upstream.status>=300 && upstream.status<400 && upstream.status!==304) return new Response('Studio assets are unavailable.',{status:502})
            const responseHeaders=new Headers()
            for(const key of ['content-type','content-length','content-encoding','content-range','accept-ranges','last-modified','etag','cache-control']) {
                const value=upstream.headers.get(key)
                if(value)responseHeaders.set(key,value)
            }
            responseHeaders.set('Cross-Origin-Opener-Policy','same-origin')
            responseHeaders.set('Cross-Origin-Embedder-Policy','require-corp')
            responseHeaders.set('Cross-Origin-Resource-Policy','same-origin')
            if(path==='/index.html') responseHeaders.set('Cache-Control','no-cache')
            return new Response(upstream.body,{status:upstream.status,headers:responseHeaders})
        } catch(error) {
            console.error('Studio request failed',error instanceof Error?error.name:'Error')
            return Response.json({error:'This request could not be completed. Please retry.'},{status:503,headers:{'Cache-Control':'no-store'}})
        }
    }}
}
