// The upstream SDK dynamically imports a named class, while the parser ships a
// UMD entry whose default export is an object containing that class.
import parser from 'soundfont2-umd'
export const SoundFont2 = parser.SoundFont2
