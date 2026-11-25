import {execFileSync} from 'node:child_process';
import {cpSync,rmSync,mkdirSync,mkdtempSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root = fileURLToPath(new URL('../',import.meta.url));
const archive = resolve(root,'opendaw/public/flowtu-source.tar.gz');
mkdirSync(resolve(root,'opendaw/public'),{recursive:true});
// Readers may download the current archive while a fresh build is running.
const staging = mkdtempSync(resolve(root,'.flowtu-source-'));
try {
    const pending = resolve(staging,'flowtu-source.tar.gz');
    execFileSync('tar',['-czf',pending,'--exclude=node_modules','--exclude=dist','--exclude=opendaw/public/wasm-engine','--exclude=opendaw/public/instruments/upright-piano-kw.sf2','--exclude=opendaw/public/flowtu-source.tar.gz','--exclude=.DS_Store','-C',root,'opendaw','scripts','integrations','package.json','README.md'],{stdio:'inherit'});
    renameSync(pending,archive);
} finally {
    rmSync(staging,{recursive:true,force:true});
}
execFileSync('pnpm',['--dir','opendaw','build'],{cwd:root,stdio:'inherit'});
rmSync(resolve(root,'dist'),{recursive:true,force:true});
cpSync(resolve(root,'opendaw/dist'),resolve(root,'dist'),{recursive:true});
