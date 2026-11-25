// Rebundle the published worker sources against the same region schema as the main thread.
// The prebuilt npm worker embeds its own upstream box classes when decoding project snapshots.
import {mkdirSync, readFileSync, writeFileSync} from "node:fs"
import {dirname, resolve} from "node:path"
import {createRequire} from "node:module"

export function buildOfflineWorker(wasmDist, appRoot, outfile = resolve(appRoot, "public/wasm-engine/offline-worker.js")) {
    const {sources, sourcesContent} = JSON.parse(readFileSync(resolve(wasmDist, "wasm-offline-worker.js.map"), "utf8"))
    const packageRoot = resolve(appRoot, "node_modules/.cache/flowtu-engine/packages/core-wasm/dist")
    sources.forEach((source, index) => {
        if (!source.startsWith("../src/") && !source.startsWith("../../core-processors/src/")) return
        const file = resolve(packageRoot, source)
        mkdirSync(dirname(file), {recursive: true})
        writeFileSync(file, sourcesContent[index])
    })
    const require = createRequire(resolve(appRoot, "package.json"))
    const esbuild = createRequire(require.resolve("vite/package.json"))("esbuild")
    esbuild.buildSync({
        entryPoints: [resolve(packageRoot, "../src/offline-worker.ts")],
        outfile,
        bundle: true, minify: true, format: "esm", platform: "browser", target: "esnext"
    })
}
