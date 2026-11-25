import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdtempSync,realpathSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
test('native audio range operations preserve outside audio, source offsets, gaps and undo',()=>{
 const require=createRequire(realpathSync(fileURLToPath(new URL('../node_modules/vite/package.json',import.meta.url))))
 const {buildSync}=require('esbuild'),directory=mkdtempSync(join(tmpdir(),'flowtu-range-'))
 try{const outfile=join(directory,'graph.mjs');buildSync({entryPoints:[fileURLToPath(new URL('./range-graph.fixture.ts',import.meta.url))],outfile,bundle:true,platform:'node',format:'esm',loader:{'.css':'empty'},logLevel:'silent'});assert.match(execFileSync(process.execPath,[outfile],{encoding:'utf8'}),/RANGE_GRAPH_OK/)}finally{rmSync(directory,{recursive:true,force:true})}
})
