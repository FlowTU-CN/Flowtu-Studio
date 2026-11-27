// Run in an isolated browser on the Vite origin:
// await (await import('/tests-flowtu/project-generation-browser.fixture.ts')).runGenerationBrowserChecks()
import {installCloudGenerationPanel} from '../src/flowtu/CloudGenerationPanel'
import {setStudioLanguage} from '../src/flowtu/studio-language'
import {saveDeviceProject, readDeviceProject, syncProject, deleteCloudProject, removeDeviceProject} from '../src/flowtu/project-library'

export async function runGenerationBrowserChecks() {
    const check = (value: unknown, message: string) => {if (!value) throw new Error(message)}
    const until = async (condition: () => boolean) => {
        for (let i = 0; i < 250; i++) {if (condition()) return; await new Promise(resolve => setTimeout(resolve, 20))}
        throw new Error('Timed out waiting for browser state')
    }
    const original = globalThis.fetch
    const container = document.createElement('div'); document.body.append(container)
    setStudioLanguage('zh-CN')
    const requests: Record<string, unknown>[] = [], uploads: Record<string, string>[] = []
    const id = crypto.randomUUID(), scope = crypto.randomUUID()
    let cloudId: string | undefined = id
    let phase = '502', link = '0', revision = 0, failSave = false
    const song = {songKey: 's1', title: 'Generated', playUrl: '/api/e/me/songs/fixture/audio', coverUrl: null}
    const envelope = (data: unknown) => Response.json({ok: true, data})
    globalThis.fetch = async (url, init) => {
        const path = String(url)
        if (path === '/api/e/me/songs/fixture/audio') {
            const buffer = new ArrayBuffer(48), view = new DataView(buffer)
            const tag = (offset:number, value:string) => [...value].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)))
            tag(0,'RIFF');view.setUint32(4,40,true);tag(8,'WAVE');tag(12,'fmt ');view.setUint32(16,16,true)
            view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true)
            view.setUint16(32,2,true);view.setUint16(34,16,true);tag(36,'data');view.setUint32(40,4,true)
            return new Response(new Blob([buffer],{type:'audio/wav'}))
        }
        if (path === '/api/e/studio/projects') return Response.json({accountId: 'fixture-user', projects: [{id}]})
        if (path === '/api/e/me/studio-models') return envelope({models: [{model: 'mureka-9.5', label: 'Mureka 9.5', maxCount: 2, creditHint: 15,
            capabilities: {instrumental: true, withLyrics: true, refAudio: false, refMidi: false, humming: false, refImage: false}}]})
        if (path === '/api/e/me/studio-generations' && init?.method === 'POST') {
            requests.push(JSON.parse(String(init.body)))
            if (phase === '502') return Response.json({ok: false, error: 'upstream_failed', message: '稍后重试'}, {status: 502})
            return envelope({generationKey: 'g1', status: 'running', partial: phase === 'partial', billing: {credits: 15}})
        }
        if (path.startsWith('/api/e/me/studio-generations?')) return envelope({generations: []})
        if (path === '/api/e/me/studio-generations/g1') return envelope({generationKey: 'g1', status: phase === 'mixed' ? 'failed' : 'succeeded',
            songs: phase === 'mixed' ? [song, {songKey: 's2', playUrl: null, errorCode: 'upstream_client_error', failMessage: '请调整内容后重试'}] : [song]})
        if (path === '/api/e/studio/projects/' + id) {
            if (init?.method === 'DELETE') return new Response(null, {status: 503})
            if (failSave) return Response.json({error: 'Storage quota exceeded.'}, {status: 402})
            uploads.push(init?.headers as Record<string, string>)
            return Response.json({id, revision: 'r' + ++revision}, {status: revision === 1 ? 201 : 200, headers: {'X-Studio-Generation-Linked': link}})
        }
        throw new Error('Unexpected fixture request: ' + path)
    }
    const panel = installCloudGenerationPanel({
        currentInput: () => ({prompt: 'soft piano', start: 0, end: 2, style: 'follow'}), applyInput() {},
        cloudProjectId: () => cloudId, generationScope: () => scope, saveProjectForGeneration: async () => {
            cloudId = id
            throw new Error('Project saved, but generation history was not linked. Save again to retry.')
        }
    }, container)
    const generate = container.querySelector<HTMLButtonElement>('[data-action=cloud-generate]')!
    const count = container.querySelector<HTMLSelectElement>('[data-field=cloud-count]')!
    const note = container.querySelector<HTMLElement>('[data-field=cloud-note]')!
    const report: string[] = []
    try {
        await until(() => !generate.disabled)
        count.value = '2'; count.dispatchEvent(new Event('change'))
        check(container.querySelector('[data-field=cloud-credits]')!.textContent?.includes('30'), 'two songs must show 30 credits')
        generate.click()
        await until(() => !generate.disabled && requests.length === 1)
        await until(() => generate.textContent === '恢复生成')
        check(requests[0].projectId === id, 'subsequent generation must carry projectId')
        check(!('refAudioKeys' in requests[0]), 'disabled audio reference must be omitted')
        phase = 'partial'; generate.click()
        await until(() => !generate.disabled && requests.length === 2)
        check(JSON.stringify(requests[0]) === JSON.stringify(requests[1]), 'retry must reuse exact request and clientRequestId')
        check(note.textContent?.includes('1/2'), 'partial result must explain missing song')
        check(container.querySelectorAll('.ft-cloud-song').length === 1, 'partial result keeps available song')
        check(!container.textContent?.includes('NaN'), 'missing duration metadata must not show NaN')
        container.querySelector<HTMLButtonElement>('.ft-cloud-song button')!.click()
        await until(() => container.querySelector<HTMLAudioElement>('.ft-cloud-song audio')!.src.startsWith('blob:'))
        check(!container.querySelector<HTMLAudioElement>('.ft-cloud-song audio')!.hidden, 'preview must use authenticated blob audio')
        report.push('UI: authenticated preview and missing duration metadata')
        report.push('UI: estimated credits, projectId, disabled references, 502 recovery, partial success')
        phase = 'mixed'; generate.click()
        await until(() => !generate.disabled && requests.length === 3)
        check(note.textContent === '请调整内容后重试', 'mixed failure must show real failure message')
        check(container.querySelectorAll('.ft-cloud-song').length === 1, 'mixed failure keeps playable success')
        report.push('UI: real failure reason and playable success retained')
        cloudId = undefined; phase = 'partial'; generate.click()
        await until(() => !!document.querySelector('dialog[open] input[name=projectName]'))
        check(!('projectId' in requests[3]), 'unsaved projects omit projectId')
        document.querySelector<HTMLFormElement>('dialog[open] form')!.requestSubmit()
        await until(() => !generate.disabled)
        check(note.textContent?.includes('工程已保存，但生成历史未关联'), 'association warning must not be overwritten by preview success')
        report.push('UI: first-save naming and association warning preserved')
        const owner = 'account:fixture-user', blob = new Blob(['project'])
        const local = await saveDeviceProject(owner, 'Fixture', blob, undefined, {id, generationKey: 'g1'})
        const saved = await syncProject(local, blob)
        check(saved.generationLink === '0' && saved.revision === 'r1' && !saved.pending, 'unlinked save still advances revision')
        let stored = await readDeviceProject(owner, id)
        check(stored.entry.generationKey === 'g1' && stored.entry.revision === 'r1', 'unlinked draft retains retry key and new revision')
        link = 'error'
        const retry = await syncProject(stored.entry, stored.blob)
        check(retry.generationLink === 'error' && retry.revision === 'r2', 'link error still saves project')
        check(uploads[1]['If-Match'] === '"r1"' && uploads[1]['X-Studio-Generation-Key'] === 'g1', 'retry must send new revision and generation key')
        link = '1'; await syncProject(retry, blob)
        stored = await readDeviceProject(owner, id)
        check(!stored.entry.generationKey && stored.entry.revision === 'r3', 'successful link retires pending association')
        failSave = true
        const draft = await saveDeviceProject(owner, 'Changed', blob, stored.entry)
        await syncProject(draft, blob).then(() => {throw new Error('quota save should fail')}, e => check(e.message.includes('Storage quota exceeded'), 'quota error is actionable'))
        check((await readDeviceProject(owner, id)).entry.pending, 'quota failure preserves local draft')
        await deleteCloudProject(owner, id).then(() => {throw new Error('503 should fail')}, e => check(e.message.includes('temporarily unavailable'), '503 has actionable message'))
        await removeDeviceProject(owner, id)
        report.push('IndexedDB: persisted association, 0/error/1 retry, latest revision, quota/offline draft preservation')
        return report
    } finally {panel.dispose(); container.remove(); globalThis.fetch = original}
}
