import {ClipboardManager,RegionsClipboard,type ClipboardEntry} from '@opendaw/studio-core'
let copied:ClipboardEntry|undefined
let nativeAtCopy:ClipboardEntry|undefined
let handler:ReturnType<typeof RegionsClipboard.createHandler>|undefined
export function hasEditingClipboard(){return copied!==undefined}
export function bindEditingClipboard(value:NonNullable<typeof handler>){handler=value;return {terminate:()=>{if(handler===value)handler=undefined}}}
export function setEditingClipboard(entry:ClipboardEntry){
    copied=entry
    nativeAtCopy=ClipboardManager.peek().mapOr(e=>e,undefined)
}
export function getEditingClipboard() {
    const native = ClipboardManager.peek().unwrapOrUndefined()
    return native && native !== nativeAtCopy ? native : copied ?? native
}
export function editClipboard(action:'copy'|'cut'|'paste'){
    if(!handler)throw new Error('Open the timeline first.')
    const client={clientX:0,clientY:0}
    if(action==='paste'){
        // Respect a newer keyboard copy instead of always pasting an older toolbar copy.
        const entry=getEditingClipboard()
        if(!entry||!handler.canPaste(entry,client))throw new Error('Copy a clip, select a destination track, then stop playback.')
        handler.paste(entry)
    }else{
        if(!(action==='copy'?handler.canCopy(client):handler.canCut(client)))throw new Error('Select a clip and stop playback first.')
        const result=handler[action]()
        if(result.isEmpty())throw new Error('No clips available to copy. Select the clips again.')
        setEditingClipboard(result.unwrap())
    }
}
