import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'

test('trackpad gestures preserve pan, anchor zoom, coalesce frames and support fullscreen', () => {
    const require = createRequire(realpathSync(fileURLToPath(new URL('../node_modules/vite/package.json', import.meta.url))))
    const {buildSync} = require('esbuild'), directory = mkdtempSync(join(tmpdir(), 'flowtu-trackpad-'))
    try {
        const outfile = join(directory, 'events.mjs')
        buildSync({entryPoints: [fileURLToPath(new URL('./trackpad-zoom.fixture.ts', import.meta.url))], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent'})
        assert.match(execFileSync(process.execPath, [outfile], {encoding: 'utf8'}), /TRACKPAD_ZOOM_OK/)
    } finally {rmSync(directory, {recursive: true, force: true})}
})
