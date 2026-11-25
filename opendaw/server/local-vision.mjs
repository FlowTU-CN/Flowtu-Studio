import {spawn, spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {accessSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync} from 'node:fs'
import {release, tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

const swift = fileURLToPath(new URL('./local-vision.swift', import.meta.url))
const jpeg = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/
let compiler, toolchain
export function localVisionAvailable() {
    if (process.platform !== 'darwin') return false
    try {
        // xcrun alone is also present on Macs without the command line tools.
        // Checking the selected developer directory avoids triggering an installer prompt.
        toolchain ??= spawnSync('/usr/bin/xcode-select',['-p'],{encoding:'utf8',timeout:2000}).stdout?.trim() ?? ''
        if (!toolchain) return false
        accessSync('/usr/bin/xcrun',constants.X_OK); accessSync(swift,constants.R_OK); return true
    }
    catch {return false}
}

function processText(command, args, input, timeout, signal) {
    return new Promise((resolve, reject) => {
        const child = spawn(command,args,{stdio:['pipe','pipe','pipe'],timeout,signal})
        const output = [], errors = []
        let size = 0, errorSize = 0
        child.stdout.on('data', data => {
            size += data.length
            if (size <= 128_000) output.push(data)
            else child.kill()
        })
        child.stderr.on('data', data => {if (errorSize < 4_000) errors.push(data); errorSize += data.length})
        child.once('error',reject)
        child.stdin.on('error', e => {if (e.code !== 'EPIPE') reject(e)})
        child.once('close', code => code === 0 && size <= 128_000
            ? resolve(Buffer.concat(output).toString())
            : reject(new Error(Buffer.concat(errors).toString().slice(0,400) || 'The local classifier stopped.')))
        child.stdin.end(input)
    })
}

async function binary() {
    const uid = process.getuid(), directory = join(tmpdir(),`flowtu-studio-vision-${uid}`)
    mkdirSync(directory,{mode:0o700,recursive:true})
    const stat = lstatSync(directory)
    if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077)) throw new Error('The local classifier cache is not private.')
    const digest = createHash('sha256').update(readFileSync(swift)).update(process.arch + release() + toolchain).digest('hex').slice(0,24)
    const path = join(directory,`classify-${digest}`)
    if (existsSync(path) && lstatSync(path).isFile()) return path
    // Compile to a unique temporary file, then publish the finished executable atomically.
    // Other Studio previews share the module cache and reuse identical builds on restart.
    compiler ??= (async () => {
        const building = mkdtempSync(join(directory,'build-')), output = join(building,'classify')
        try {
            await processText('/usr/bin/xcrun',['swiftc','-module-cache-path',join(directory,'modules'),'-o',output,swift],'',115_000)
            renameSync(output,path); return path
        } finally {rmSync(building,{recursive:true,force:true})}
    })().catch(error => {compiler = undefined; throw error})
    return compiler
}

const text = {
    zh:['画面','画面标签','未识别到高置信度物体','画面变化较快','画面变化平缓','用短促的拨弦琶音跟上画面变化','用稀疏的钢琴和弦给画面留白','低音保持克制，使用小调色彩','加入温暖的延音，保持明亮','保留机械感的重复节奏','让尾音自然延展'],
    en:['Scene','Frame labels','No confident object labels','High visual motion','Low visual motion','Use short plucked arpeggios to follow movement','Leave space with sparse piano chords','Keep the bass restrained and use a minor tonality','Use warm sustained notes and a bright tonality','Add a repeating mechanical pulse','Let the notes ring out'],
    es:['Escena','Etiquetas visuales','Sin objetos reconocidos con confianza','Mucho movimiento','Poco movimiento','Usa arpegios cortos para seguir el movimiento','Deja espacio con acordes de piano suaves','Usa un bajo sobrio y una tonalidad menor','Usa notas cálidas y sostenidas','Añade un pulso mecánico repetido','Deja resonar las notas'],
    pt:['Cena','Rótulos da imagem','Sem objetos identificados com confiança','Muito movimento','Pouco movimento','Use arpejos curtos para acompanhar o movimento','Deixe espaço com acordes esparsos de piano','Use um baixo contido e tonalidade menor','Use notas quentes e sustentadas','Adicione um pulso mecânico repetido','Deixe as notas ressoarem'],
    ja:['場面','画像ラベル','確信度の高い物体ラベルなし','画面変化が大きい','画面変化が小さい','短いプラックのアルペジオで動きに合わせる','まばらなピアノコードで余白を作る','低音を抑え、短調の色合いを使う','温かい持続音で明るさを保つ','機械的な反復リズムを加える','余韻を長く残す'],
    ko:['장면','화면 레이블','신뢰도 높은 물체 정보 없음','화면 변화가 큼','화면 변화가 작음','짧은 플럭 아르페지오로 움직임을 따른다','성긴 피아노 코드로 여백을 둔다','베이스를 절제하고 단조 색채를 사용한다','따뜻한 지속음으로 밝게 유지한다','기계적인 반복 리듬을 더한다','음의 잔향을 자연스럽게 남긴다']
}
const zhLabels = new Map(Object.entries({train:'列车',railroad:'铁路', 'track rail':'铁轨',transportation:'交通',platform:'站台',railway:'铁路',station:'车站',subway:'地铁',night:'夜景',dark:'暗景',city:'城市',building:'建筑',person:'人物',people:'人群',outdoor:'户外',indoor:'室内',rain:'雨',street:'街道',light:'灯光',reflection:'倒影',sky:'天空',water:'水面',landscape:'风景',architecture:'建筑'}))
function describe(scene, labels, i, language) {
    const lang = String(language ?? 'en').split('-')[0], v = text[lang] ?? text.en
    const words = labels.slice(0,3).map(item => {
        const label = item.label.replaceAll('_',' ')
        return lang === 'zh' ? zhLabels.get(label.toLowerCase()) ?? label : label
    })
    const quick = scene.motion > .14, dark = scene.brightness < .38
    const tag = labels.map(item => item.label).join(' ')
    const extra = /train|railway|station|car wheel|engine|machine|vehicle/i.test(tag) ? v[9]
        : /water|coast|landscape|nature|valley|forest|park|lake/i.test(tag) ? v[10] : ''
    return {
        id:scene.id, labels,
        title:words[0] || `${v[0]} ${i+1}`,
        observation:`${words.length ? v[1]+' · '+words.join(' / ') : v[2]} · ${quick ? v[3] : v[4]}`,
        musicPrompt:[quick?v[5]:v[6],dark?v[7]:v[8],extra].filter(Boolean).join(lang==='zh'?'，':'. ')
    }
}

/** Classify representative JPEGs with the installed macOS Vision model. Images stay on this host. */
export async function classifyLocalScenes(scenes, signal, language) {
    if (!localVisionAvailable()) return undefined
    if (!Array.isArray(scenes) || !scenes.length || scenes.length > 160) throw new Error('Send 1–160 representative frames per request.')
    const frames = [], owners = []
    for (const [i,scene] of scenes.entries()) {
        const sources = new Set([scene.thumbnail,...(scene.contextFrames ?? []).slice(0,2).map(frame => frame.thumbnail)])
        for (const source of sources) {
            if (typeof source !== 'string' || source.length > 2_000_000) throw new Error('Use small JPEG keyframes.')
            const match = jpeg.exec(source)
            if (!match) throw new Error('Expected a JPEG keyframe.')
            frames.push(match[1]); owners.push(i)
        }
    }
    signal?.throwIfAborted()
    const path = await binary(), found = scenes.map(() => new Map())
    for (let i=0;i<frames.length;i+=16) {
        signal?.throwIfAborted()
        const batch = frames.slice(i,i+16)
        const labels = JSON.parse(await processText(path,[],JSON.stringify(batch),60_000,signal))
        if (labels.length !== batch.length) throw new Error('Incomplete Vision classification.')
        for (const [j, group] of labels.entries()) {
            const combined = found[owners[i+j]]
            for (const item of group) if ((combined.get(item.label)?.confidence ?? 0) < item.confidence) combined.set(item.label,item)
        }
    }
    return scenes.map((scene,i) => describe(scene,[...found[i].values()].sort((a,b) => b.confidence-a.confidence).slice(0,5),i,language))
}
