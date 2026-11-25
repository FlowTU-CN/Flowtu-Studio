import {DefaultObservableValue} from '@opendaw/lib-std'
export type EditingTool='select'|'cut'|'trim'|'fade'|'mute'|'erase'|'range'
export const editingTool=new DefaultObservableValue<EditingTool>('select')
export const toolHints:Record<EditingTool,string>={
    select:'Top: move · Center: select time · Edges: trim · Corners: fade',
    cut:'Click a clip to split · Snap controls the cut position · Undo to restore',
    trim:'Drag the left half to trim the start, or the right half to trim the end',
    fade:'Drag near the start or end for fade length · Drag the round point to shape its curve',
    mute:'Click a clip to mute · Click again to unmute',
    erase:'Click a clip to delete · Undo to restore',
    range:'Drag across audio to select time · Shift: bypass Snap · Delete: clear selected audio · Esc: clear range'
}
