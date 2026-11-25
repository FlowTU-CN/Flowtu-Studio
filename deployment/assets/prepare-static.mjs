import {createHash} from 'node:crypto'
import {cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'

// Usage: node prepare-static.mjs /absolute/path/to/built/studio/dist
const self = fileURLToPath(import.meta.url)
const workspace = dirname(self)
if (process.argv.length !== 3) throw new Error('Pass the path to the completed Studio dist directory.')
const input = resolve(process.argv[2])
const output = join(workspace, 'dist')
if (workspace === input || output === input || !relative(input, workspace).startsWith('..'))
    throw new Error('The input must be a separate Studio build.')
const target = mkdtempSync(join(workspace, '.build-static-'))
const build = join(target, 'dist')
const piano = 'upright-piano-kw.sf2'
const pianoPath = join('instruments', piano)
const partSize = 16 * 1024 * 1024
const digest = data => createHash('sha256').update(data).digest('hex')
const expected = 'd9f5157720963671906727ca2e12b3293fd822c831bb0de477dd1c5f3ad37108'

try {
    for (const required of ['index.html', '_headers', 'flowtu-source.tar.gz', 'source.html', pianoPath])
        assert(statSync(join(input, required)).isFile(), required)
    cpSync(input, build, {recursive:true, filter:file => !['.git','.DS_Store','node_modules'].includes(file.split('/').at(-1)) && relative(input,file)!==pianoPath})
    const bytes = readFileSync(join(input, pianoPath))
    assert.equal(digest(bytes), expected, 'Unexpected SoundFont; verify licensing and checksum before publishing.')
    const parts = []
    const hash = createHash('sha256')
    for (let offset = 0; offset < bytes.length; offset += partSize) {
        const slice = bytes.subarray(offset, offset + partSize)
        const name = piano + '.part' + String(parts.length + 1).padStart(2,'0')
        const partPath = join(build,'instruments',name)
        writeFileSync(partPath,slice)
        hash.update(readFileSync(partPath))
        parts.push({name, length:slice.length})
    }
    assert.equal(hash.digest('hex'),expected)
    const helper = `const parts = ${JSON.stringify(parts)};\n
// The native loader consumes this stream and reports progress as each part arrives.
export function fetchPianoParts() {
    let index = 0
    const controller = new AbortController()
    const stream = new ReadableStream({
        async pull(output) {
            const part = parts[index]
            if (!part) {output.close(); return}
            const response = await fetch(new URL(part.name, import.meta.url), {credentials:'same-origin', signal:controller.signal})
            if (!response.ok) throw new Error('SoundFont part download failed: ' + response.status)
            const bytes = new Uint8Array(await response.arrayBuffer())
            if (bytes.length !== part.length) throw new Error('Incomplete SoundFont part: ' + part.name)
            output.enqueue(bytes)
            index++
        },
        cancel() {controller.abort()}
    })
    return new Response(stream, {headers:{'Content-Type':'application/octet-stream','Content-Length':'${bytes.length}'}})
}\n`
    writeFileSync(join(build, 'instruments', 'piano-parts.mjs'), helper)
    // Change only the pinned build's bundled SF2 branch. All other network loads
    // continue through the native Studio code, including user soundfonts and MIDI.
    const assetDir = join(build,'assets')
    const matches = readdirSync(assetDir).filter(name => name.endsWith('.js') && readFileSync(join(assetDir,name),'utf8').includes('/instruments/' + piano))
    assert.equal(matches.length,1,'Expected one native SoundFont loader module.')
    const path = join(assetDir,matches[0]), original = readFileSync(path,'utf8')
    const native = /return fetch\(([$\w]+),([$\w]+)\?\{credentials:"same-origin"\}:([$\w]+)\)(?=\.then\(([$\w]+)=>\{if\(!\4\.ok\)throw new Error\("Soundfont download failed: ")/g
    assert.equal([...original.matchAll(native)].length,1,'Expected one pinned native SoundFont fetch.')
    writeFileSync(path,original.replace(native,(_,url,bundled,options)=>
        'return ('+bundled+'?import("/instruments/piano-parts.mjs").then(m=>m.fetchPianoParts()):fetch('+url+','+options+'))'))
    // Opening the bare private preview after login should reach the same example as its deep link.
    // Keep explicit project routes and query parameters (including mode=pro) intact.
    const entry = join(build, 'index.html')
    const previewOrigin = 'https://flowtu-score-lite-studio.coykaka.chatgpt.site'
    const initialMode = "<script>if(location.pathname==='/'&&!location.search&&!location.hash){history.replaceState(history.state,'','/?mode=lite&example=last-train&focus=edit')}</script>"
    const html = readFileSync(entry,'utf8').replaceAll('https://flowtu-four-track-studio-2510.coykaka.chatgpt.site',previewOrigin)
    writeFileSync(entry,html.replace('<head>', '<head>\n    '+initialMode))
    const sourcePage = join(build,'source.html')
    writeFileSync(sourcePage,readFileSync(sourcePage,'utf8').replace('</ul>','<li><a href="/prepare-static.mjs" download>Static-host build adaptation source</a></li></ul>'))
    cpSync(self,join(build,'prepare-static.mjs'))

    for (const file of readdirSync(build,{recursive:true})) {
        const info = lstatSync(join(build,file))
        assert(!info.isSymbolicLink(), 'Unexpected symbolic link: ' + file)
        if (info.isFile()) assert(info.size <= 25*1024*1024, 'Over the individual asset limit: ' + file)
    }
    if (existsSync(output)) {
        assert(lstatSync(output).isDirectory() && existsSync(join(output,'prepare-static.mjs')), 'Existing dist did not come from this script.')
        renameSync(output,join(target,'previous'))
    }
    renameSync(build,output)
    console.log('Prepared Studio with ' + parts.length + ' SoundFont chunks. Verified SHA-256 ' + expected)
} finally {
    if (!existsSync(output) && existsSync(join(target,'previous'))) renameSync(join(target,'previous'),output)
    rmSync(target,{recursive:true,force:true})
}
