import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'

test('native volume and pan automation preserve dial values, separate lanes, edits, undo, bypass and serialization', () => {
    const require = createRequire(realpathSync(fileURLToPath(new URL('../node_modules/vite/package.json', import.meta.url))))
    const {buildSync} = require('esbuild')
    const directory = mkdtempSync(join(tmpdir(), 'flowtu-envelope-'))
    try {
        const outfile = join(directory, 'graph.mjs')
        buildSync({entryPoints: [fileURLToPath(new URL('./envelope-graph.fixture.ts', import.meta.url))], outfile,
            bundle: true, platform: 'node', format: 'esm', loader: {'.css': 'empty'}, logLevel: 'silent'})
        const output = execFileSync(process.execPath, [outfile], {encoding: 'utf8'})
        assert.match(output, /ENVELOPE_GRAPH_OK: target, level, points, reuse, interpolation, undo, bypass, serialization/)
    } finally {rmSync(directory, {recursive: true, force: true})}
})
