import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
const release=JSON.parse(readFileSync(new URL('./release.json',import.meta.url)))
if(!/^https:\/\/[a-z0-9.-]+\.chatgpt\.site$/.test(release.origin) || !/^[a-f0-9]{24}$/.test(release.version)) throw new Error('Invalid static asset release.')
if(!Array.isArray(release.paths) || !release.paths.includes('/index.html') ||
    release.paths.some(path=>typeof path!=='string' || !path.startsWith('/') ||
        path.slice(1).split('/').some(part=>!part || part==='.' || part==='..' || part.includes('\\')))) throw new Error('Invalid release paths.')
const revisions=release.revisions??{}
if(typeof revisions!=='object' || Array.isArray(revisions) ||
    Object.entries(revisions).some(([path,revision])=>!release.paths.includes(path) || typeof revision!=='string' || !/^[a-f0-9]{24}$/.test(revision))) {
    throw new Error('Invalid pinned asset revision.')
}
const cloud=readFileSync(new URL('./server/project-cloud.mjs',import.meta.url),'utf8').replace('export async function cloudProjects','async function cloudProjects')
const pages=readFileSync(new URL('./server/studio-site.mjs',import.meta.url),'utf8').replace("import {cloudProjects} from './project-cloud.mjs'",'').replace('export function studioWorker','function studioWorker')
const handler=cloud+'\n'+pages+'\nexport default studioWorker('+JSON.stringify(release.origin+'/releases/'+release.version)+','+JSON.stringify(release.paths)+','+JSON.stringify(revisions)+')\n'
mkdirSync(new URL('./dist/server/',import.meta.url),{recursive:true})
writeFileSync(new URL('./dist/server/index.js',import.meta.url),handler)
