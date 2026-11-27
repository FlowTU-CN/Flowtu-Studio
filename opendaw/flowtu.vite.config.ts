import {defineConfig} from 'vite'
import {resolve, dirname} from 'node:path'
import {readFileSync,writeFileSync,cpSync,mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {buildOfflineWorker} from './engine/build-offline-worker.mjs'
import {scoreVisionPlugin} from './server/score-vision.mjs'
const require = createRequire(import.meta.url)
const wasmEntry = require.resolve('@opendaw/studio-core-wasm')
const wasmDist = dirname(wasmEntry)
const soundfontEntry = createRequire(wasmEntry).resolve('soundfont2/lib/SoundFont2.js')
mkdirSync('public/wasm-engine', {recursive:true})
cpSync(resolve(wasmDist, 'wasm'), 'public/wasm-engine/wasm', {recursive:true})
cpSync('engine/engine.wasm', 'public/wasm-engine/wasm/engine.wasm')
buildOfflineWorker(wasmDist, import.meta.dirname)
// Opt-in local API proxy; requests keep their normal Authorization/Cookie headers.
const studioApiTarget = process.env.FLOWTU_STUDIO_API_TARGET?.trim()
if (studioApiTarget) {
  const target = new URL(studioApiTarget)
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.pathname !== '/' || target.search || target.hash)
    throw new Error('FLOWTU_STUDIO_API_TARGET must be an HTTP(S) origin without credentials or a path.')
}
const uuid = 'flowtu-opendaw-0.3.2-smart-video-v7'
writeFileSync('public/build-info.json', JSON.stringify({date:Date.now(),uuid,env:'development'}))
export default defineConfig({
  base:'/studio/',
  plugins:[scoreVisionPlugin(), {name:'external-optional-onnx-binary', generateBundle(_options, bundle) {
    for (const name of Object.keys(bundle)) if (/ort-wasm.*\.wasm$/.test(name)) delete bundle[name]
  }}],
  define:{'import.meta.env.BUILD_UUID':JSON.stringify(uuid)},
  resolve:{alias:[
    {find:'@', replacement:resolve(import.meta.dirname,'src')},
    {find:/^soundfont2$/, replacement:resolve(import.meta.dirname,'src/flowtu/soundfont-parser.mjs')},
    {find:'soundfont2-umd', replacement:soundfontEntry}
  ]},
  optimizeDeps:{exclude:['@ffmpeg/ffmpeg','@ffmpeg/util','monaco-editor','onnxruntime-web','@opendaw/studio-icons','@opendaw/studio-markdown','@opendaw/studio-scrollbars']},
  build:{target:'esnext',sourcemap:false,modulePreload:false,rollupOptions:{input:{main:resolve(import.meta.dirname,'index.html'),source:resolve(import.meta.dirname,'source.html'),'overlay-preview':resolve(import.meta.dirname,'overlay-preview.html')}}},
  esbuild:{target:'esnext'},
  server:{host:'127.0.0.1',port:4173,strictPort:true,cors:{origin:/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/,exposedHeaders:['ETag','X-Studio-Generation-Linked']},proxy:studioApiTarget ? {'^/api/e(?:/|$)':{target:studioApiTarget,changeOrigin:true}} : undefined,headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}},
  preview:{host:'127.0.0.1',port:4173,strictPort:true,headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}}
})
