import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
test('bottom-editor focus routes native edit shortcuts while protecting ruler navigation, inputs, menus and audio', () => {
    const require = createRequire(realpathSync(fileURLToPath(new URL('../node_modules/vite/package.json', import.meta.url))))
    const {buildSync} = require('esbuild'), directory = mkdtempSync(join(tmpdir(), 'flowtu-editor-focus-'))
    try {
        const outfile = join(directory, 'fixture.mjs')
        buildSync({entryPoints: [fileURLToPath(new URL('./content-editor-focus.fixture.ts', import.meta.url))], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent'})
        assert.match(execFileSync(process.execPath, [outfile], {encoding: 'utf8'}), /CONTENT_EDITOR_FOCUS_OK/)
    } finally {rmSync(directory, {recursive: true, force: true})}
})
