import {createHash} from 'node:crypto'
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs'
import {join,resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
const repo=dirname(fileURLToPath(import.meta.url)), build=process.argv[2]
if(!build) throw new Error('Pass the complete built Studio dist directory.')
// Stage on the same volume so that a half-written release is never exposed.
const temp=mkdtempSync(join(repo,'.studio-static-release-'))
try {
    cpSync(join(repo,'prepare-static.mjs'),join(temp,'prepare-static.mjs'))
    execFileSync(process.execPath,[join(temp,'prepare-static.mjs'),resolve(build)],{stdio:'inherit'})
    const ready=join(temp,'dist')
    const paths=readdirSync(ready,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>join(e.parentPath,e.name).slice(ready.length)).sort()
    const hash=createHash('sha256')
    for(const path of paths) hash.update(path).update(readFileSync(ready+path))
    const version=hash.digest('hex').slice(0,24)
    const dist=join(repo,'dist'), releases=join(dist,'releases'),destination=join(releases,version)
    mkdirSync(releases,{recursive:true})
    const existing=readdirSync(releases,{withFileTypes:true})
        .filter(entry=>entry.isDirectory() && /^[0-9a-f]{24}$/.test(entry.name) && entry.name!==version)
        .map(entry=>entry.name).sort()
    const staged=join(temp,'changed'), revisions={}
    mkdirSync(staged)
    let written=0,bytes=0
    for(const path of paths) {
        const contents=readFileSync(ready+path)
        if(existsSync(destination+path)) {
            if(!contents.equals(readFileSync(destination+path))) throw new Error('Immutable release conflict: '+path)
            continue
        }
        const reused=existing.find(revision=>{
            const candidate=join(releases,revision)+path
            if(!existsSync(candidate)) return false
            const stat=statSync(candidate)
            return stat.isFile() && stat.size===contents.length && contents.equals(readFileSync(candidate))
        })
        if(reused) {revisions[path]=reused;continue}
        if(existsSync(destination)) throw new Error('Incomplete immutable release: '+path)
        mkdirSync(dirname(staged+path),{recursive:true})
        writeFileSync(staged+path,contents)
        written++;bytes+=contents.length
    }
    if(!existsSync(destination)) renameSync(staged,destination)
    writeFileSync(join(dist,'index.html'),'<!doctype html><meta charset="utf-8"><title>Flowtu Studio</title><a href="https://flowtu-score-lite-studio.coykaka.chatgpt.site/">Open Flowtu Studio</a>')
    writeFileSync(join(temp,'release.json'),JSON.stringify({version,paths,revisions},null,2)+'\n')
    renameSync(join(temp,'release.json'),join(repo,'release.json'))
    console.log('Prepared '+paths.length+' paths for '+version+'; wrote '+written+' files ('+bytes+' bytes).')
} finally {rmSync(temp,{recursive:true,force:true})}
