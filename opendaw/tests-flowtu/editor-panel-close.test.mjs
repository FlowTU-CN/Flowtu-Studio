import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {execFileSync} from 'node:child_process'

test('editor panel closes, keeps its edit target, reopens, and closes a popout without re-embedding', async () => {
    const entry = fileURLToPath(new URL('./editor-panel-close.fixture.ts', import.meta.url))
    const require = createRequire(realpathSync(fileURLToPath(new URL('../node_modules/vite/package.json', import.meta.url))))
    const {build} = require('esbuild'), directory = mkdtempSync(join(tmpdir(), 'flowtu-editor-panel-'))
    // Only browser rendering and window creation are adapters here. All panel,
    // layout, visibility and lifecycle code below is the production implementation.
    const adapters = {
        jsx: 'export const replaceChildren = (container, ...children) => {container.children = children.flat()}',
        dom: 'export const Html = {empty(container) {container.children = []}}',
        surface: `import {Option} from '@opendaw/lib-std';
            export const Surface = {
                getById(id) {return Option.wrap(globalThis.panelWindowFixture.windows.get(id))},
                get() {return {new: (...args) => globalThis.panelWindowFixture.open(...args)}}
            }`,
        dialogs: 'export const Dialogs = {info() {throw new Error("Unexpected popout failure")}}',
        anchors: 'export const TourAnchors = {register() {}}'
    }
    try {
        const outfile = join(directory, 'fixture.mjs')
        await build({entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{
            name: 'browser-panel-adapters',
            setup(build) {
                build.onResolve({filter: /lib-jsx$|lib-dom$|surface\/Surface$|components\/dialogs\.tsx$|tour\/TourAnchors$/}, args => {
                    const path = args.path === '@opendaw/lib-jsx' ? 'jsx'
                        : args.path === '@opendaw/lib-dom' ? 'dom'
                        : args.path.endsWith('/surface/Surface') ? 'surface'
                        : args.path.endsWith('/components/dialogs.tsx') ? 'dialogs'
                        : args.path.endsWith('/tour/TourAnchors') ? 'anchors' : undefined
                    if (path) return {path, namespace: 'panel-adapter'}
                })
                build.onLoad({filter: /.*/, namespace: 'panel-adapter'}, args => ({contents: adapters[args.path], resolveDir: dirname(entry), loader: 'js'}))
            }
        }]})
        assert.match(execFileSync(process.execPath, [outfile], {encoding: 'utf8'}), /EDITOR_PANEL_CLOSE_OK/)
    } finally {rmSync(directory, {recursive: true, force: true})}
})
