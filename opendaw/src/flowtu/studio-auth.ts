// Both JSON generation and binary project sync pass through the main-site ext gateway.
// The host login supplies a Bearer JWT; same-origin Cookie credentials remain enabled too.
export function studioAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
    let token: string | null = null
    try {token = globalThis.localStorage?.getItem('flowtu_go_jwt') ?? null} catch { /* Cookie-only sessions still work. */ }
    return {...(token ? {Authorization: 'Bearer ' + token} : {}), ...extra}
}
