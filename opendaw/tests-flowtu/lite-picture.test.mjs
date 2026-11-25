import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdtempSync,realpathSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'

test('picture analysis groups scoring beats, preserves existing edits and writes one undoable project revision',()=>{
    const require=createRequire(realpathSync(fileURLToPath(new URL('../node_modules/vite/package.json',import.meta.url))))
    const directory=mkdtempSync(join(tmpdir(),'flowtu-lite-picture-test-'))
    try {
        const outfile=join(directory,'picture.mjs')
        require('esbuild').buildSync({entryPoints:[fileURLToPath(new URL('./lite-picture.fixture.ts',import.meta.url))],
            outfile,bundle:true,platform:'node',format:'esm',loader:{'.css':'empty'},logLevel:'silent'})
        assert.match(execFileSync(process.execPath,[outfile],{encoding:'utf8'}),/LITE_PICTURE_OK/)
    } finally {rmSync(directory,{recursive:true,force:true})}
})
