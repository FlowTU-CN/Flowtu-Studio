import {chooseFileDestination, saveCancelled} from './file-destination'

async function sourceFile(link: HTMLAnchorElement, name: string) {
    const response=await fetch(link.href)
    if (!response.ok) throw new Error('Could not download the source file.')
    const file=await response.blob()
    if (!name.endsWith('.tar.gz')) return file
    const header=new Uint8Array(await file.slice(0,262).arrayBuffer())
    if (header[0]===0x1f && header[1]===0x8b) return file
    // Some hosts serve .tar.gz with HTTP gzip encoding, which fetch transparently decodes.
    if (new TextDecoder().decode(header.subarray(257,262))!=='ustar') throw new Error('The server did not return a source archive.')
    return new Response(file.stream().pipeThrough(new CompressionStream('gzip'))).blob()
}

const status=document.querySelector<HTMLOutputElement>('output')!
for (const link of document.querySelectorAll<HTMLAnchorElement>('a[download]')) {
    link.onclick=async event=>{
        event.preventDefault()
        status.textContent=''
        const name=link.download || decodeURIComponent(new URL(link.href).pathname.split('/').pop()!)
        try {
            const dest=await chooseFileDestination(name)
            if (dest) await dest.write(await sourceFile(link,name))
        } catch (error) {if (!saveCancelled(error)) status.textContent=error instanceof Error?error.message:String(error)}
    }
}
