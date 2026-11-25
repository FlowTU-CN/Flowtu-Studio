import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdtempSync,realpathSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
test('timeline snapping routes time units, drag deltas and frame stepping through the active tempo map',()=>{
 const require=createRequire(realpathSync(fileURLToPath(new URL('../node_modules/vite/package.json',import.meta.url))))
 const {buildSync}=require('esbuild'),directory=mkdtempSync(join(tmpdir(),'flowtu-time-snap-'))
 try{const outfile=join(directory,'snap.mjs');buildSync({entryPoints:[fileURLToPath(new URL('./time-snap.fixture.ts',import.meta.url))],outfile,bundle:true,platform:'node',format:'esm',loader:{'.css':'empty'},logLevel:'silent'});assert.match(execFileSync(process.execPath,[outfile],{encoding:'utf8'}),/TIME_SNAP_OK/)}finally{rmSync(directory,{recursive:true,force:true})}
})
