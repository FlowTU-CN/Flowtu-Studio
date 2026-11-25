import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'

test('routing layout orders audio paths, avoids overlapping tall racks, persists and undoes as one edit', () => {
    const require = createRequire(realpathSync(fileURLToPath(new URL('../node_modules/vite/package.json', import.meta.url))))
    const directory = mkdtempSync(join(tmpdir(), 'flowtu-routing-layout-'))
    try {
        const outfile = join(directory, 'graph.mjs')
        require('esbuild').buildSync({
            entryPoints: [fileURLToPath(new URL('./routing-layout.fixture.ts', import.meta.url))],
            outfile, bundle: true, platform: 'node', format: 'esm', loader: {'.css': 'empty'}, logLevel: 'silent'
        })
        assert.match(execFileSync(process.execPath, [outfile], {encoding: 'utf8'}), /ROUTING_LAYOUT_OK/)
    } finally {
        rmSync(directory, {recursive: true, force: true})
    }
})
