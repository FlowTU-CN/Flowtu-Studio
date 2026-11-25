import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {buildOfflineWorker} from '../engine/build-offline-worker.mjs'
import {execFileSync} from 'node:child_process'

test('WASM work-area export prints aligned stereo files with silence, MIDI, and selectable effects', () => {
    const root = fileURLToPath(new URL('../', import.meta.url))
    const require = createRequire(realpathSync(join(root, 'node_modules/vite/package.json')))
    const dir = mkdtempSync(join(tmpdir(), 'flowtu-render-'))
    try {
        const outfile = join(dir, 'render.mjs')
        const wasmDist = dirname(createRequire(join(root, 'package.json')).resolve('@opendaw/studio-core-wasm'))
        const worker = join(dir, 'offline-worker.mjs')
        buildOfflineWorker(wasmDist, root, worker)
        require('esbuild').buildSync({entryPoints: [join(root, 'tests-flowtu/work-area-render.fixture.ts')],
            outfile, bundle: true, platform: 'node', format: 'esm', loader: {'.css': 'empty'}, logLevel: 'silent'})
        const result = execFileSync(process.execPath, [outfile, root, worker, wasmDist], {encoding: 'utf8', timeout: 45000})
        assert.match(result, /WORK_AREA_RENDER_OK/)
    } finally {rmSync(dir, {recursive: true, force: true})}
})
