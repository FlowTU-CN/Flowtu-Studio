# Flowtu Studio · 基于 openDAW 的可运行四轨工作室

本版本直接运行 **openDAW 0.3.2 的完整编辑器和 WASM 音频引擎**，不是模拟 DAW 界面的展示页面。上游版本固定为 `@opendaw/app-studio@0.3.2`（2026-10-22），提交 `b78d6b0df53bc563010808a01789dd0a98b7a459`。前一版自制 Vue / Web Audio 原型保存在 `prototype-v1/`，当前启动和发布入口均已换成 openDAW。

## 运行

需要 Node.js 23+、pnpm 11。首次运行：

```sh
pnpm run setup
pnpm dev
```

打开 http://127.0.0.1:4173/studio/ 。本机已安装全部依赖，也可以双击 `start.command`。生产构建用 `pnpm build`，输出为 `dist/`；`pnpm preview` 预览生产版本。构建固定使用子路径 `base: '/studio/'`，与主站 `www.flowtu.cn/studio/` 挂载一致；服务器需将该前缀指向本 dist 目录（dev/preview 已自带该前缀与 COOP/COEP 头）。

## 可以实际完成的操作

### 极简配乐与画面模型

打开 [极简模式](http://127.0.0.1:4173/studio/?mode=lite) 使用自己的素材，或打开 [可试剪的本地示例](http://127.0.0.1:4173/studio/?mode=lite&example=last-train&focus=edit)。顶部可以在极简配乐和专业模式之间切换。两者使用同一工程、视频、音轨和撤销记录。

导入视频会在浏览器提取代表帧。极简时间线显示所用分析器、可定位的场景和可下载的提示词 JSON。后端启用 OpenAI 时会把带时间戳的代表帧发给视觉模型，按画面内容和情绪变化建议配乐段落。在支持 Apple Vision 的本地 macOS 环境可使用离线物体分类。纯静态托管也能在浏览器检测切点、亮度和运动。已有段落及已选版本保存在工程内。

本机模型服务随 `pnpm dev` 或 `pnpm preview` 启动。启动前，在服务进程的环境中设置 `OPENAI_API_KEY` 或 `FLOWTU_VISION_API_KEY` 即可启用 OpenAI。默认视觉模型为 `gpt-4.1-mini`。可通过 `FLOWTU_VISION_MODEL` 选择模型，通过 `FLOWTU_VISION_BASE_URL` 连接兼容 Responses API 的服务。Vite 本地接口只接受本机同源请求。

Flowtu 平台可在 Studio 所在窗口注册 `window.flowtuScoringModel`，以 `describeScenes` 实现其他供应商的画面理解，或以 `composeMidi` 实现自选音乐模型。两种方法均接收取消信号。视觉输入包含画面时间和关键帧，MIDI 输入包含所选范围、配乐提示、相邻段落实测音符与可用音频特征。返回的 MIDI 音符使用四分音符拍数作为起点和长度，力度范围是 0 到 1。接口类型见 `opendaw/src/flowtu/lite-model.ts`。密钥保存在平台服务端。

### 专业版两个方向圆盘的 RAG 接口

宿主在 Studio 所在窗口注册 `window.flowtuDirectionRag`。两个方法可以分别接不同的服务，也可以只注册其中一个。下面的 URL 由宿主提供，服务端持有检索凭证。

```js
const retrieve = endpoint => async (query, {signal}) => {
    const response = await fetch(endpoint, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(query), signal
    })
    if (!response.ok) throw new Error('Retrieval failed')
    return response.json()
}
window.flowtuDirectionRag = {
    melodyArrangement: retrieve('/api/rag/melody-arrangement'),
    emotionStyle: retrieve('/api/rag/emotion-style')
}
```

松开圆盘、提交数值、通过键盘调整或复位时，只调用对应的方法。`melodyArrangement` 收到 `axes: {melody, arrangement}`，`emotionStyle` 收到 `axes: {emotion, character}`，各轴范围为 −100 到 +100。共用字段包含工程 ID、段落 ID 与名称、起止秒数、当前指令和段落分析 Markdown，以及工程 BPM、乐器和风格。未选择命名段落时，`cue.id` 为 `null`。完整类型位于 `opendaw/src/flowtu/direction-rag.ts`。

服务返回 `{"text":"建议写入提示词的文字"}`（最多 500 字符）或 `null`。建议显示在对应圆盘下；点击「用于生成」后才加入段落的可编辑提示词，随工程保存。同一圆盘连续提交会取消先前的请求，切换段落或更改上下文会丢弃过期建议。两个圆盘都可以独立运行，本地参数调整无需配置服务。

### 时间线与轨道管理

在时间线上选中轨道后，按一次 Delete 或 Backspace 即可移除。轨内音频和 MIDI 仍在工程的 Media 素材库，可试听或拖到其他轨道。要从工程移除素材，在 Media 选择删除并确认。撤销可恢复素材。

- 播放栏中，节拍器右侧的工具下拉菜单列出 Smart、Blade、Trim、Range 等工具和对应快捷键。`Actions` 收纳剪辑命令、视图、自动化和选区操作。
- 点磁铁或在时间线上按 `N` 可切换吸附。旁边的箭头可选片段边缘、网格或两者。两者开启时优先贴近片头或片尾，蓝色对齐线标出落点。按住 Shift 拖动可临时自由移动或修剪，方便制作交叉淡化。

- 时间线左上角的 `Rulers` 可同时勾选 Seconds、Timecode、Samples、User frame rate，也可隐藏 Loop range。Timecode 沿用播放栏帧率，User frame rate 独立设置；Samples 按当前工程音频采样率换算。缩放会改变数字间隔，放大后可读到毫秒或子帧。单击标尺定位，左右键微调。在任一时间标尺或小节标尺上横拖可选取时间段，Shift 临时跳过吸附。拖动波形中央或点片段标题也会在标尺上高亮对应范围。选好后在 Actions → Selection 中点 Loop Range，或按 ⌘/Ctrl+Shift+L，按空格试听。在 Audio 和 Video 模式，暂停时按 M 可用选区创建 Cue，播放时按 M 在播放头打点。
- 在 `Rulers → Add note at playhead…` 写下当前位置的工作备注，或展开 Notes 后双击备注行。点已有备注可修改或删除。备注随工程保存并支持撤销。
- 在时间线左上角的 `Conductor` 菜单展开 `Tempo track` 和 `Time signature track`。将播放头停在目标位置，输入 BPM，选择 Step、Linear、Bend early 或 Bend late，再点 `Set point`。形状作用于前一个速度点到该点的过渡，可拖曲线中点微调弯度。直接输入拍号（如 11/8）并点 `Set at bar`，从当前小节开头生效。轨道底色逐小节交替，深灰线标出各拍。
- 用 Smart 拖动片段上沿，让两个音频片段首尾重叠。交叠段在同一行以 50% 不透明度显示两段波形和两条曲线。点击交叠区可选 `Linear`（普通线性）或 `Constant power`（恒功率），也可分别拖动淡入、淡出控制点。
- 在 Smart 模式上下拖动片段右下角略靠上的 Clip Gain 小推子，可以直接改变该片段的播放和导出音量。按住 Shift 拖动可精调，选中推子后用上下键每次调 0.1 dB。在 Mac 上按住 ⌘ 点按音量、声相、乐器或效果器的旋钮和推子可恢复默认值，Windows 和 Linux 使用 Ctrl。要将播放头定位到工程开头，Mac 用 ⌘+←，Windows 和 Linux 用 Ctrl+Home。
- 点轨头最左侧的乐器色块选择轨道颜色。音频波形、MIDI 音符和片段编辑器会跟随所属轨道。跨轨移动或拖入的片段使用目标轨颜色；选 `Default / folder color` 可恢复文件夹或片段原色。
- `Actions → Automation → Pan Env` 打开该轨的声相包络。与音量包络可同时使用，各自有读取开关。拖动自动化节点可改变左右声像，监听和 WAV 导出都会使用这条曲线。
- `Actions → View → Track height` 可统一设为 Small、Medium、Large。轨头的 `… → Track height` 调整单轨。拖动轨头下边缘可微调，双击边缘恢复默认高度。
- `Actions → View → New track folder…` 可命名、调色并选择上级文件夹。拖动轨头图标或文件夹名称到目标行上、下边缘可排序，拖到文件夹中央可放入。文件夹的 M（静音）和 S（独奏）作用于所有子层级，关闭后成员恢复各自的设置。点名称折叠，点 `…` 管理成员或解组。

### 视频配乐工作台（2026-11-21，本地整合）

参考 `references/video-scoring-original.html` 的画布入口、独立配乐页、生成范围和变化点流程，新版直接与当前 DAW 共用工程和音频引擎。用户提供的原始单文件保留为参考，不执行其中的模拟生成、模拟波形或模拟导出。

- 顶部 `Audio / Video` 切换同一工程的音频编辑和视频配乐视图。两种模式都能按 `M` 建立 Cue。暂停时优先采用选区，播放中按当前播放头打点，时间线上方的标记会按 A、B、C 命名。点选标记可定位并编辑名称、范围和配乐方向。新段落默认延伸到下一个标记，手动修改 Out 可以固定结束位置。
- 点 `Pop out` 把画面移到独立窗口，主监视器会显示大号工程时钟。点主播放栏时间读数旁的下拉菜单，可选择毫秒时间、时间码或 `Time + frames`。后者用 `HH:MM:SS.FF` 显示时、分、秒和秒内帧号。25 fps 下，输入 `470` 或 `00:00:18.20` 都定位到同一帧。弹出窗口支持空格播放和 `M` 打点。拖动配乐区的竖分隔线可调整相邻面板的宽度，底部分隔线可调整配乐区与时间线的高度。
- 视频下方和独立窗口共用播放控件。中央显示当前位置与结束位置，左侧显示播放键和主输出电平。点播放键或按空格控制同一播放头，拖动进度条定位。右侧可弹出画面、进入全屏，或打开 `⋯` 切换画面适配和填充。
- 视频导入沿用原声导入选项，勾选后建立独立音轨。独立视频窗口读取同一份本地素材，播放、暂停和定位由 DAW 播放头驱动。
- 视频模式的左栏贯穿工作区，默认显示 `Cue sheet`。点选 Session 后，左栏紧右侧显示该 Cue 的结果。拖动分隔线可调整结果栏宽度。可逐个试听、打开编辑器、送进 FlowDeck，或把素材拖到相应类型的时间线轨道。
- 视频模式的右栏 `Toolbox` 贯穿监视器和时间线，预留语音生成、翻译、口型同步和台词四个位置。拖动左边界调宽，点标题可以收起或重新展开。
- Audio 模式导入音频或 MIDI 时，选择 `Existing track`、`New track` 或 `Assets only`。仅存素材不会添加可见轨道，也不会参与工程播放。可在 Assets 试听、拖入编曲，或在 `⋯ → Use for generation` 中作为生成参考。MIDI 的音符按工程速度导入。
- 左栏 `Assets` 可管理工程中的音频与 MIDI。把素材拖到兼容轨道会放入副本。点素材上的 `FlowDeck` 可在左下打开画布；也可以从配乐页标题栏放大打开。音频可调增益与淡入淡出，MIDI 可调移调与力度。保存为新版本后可试听或拖入编曲。
- 时间线下方的 `Editor`、`Instruments`、`Mixer` 卡片控制对应面板。`Single` 同时显示一个，`Multiple` 可分别开关三个。切回 `Single` 会保留最近打开且仍显示的面板。拖动面板上边缘可调高度。
- 在同一左栏切到 `Music direction`，设置范围、乐器、提示词和风格。两个方向轮可分别调节旋律复杂度与配器密度、情绪表达与风格强度，点 `Generate MIDI` 生成。每次生成都会建立可编辑的 MIDI 轨道。时间使用工程秒数，MIDI 存储按原生 PPQN 精度取整。
- 生成仍是本地规则功能，没有连接 AI 视频分析、云端音乐生成或人声分离。每次范围最多 32 小节；改变工程 BPM 请使用原生速度控件，避免生成指令意外改变已有配乐的时间关系。
- 提示词、配乐范围和变化点存入工程元数据，支持原生撤销及工程保存恢复。`File → Save` 下载 `.flowtu.zip`；`File → Export WAV` 导出真实音轨混音，不渲染视频文件。

入口：`opendaw/src/flowtu/ScoringWorkspace.ts`；配乐数据与生成：`opendaw/src/flowtu/scoring-model.ts`；视频、工程保存和导出桥接：`opendaw/src/flowtu.ts`。

回归检查可在工程根目录运行 `pnpm typecheck` 和 `node --test opendaw/tests-flowtu/*.test.mjs`。配乐用例覆盖原生 MIDI 区间、音符裁尾、Cue 名称与范围、工程序列化和撤销。

- 四轨起始工程：3 条音频轨、1 条 MIDI 合成器轨。初始 MIDI 含 8 个可修改音符；“四轨工程”新建空音符片段。保留 openDAW 原生增删轨能力。
- 导入 WAV / MP3 等浏览器支持的音频：选择顶部目标轨，再点“导入音频”。为避免覆盖已有内容，导入位置取播放头和当前轨最后片段末端的较大值。之后可自由拖动。
- 原生波形片段移动、边缘裁剪、拆分、复制、删除、撤销；原生轨道音量、静音、独奏、效果链和混音器。
- “音频剪辑”提供片段音量推子、淡入／淡出及两段交叉淡化；所有调整实际影响播放、导出和保存的工程。
- 双击 MIDI 片段打开原生钢琴卷帘，双击网格添加音符，拖动音符移动、改变长度。
- 本地 MP4 / WebM 作为参考视频。原声静音；视频跟随 openDAW 的播放、暂停、定位及循环，用 tempo map 将节拍转换为时间。偏移值表示视频在工程中的开始时间；视频结束后停在最后一帧。浏览器解码和刷新率决定同步精度，非逐帧后期编辑器。
- “保存工程”下载 `.flowtu.zip`，内含原生 `.odb`、所有用到的音频、MIDI 和参考视频，可用“打开工程”恢复。也接受原生 `.odb`。工程同时保存至 openDAW 浏览器存储；参考视频随下载包保存。浏览器清理数据前请下载工程。
- “导出 WAV”使用 openDAW OfflineEngineRenderer，生成真正的 48 kHz / 32 位浮点 / 立体声 WAV，包含合成器音符及音轨混音，不包含参考视频原声。

文件在浏览器本地处理，不上传到本站服务器。上游素材库、预设库和可选模型可能访问 openDAW 的公共服务，受网络可用性影响；上传自己的音频、内置合成器、工程文件和混音不依赖在线素材库。

## Vue / Nuxt 集成

`integrations/FlowtuDaw.vue` 是可用的 iframe 入口组件；将本应用作为独立 DAW 子站部署，把它的 URL 传入 `src`。不要把 openDAW 自定义 JSX 当成 React/Vue 组件编译。Nuxt 页面使用 `<ClientOnly>` 包裹此组件。

openDAW 需要 HTTPS（本机 localhost 例外）、AudioWorklet、SharedArrayBuffer 和 OPFS。父页面和 DAW 子站都应设置：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

跨站 iframe 还需要父站允许对应子站使用 `cross-origin-isolated` 权限；组件已声明 `allow`。父站的其他跨域资源也必须满足 COEP。若 Flowtu 当前页面不具备隔离环境，先用独立窗口打开 DAW。本仓库包含 `_headers` 和静态托管的 service worker 兼容回退。生产环境请优先配置服务器响应头。未接入你们现有 Flowtu 仓库、登录或云端素材库。

## 来源与许可

- 上游：https://github.com/andremichelle/openDAW
- 对应源码快照：https://github.com/andremichelle/openDAW/tree/b78d6b0df53bc563010808a01789dd0a98b7a459
- `opendaw/` 包含该发布版 Studio UI、私有 UI 辅助包与集成改动。SDK 和 WASM 引擎使用同一发布版的 npm 包，pnpm 锁文件固定依赖。
- 保留上游 `opendaw/LICENSE` 及各文件许可；本修改版使用 AGPL-3.0-or-later。网页“源码”提供本修改版源码下载、构建指令和对应上游 SDK/引擎源码入口。
- openDAW 同时提供商业许可。正式闭源 SaaS 集成应先确定符合 AGPL 的方案或取得商业许可；此版本未替 Flowtu 取得商业授权。

主要改动：`opendaw/src/flowtu.ts` 中文快捷栏、四轨工程、完整工程包及视频同步；`flowtu.css` 样式；`boot.ts` 挂载；`main.ts` 隔离环境回退；`flowtu.vite.config.ts` 独立构建和引擎资产；`scripts/build.mjs` 源码包与发布。

## 实测记录（2026-10-25）

生产构建和 TypeScript 检查通过。浏览器中已完成：WAV 导入；音频从 2 秒裁短；钢琴卷帘新增并移动音符；播放和暂停；定位到 3 秒时参考视频也为 3 秒；首次保存；重新打开包含音频和视频的工程包；下载 WAV。FFmpeg 确认导出是非静音的 48 kHz 立体声，约 8.50 秒（包括合成器释放尾音）。完整原生 DAW 的全部高级功能未逐项测试。

上游可选 AI 工具的 ONNX 推理二进制按需从固定版本 jsDelivr CDN 加载；四轨播放、剪辑、MIDI、视频同步和 WAV 导出使用本地打包的 openDAW 引擎，不依赖此 CDN。AI 工具不在本次验证范围内。

## 自然语言创作与简化界面（2026-11-19）

轨道默认高度由 48px 增至 96px，并增大名称和常用控件。音色库、效果参数默认收起，可从顶部按钮展开；创作输入区固定在轨道下方，可单独折叠。

当前为用户选定的**本地规则指令生成器，未连接 AI 模型**，不产生 API 费用，不发送输入内容。支持电钢琴、钟琴（Tubular FM 合成）、贝斯、Pad、拨弦、主音（Vaporisateur）。真实采样乐器和任意云端预设不在本地指令范围。它直接调用 openDAW 乐器及效果器工厂，写入原生 MIDI 片段，可发声、编辑、保存、撤销和重做。

输入示例：

- `生成 4 小节温暖的电钢琴和弦，C 大调，90 BPM，加 15% 混响`
- `生成 8 小节拨弦琶音，A 小调`
- `把第 4 轨换成钟琴`
- `给第 2 轨加 25% 混响` / `关闭第 2 轨混响`
- `给选中轨加 20% 延迟`

默认新建乐器轨，也可选已有 MIDI 轨；文字中明确的轨号优先于下拉选择。生成会追加到所选轨播放头与已有片段末端之后的下一小节，不覆盖旧音符。效果指令作用于指定轨、下拉选择轨或当前选中轨。支持 1–32 小节、40–240 BPM、大小调、和弦/琶音/低音/旋律。生成器目前按 4/4 编写。下载 MIDI 输出标准 SMF 文件，只包含最近一次生成的音符；完整工程和效果请使用“保存工程”。

模块：`opendaw/src/flowtu/commands.ts` 负责可独立替换的指令解析与音符生成；`execute.ts` 将命令写入 openDAW；`Composer.ts` 提供输入、音色选择和反馈。未来接入 AI 时可复用命令执行层，并增加服务端调用和命令校验。

测试：`node --test opendaw/tests-flowtu/commands.test.mjs`（Node 24）。另在浏览器完成了六种音色生成、撤销/重做、混响参数修改、MIDI 下载、实际播放、WAV 导出与工程保存；后续验证结果以交付说明为准。

### 2026-11-19 · 蓝橙主题与连续创作上下文

界面参考 Flowtu 新主页：黑色背景、深蓝光晕、半透明圆角面板。蓝色用于编辑、选择与保存，橙色用于创作和导出；录音、错误和削波仍保留红色。

“沿用工程上下文”默认开启。先输入 `生成 4 小节电钢琴和弦，D 小调，90 BPM，和弦进行：Dm Bb F C`，再单独输入 `再加一条贝斯`：后者会继承调性和和弦，在参考片段起点创建贝斯，速度使用工程当前 BPM。和弦每小节一个，超过和弦数时循环。支持大小三和弦与 maj7 / m7 / 7。默认大调进行为 I–V–vi–IV，小调为 i–VI–III–VII。

- 上下文显示在输入框上方，可关闭继承或重置；明确新调性或和弦会更新参考。
- 新建乐器对齐参考片段；已有 MIDI 轨仍追加到末尾，保留原片段。
- 通过 openDAW `MetaData` 存在工程根节点中，与生成在同一个编辑事务里，支持撤销、重做及原生 `.odb` / `.flowtu.zip` 保存恢复。
- 参考片段被移动后，后续生成读取新起点；参考被删除或静音后停用继承。
- 当前记忆的是本地生成设定，不自动分析用户后来手动修改的音符、上传音频或视频中的和声，也没有连接主页或 AI。未来 AI 可以读取同一结构，再通过现有执行器写入音符和效果。

新增核心：`src/flowtu/context.ts`（项目元数据）、`src/flowtu/theme.ts`（原生控件配色）。本地规则测试覆盖连续指令继承、显式调性覆盖、和弦进行及 MIDI 输出。

### 2026-11-19 · 片段推子与交叉淡化

点顶部“音频剪辑”，选择片段 A，可用推子或 dB 数值调整片段音量（−60 至 +12 dB），填写淡入／淡出毫秒数，选择线性、柔和或缓入缓出曲线。在波形上拖蓝色／橙色方块可设置淡入、淡出长度，再上下拖各自曲线上的圆点调整弧度。新导入的片段默认使用柔和曲线。片段推子与原生调音台的整轨推子分别控制片段和音轨。

选片段 B 后，有两种交叉淡化方式：

- **使用已有重叠**：保持位置，为 A 尾部与 B 头部的重叠区应用淡化。
- **自动对接第二段**：设定时长（例如 200 ms），将 B 移至 A 尾部之前，使两段重叠，再应用淡化。交叉时长须短于两个片段。

同轨片段会显示在同一音频通道的两条子轨中，保留整轨音量和效果，使两段声音能够同时播放。已有不同音轨的片段继续使用各自音轨。片段被完全包含、冻结或静音，以及对接后会碰到第三个片段时，会给出提示。淡化使用 openDAW 原生工程字段，支持撤销／重做、工程包保存恢复和离线 WAV 导出；淡化时长按工程节拍保存，修改速度后对应的毫秒数会变化。曲线为原生指数曲线，未宣称精确等功率交叉淡化。

验证：使用 220 Hz 和 880 Hz 两个 4 秒测试片段，自动对接产生 1 秒线性交叉区。对实际导出的 WAV 做频率幅度分析，交叉区 10%、50%、90% 处的两段幅度分别为 90/10、50/50、10/90；另验证了片段增益、淡入数值、手柄拖动、撤销与工程保存恢复。`node --test opendaw/tests-flowtu/*.test.mjs` 覆盖交叉范围规划、无效范围、淡化长度约束及手柄位置。

### 2026-11-20 · 常驻剪辑工具栏与轨道音量包络

以工具选择、直接操作时间线为主：

- `1` 选择／移动：拖动片段，空白处框选，Shift 多选；边缘保留原生裁剪。
- `2` 切割：直接点击波形，切点使用当前吸附网格；也可点“切在播放头”。
- `3` 裁剪：从片段左半边拖动起点、右半边拖动终点，保留源素材。
- `4` 淡化：左半边调整淡入、右半边调整淡出，上下拖曲线上的圆点可单独调整弧度。
- `5` 静音／`6` 擦除：点击片段切换静音或删除，可撤销。
- 工具栏还提供剪切、复制、粘贴、重复、删除、循环选段、撤销／重做、吸附网格、缩放和交叉淡化／增益入口。重复保留多选片段的相对间距，避开已有片段。粘贴到已点选的兼容目标轨及当前播放头；工具栏复制存在应用内存中，原生系统快捷键剪贴板仍可使用。

“音量包络”创建或显示原生 Volume 自动化子轨，初始平线保持当前音量，不覆盖已有节点。子轨包络区域单击加点、拖动节点、Alt 单击或 Delete 删除所选节点；标题栏仍用于移动／裁剪整段包络。“R 读取”启用／旁路自动化，“节点编辑”打开原生详细编辑器。节点写入原生 ValueEvent 数据，参与音频引擎、撤销和工程持久化。自然语言创作区默认收起，可点“展开”继续输入。数字工具快捷键只在时间线或剪辑工具栏生效，不影响文字输入。

本轮 15 项自动测试通过，包括真实 Project 图创建、自动化参数目标、原音量保留、原生包络插值、撤销、旁路和二进制工程保存恢复。浏览器测试服务连续超时，本轮尚未验证实际鼠标拖拽和视觉布局；此前淡化版本的浏览器和 WAV 导出记录不替代本轮 UI 验证。

当前是基于 openDAW 的核心剪辑工作流，尚未覆盖胶水工具、滑移编辑、Touch/Latch 自动化写入及离线音频修复。范围选区已在下述版本加入。

### 2026-11-20 · English UI, floating video and Smart Range editing

The interface now uses English DAW labels with clearer text and contrast. Existing project names are preserved. The local composer still accepts Chinese and English commands.

The reference video is a draggable floating monitor. Drag its title bar to move it; drag the lower-right handle horizontally or vertically to size the monitor. The video keeps its original aspect ratio inside the window. Reset restores a visible default position. Geometry is saved locally and constrained to the viewport. Title-bar arrow keys move the window (Shift for larger steps); the resize handle also supports arrow keys. Moving or resizing keeps the existing video element and transport synchronization intact.

The Smart tool divides audio clips into editing zones: upper waveform/title for moving, center for selecting time, outer edges for trimming, colored handles for fades. Range selection can cross clips and gaps on the same audio lane. The highlighted selection supports Split Range, Delete Range, Loop Range, Cut, Copy and Paste. Deletion leaves later clips in place. Copy serializes cropped clips in a detached graph without editing the source project, retaining gaps and source offsets. Paste uses the current playhead and compatible destination track.

- A or V: Smart tool; B: split both ends of a drawn audio range, or switch to Blade when no range is drawn; R: Range; T: Trim; F: Fade; 5: Mute; M: Mark cue in Audio or Video mode; E: Erase.
- Number keys 1–6 remain available; 7 selects Range.
- Cmd/Ctrl+B splits the active range, or selected clips at the playhead when no range is active.
- Cmd/Ctrl+C/X/V copy, cut and paste within the editor. With an active range, only its contents are copied/cut. Toolbar Copy and keyboard Paste share the in-app clipboard.
- Delete/Backspace deletes the active range; Escape clears it or cancels a range drag. Shift bypasses grid snapping during range selection.
- Tool shortcuts are scoped to the timeline/toolbar and do not intercept text entry, dialogs or IME composition.

Validation includes real native graph range splitting/deletion/paste/undo, preservation of source offsets and gaps, unchanged project bytes after copying, floating-video pointer-event wiring and preservation of media state. This is not browser-layout, audible playback or real-mouse validation: the browser testing connection was unavailable during this update.

### Self-hosted instrument and effect library

The build ships the stock instrument and effect processors in `dist/wasm-engine/wasm/plugins/` and the Tubular factory cartridges in `dist/tubular/`. Serve the entire dist directory on your own host to load these from the Studio origin.

To use your own server for the optional sample, SoundFont, device preset and WCLAP catalogues as well, set `VITE_FLOWTU_LIBRARY_ROOT=/library` in `opendaw/.env.local` before starting or building Studio. Mount a static directory there, or place the files under `opendaw/public/library/`. Preserve the existing catalogue UUIDs so saved projects can resolve their sounds.

| Directory | Index | Data files |
| --- | --- | --- |
| samples | index.json (version 1 folder tree) | WAV named by UUID without extension |
| soundfonts | index.json (version 1 folder tree) | SoundFont named by UUID without extension |
| presets | index.json (array of PresetMeta) | UUID.odp |
| wclaps | index.json (version 1 folder tree) | UUID.wclap |

Start an unused preset catalogue with `[]` and each unused folder catalogue with `{"version":1,"folders":[]}`. The same-origin library is read-only in Studio. Install the indexes and their matching assets on the server. Without this setting, existing projects keep their original catalogue provider.


## Studio 真实 dev 联调

本地开发可显式开启仅监听本机的 API 代理：

```sh
FLOWTU_STUDIO_API_TARGET=https://dev.flowtu.cn pnpm --dir opendaw dev
```

代理只转发 `/api/e/*`，目标必须是无凭据的 HTTP(S) origin。默认不启用代理；发布构建仍使用 `/studio/` 同源挂载。同步与生成客户端都会携带主站 `flowtu_go_jwt` Bearer，并保留同源 Cookie。试听和加入工程按需鉴权下载音频，Bearer 仅发往同源 `/api/e/` 地址。不要把测试 JWT 写进配置、命令、日志或源码。

真实 dev 的工程协议检查可用 `opendaw/tests-flowtu/studio-live-checks.fixture.ts`，需在已授权的登录 origin 的空白页面运行。fixture 会创建标注为「联调临时」的工程并提供清理函数；`startLiveGeneration()` 会真实消耗积分，必须单独确认后调用一次。普通本地回归使用 `project-generation-browser.fixture.ts`，其中 API 为 stub，不消耗积分。

本地 API 代理不改变 OSS 的 CORS 白名单。2026-11-26 实测 `localhost:5199 → 127.0.0.1:4173 → OSS` 的跨源跳转使最终请求带 `Origin: null`，被 OSS 拦截。应在真正同源挂载环境补验，不应放行 null；不能通过 API 200 推断音频下载已通过。
