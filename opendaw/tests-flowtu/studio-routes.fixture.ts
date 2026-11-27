import assert from 'node:assert/strict'
const base = import.meta.env.BASE_URL
let current = new URL('https://test.flowtu.cn' + base)
const listeners = new Map<string,()=>void>()
const canonical = {href:'',setAttribute(_key:string,value:string){this.href=value}}
Object.assign(globalThis,{
    location:current,
    document:{querySelector:()=>canonical},
    window:{addEventListener:(name:string,callback:()=>void)=>listeners.set(name,callback)},
    history:{pushState(_state:unknown,_title:string,path:string){current=new URL(path,current);Reflect.set(globalThis,'location',current)},
        replaceState(_state:unknown,_title:string,path:string){current=new URL(path,current);Reflect.set(globalThis,'location',current)}}
})
const {RouteLocation,withBase,RouteMatcher} = await import('../node_modules/@opendaw/lib-jsx/dist/routes.js')
const router=RouteLocation.get()
assert.equal(router.path,'/')
assert.equal(router.navigateTo('/create'),true)
assert.equal(current.pathname,base+'create')
assert.equal(router.path,'/create')
assert.equal(router.navigateTo('/create'),false)
assert.equal(withBase(base+'privacy'),base+'privacy','already based paths stay stable')
assert.equal(withBase('https://example.com/'),'https://example.com/')
assert.equal(withBase('//example.com/'),'//example.com/')
assert.equal(router.replaceWith('/storage'),true)
assert.equal(current.pathname,base+'storage')
assert.equal(canonical.href,current.href)
assert.equal(RouteMatcher.create([{path:'/create'},{path:'/storage'}]).resolve(router.path).unwrap().path,'/storage')
let observed=''
router.catchupAndSubscribe(location=>{observed=location.path})
current=new URL('https://test.flowtu.cn'+base+'create');Reflect.set(globalThis,'location',current)
listeners.get('popstate')!()
assert.equal(observed,'/create','browser history stays in the Studio route space')
if(base!=='/'){
    current=new URL('https://test.flowtu.cn'+base.slice(0,-1));Reflect.set(globalThis,'location',current)
    assert.equal(router.path,'/','the mount path without slash also resolves as root')
}
console.log('STUDIO_ROUTES_OK')
