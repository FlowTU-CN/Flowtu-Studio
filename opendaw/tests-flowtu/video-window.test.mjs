import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdtempSync,realpathSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'

test('video window owns its muted player, restores the studio on close and preserves transport shortcuts',()=>{
    const require=createRequire(realpathSync(fileURLToPath(new URL('../node_modules/vite/package.json',import.meta.url))))
    const {buildSync}=require('esbuild'),directory=mkdtempSync(join(tmpdir(),'flowtu-video-window-'))
    try {
        const outfile=join(directory,'fixture.mjs')
        buildSync({entryPoints:[fileURLToPath(new URL('./video-window.fixture.ts',import.meta.url))],outfile,bundle:true,platform:'node',format:'esm',logLevel:'silent'})
        assert.match(execFileSync(process.execPath,[outfile],{encoding:'utf8'}),/VIDEO_WINDOW_OK/)
    } finally {rmSync(directory,{recursive:true,force:true})}
})
