import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
const require = createRequire(realpathSync(fileURLToPath(new URL('../node_modules/vite/package.json', import.meta.url))))
const {buildSync} = require('esbuild')
test('video audio creates a separate native track, keeps source alignment, and handles undo and failures', () => {
    const directory = mkdtempSync(join(tmpdir(), 'flowtu-video-import-'))
    try {
        const outfile = join(directory, 'graph.mjs')
        buildSync({entryPoints: [fileURLToPath(new URL('./video-import-graph.fixture.ts', import.meta.url))], outfile, bundle: true, platform: 'node', format: 'esm', loader: {'.css': 'empty'}, logLevel: 'silent'})
        assert.match(execFileSync(process.execPath, [outfile], {encoding: 'utf8'}), /VIDEO_IMPORT_GRAPH_OK/)
    } finally {rmSync(directory, {recursive: true, force: true})}
})
test('paused frame seeking corrects pulse rounding without quantizing arbitrary time selections', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'flowtu-video-time-'))
    try {
        const outfile = join(directory, 'timing.mjs')
        buildSync({entryPoints: [fileURLToPath(new URL('../src/flowtu/VideoImportTiming.ts', import.meta.url))], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent'})
        const {referenceVideoSeekTime} = await import(pathToFileURL(outfile).href)
        const rate = {id: '30', numerator: 30, denominator: 1, nominal: 30}
        assert.equal(referenceVideoSeekTime(.9998, 10, rate), 1)
        assert.equal(referenceVideoSeekTime(.9985, 10, rate, .0016), 1)
        assert.equal(referenceVideoSeekTime(.9998, 10), .9998)
        assert.equal(referenceVideoSeekTime(1.01, 10, rate), 1.01)
        assert.equal(referenceVideoSeekTime(-1, 10, rate), 0)
        assert.equal(referenceVideoSeekTime(12, 10, rate), 10)
    } finally {rmSync(directory, {recursive: true, force: true})}
})

test('reference picture timing comes from encoded video packets and preserves its source clock',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'flowtu-source-info-'))
    try {
        const outfile=join(directory,'probe.mjs')
        buildSync({entryPoints:[fileURLToPath(new URL('../src/flowtu/video-source.ts',import.meta.url))],outfile,
            bundle:true,platform:'browser',format:'esm',logLevel:'silent'})
        const {inspectVideoSource}=await import(pathToFileURL(outfile).href)
        const {readFile}=await import('node:fs/promises')
        const blob=new File([await readFile(new URL('../public/flowtu-lite/last-train.mp4',import.meta.url))],'example.mp4',{type:'video/mp4'})
        const source=await inspectVideoSource(blob,1122,464,30)
        assert.equal(source.frameRate,'24')
        assert.equal(source.variable,false)
        assert.equal(source.codec,'avc')
        assert.equal(source.bytes,blob.size)
        const unknown=await inspectVideoSource(new File(['unknown'],'legacy.mov'),100,100,2)
        assert.equal(unknown.frameRate,undefined)
        assert.equal(unknown.width,100)
    } finally {rmSync(directory,{recursive:true,force:true})}
})
