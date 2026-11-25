import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdtempSync,realpathSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
test('native context uses adjacent MIDI and decoded audio to shape both boundaries',()=>{
 const require=createRequire(realpathSync(fileURLToPath(new URL('../node_modules/vite/package.json',import.meta.url))))
 const {buildSync}=require('esbuild'),directory=mkdtempSync(join(tmpdir(),'flowtu-lite-context-'))
 try{const outfile=join(directory,'graph.mjs');buildSync({entryPoints:[fileURLToPath(new URL('./lite-context.fixture.ts',import.meta.url))],outfile,bundle:true,platform:'node',format:'esm',loader:{'.css':'empty'},logLevel:'silent'});assert.match(execFileSync(process.execPath,[outfile],{encoding:'utf8'}),/LITE_CONTEXT_OK/)}finally{rmSync(directory,{recursive:true,force:true})}
})
