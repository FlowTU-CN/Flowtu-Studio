import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdtempSync,realpathSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'

test('floating video event wiring preserves media and supports capture, cancel, resize and reopen',()=>{
    const require=createRequire(realpathSync(fileURLToPath(new URL('../node_modules/vite/package.json',import.meta.url))))
    const {buildSync}=require('esbuild'),directory=mkdtempSync(join(tmpdir(),'flowtu-floating-video-'))
    try{
        const outfile=join(directory,'events.mjs')
        buildSync({entryPoints:[fileURLToPath(new URL('./floating-video-events.fixture.ts',import.meta.url))],outfile,bundle:true,platform:'node',format:'esm',loader:{'.css':'empty'},logLevel:'silent'})
        const output=execFileSync(process.execPath,[outfile],{encoding:'utf8'})
        assert.match(output,/FLOATING_VIDEO_EVENTS_OK: capture, drag, controls, cancel, resize, keyboard, persistence, viewport, disposal, media identity/)
    }finally{rmSync(directory,{recursive:true,force:true})}
})
