import "./flowtu/theme"
import "./main.sass"
import workersUrl from "@opendaw/studio-core/workers-main.js?worker&url"
import workletsUrl from "@opendaw/studio-core/processors.js?url"
import wasmProcessorUrl from "@opendaw/studio-core-wasm/wasm-processor.js?url"
import {boot} from "@/boot"
import {initializeColors} from "@opendaw/studio-enums"
import {DisplayPaint} from "@/ui/devices/DisplayPaint"

initializeColors(document.documentElement)
DisplayPaint.initialize(document.documentElement)
if (window.crossOriginIsolated) {
    const now = Date.now()
    boot({
        workersUrl,
        workletsUrl,
        wasmProcessorUrl,
        wasmOfflineWorkerUrl: `${import.meta.env.BASE_URL}wasm-engine/offline-worker.js`
    }).then(() => console.debug(`Booted in ${Math.ceil(Date.now() - now)}ms`)).catch(error => {
        document.querySelector("#preloader")?.remove()
        const message = document.createElement("p")
        message.textContent = "Studio could not start. Reload the page to try again."
        document.body.append(message)
        throw error
    })
} else {
    const message = document.createElement("p")
    message.style.cssText = "padding:32px;font:16px system-ui;color:white"
    message.textContent = "Preparing the audio engine…"
    message.style.position = "relative"
    message.style.zIndex = "3"
    document.body.append(message)
    if ("serviceWorker" in navigator && sessionStorage.getItem("flowtu-isolation-retried") !== "yes") {
        navigator.serviceWorker.register(`${import.meta.env.BASE_URL}flowtu-isolation.js`).then(async () => {
            await navigator.serviceWorker.ready
            sessionStorage.setItem("flowtu-isolation-retried", "yes")
            if (navigator.serviceWorker.controller) location.reload()
            else navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), {once:true})
        }).catch(() => {message.textContent = "Audio setup failed. Please reopen in desktop Chrome."})
    } else {
        message.textContent = "Audio requires cross-origin isolation. Open this URL in a standalone Chrome or Edge tab."
    }
}
