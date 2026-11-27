import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdtempSync,realpathSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'

for(const base of ['/studio/','/'])test('project routes survive navigation, refresh and history at '+base,()=>{
    const require=createRequire(realpathSync(fileURLToPath(new URL('../node_modules/vite/package.json',import.meta.url))))
    const {buildSync}=require('esbuild'),directory=mkdtempSync(join(tmpdir(),'flowtu-studio-routes-'))
    try{
        const outfile=join(directory,'routes.mjs')
        buildSync({entryPoints:[fileURLToPath(new URL('./studio-routes.fixture.ts',import.meta.url))],outfile,bundle:true,platform:'node',format:'esm',
            define:{'import.meta.env.BASE_URL':JSON.stringify(base)},logLevel:'silent'})
        assert.match(execFileSync(process.execPath,[outfile],{encoding:'utf8'}),/STUDIO_ROUTES_OK/)
    }finally{rmSync(directory,{recursive:true,force:true})}
})
