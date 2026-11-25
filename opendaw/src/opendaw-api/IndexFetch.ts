import {network} from "@opendaw/lib-runtime"

// The browser can retry the catalogue on demand. A cross-origin or offline failure
// must also settle so the SDK can finish initializing user-owned instruments.
export const fetchIndex = async (url: string, headers: RequestInit): Promise<unknown> => {
    const response = await network.limitFetch(url, {
        ...headers, cache: "no-cache", signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) throw new Error(`Library index returned ${response.status} ${response.statusText}`)
    return response.json()
}
