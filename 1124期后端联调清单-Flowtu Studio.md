# 1124 期后端联调清单 - Flowtu Studio 云工程与生成主链路

- 读者:主站后端、算法侧、测试。前端侧《1124期前端对接文档-Flowtu Studio.md》(契约定稿 v1.1)已锁定字段;本文档是它的**执行清单**——后端照此实现、双方照此联调。
- 前端状态:三个阶段全部完成并通过 stub E2E(2026-11-26),等待后端端点就绪后进行一轮联调。
- 前端代码 = 协议行为基准,后端实现请对照:
  - 工程云同步客户端:`opendaw/src/flowtu/project-library.ts`(列表/下载/保存/分片/删除)
  - 生成主链路客户端:`opendaw/src/flowtu/studio-generations.ts`(5 端点/包络/轮询/幂等 journal)
  - 参考服务实现(自托管 Worker,与协议同语义,可直接照抄行为):`opendaw/server/project-cloud.mjs`
  - 服务端测试(含 DELETE/分片/并发写):`opendaw/tests-flowtu/project-cloud.test.mjs`

## 一、端点总览

### 生成侧(响应走 `{ok,code,message,logid,data}` 包络;错误 `{ok:false,code,error,message,data:null}`,前端判 `error` 字段)

| # | 方法 | 路径 | 用途 | 前端调用方 |
| --- | --- | --- | --- | --- |
| 1 | POST | `/api/e/me/studio-generations` | 提交生成(计费在此扣) | studio-generations.ts `submitGeneration` |
| 2 | GET | `/api/e/me/studio-generations/:key` | 状态轮询(含签名播放 URL) | `pollGeneration`/`fetchGeneration` |
| 3 | GET | `/api/e/me/studio-generations?projectId=` | 按工程列历史(回填数据源) | `listProjectGenerations` |
| 4 | POST | `/api/e/me/studio-generations/:key/regenerate` | 再生成(无 Body,复用原输入快照) | `regenerateGeneration` |
| 5 | GET | `/api/e/me/studio-models` | 模型列表 + 能力矩阵 + 积分提示 | `fetchStudioModels` |
| 6 | DELETE | `/api/e/studio/projects/:id` | 删除工程(软删 + OSS 清理) | project-library.ts `deleteCloudProject` |

### 工程包同步协议(§二点五;**包络豁免**——二进制流 + HTTP 原生语义,api.md 登记为协议特例)

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| GET | `/api/e/studio/projects` | 列表;响应**裸 JSON** `{accountId, projects:[{id,name,revision,updatedAt,size}]}`(不带 ok 包络);401=未登录 |
| GET | `/api/e/studio/projects/:id` | zip 二进制流;请求 `If-Match: "revision"` + `X-Project-Account`;响应头 `ETag`;size 不符前端报完整性错误 |
| PUT | `/api/e/studio/projects/:id` | 保存;`application/octet-stream`;头 `X-Project-Name`(encodeURIComponent)+ `If-Match`(更新)/`If-None-Match: *`(新建)+ `X-Project-Account`;可选 `X-Studio-Generation-Key`(见 §三 S6);>16MB 先分片 `PUT :id/uploads/:uploadId/:partIndex`(12MB/片),终传带 `X-Project-Upload/Parts/Size`;响应 `{id,name,revision,updatedAt,size}` |
| DELETE | `/api/e/studio/projects/:id` | 见 §二 ⑥ |

> ⚠️ 两套协议并存且前端严格区分:同步端点返回带 `{ok}` 信封的响应会被前端判为格式不符而回退离线模式(已在 E2E 中实测验证)。生成端点必须带信封,同步端点必须不带。

### 鉴权双轨(挂载形态:同 origin,`www.flowtu.cn/studio/`)

- 生成侧 5 端点:`Authorization: Bearer <flowtu_go_jwt>`(前端同域直读主站 localStorage)+ Cookie 会话;401 → 前端提示登录,不跳页
- 同步侧 + DELETE:Cookie 同源会话 + `X-Project-Account` 请求头(值 = 账号 id,服务端须复核与登录态一致,不一致 409)
- 全部同域请求,无 CORS 配置;但播放 URL 跨源下载有例外(见 §三 G10)

## 二、字段级契约要点(以 1124 文档 §三为准,此处列前端已实现的行为细节)

### ① POST /me/studio-generations 请求体

```json
{"clientRequestId":"uuid-v4","prompt":"…","lyrics":"","contentType":"instrumental|withLyrics",
 "model":"mureka-9.5","count":1,"style":"follow|cinematic|electronic|ambient|acoustic",
 "direction":{"melodyArrangement":{"x":30,"y":70},"emotionStyle":{"x":80,"y":20}},
 "inSec":12.350,"outSec":30.000,"refAudioKeys":[],"refMidiKeys":[],"hummingKey":null}
```

前端预检与服务端错误码一一对应(先拦住不发的已在客户端做):`invalid_params`(prompt/歌词空、count 越界)、`invalid_time_range`(out>in≥0,三位小数)、`model_capability`(按 §3.0 capabilities 判)。`direction` 中性时前端省略字段;style 默认 `follow`。前端 prompt 上限 500 字符、歌词 3000。

### ② 幂等与 journal

- `clientRequestId` 重复提交 → 返回既有 `generationKey`,不重复扣费、不重复发起
- 前端把提交体持久化在 localStorage(`flowtu.studio-generations.v1`):**服务端拒绝(4xx)→ 前端清 journal;网络失败 → 保留**,恢复后同 clientRequestId 重试——因此服务端对同一 clientRequestId 的重放必须幂等,不能视为新请求

### ③ 轮询节奏与签名 URL

- 前端 3s × 5 次后步进 5s,终态停止;`succeeded.songs` 1~2 首
- `playUrl` 已签名,前端 `<audio>` 直接播放;**前端另有「加入工程」功能会 fetch 该 URL 下载音频文件**(§三 G10)
- `failed.errorCode` 透传给用户,约定 `generation_failed` 为通用失败

### ④ 历史列表与 projectId

- `projectId` = 工程包 PUT 的路径 id(前端 `crypto.randomUUID()` 生成)
- 前端已把 projectId 持久化进工程元数据(schema `flowtu:cloud-project-id:v1`),刷新/重开工程后仍能按 id 拉历史——**服务端不要更改 PUT 路径 id 语义**
- `input` 快照 = 提交体去 clientRequestId;前端用它回填表单(direction/style 会反向转换,字段名必须与提交体一致)

### ⑤ 模型与能力矩阵(§3.0)

`maxCount` 驱动前端数量下拉;`capabilities` 驱动输入控件显隐;`creditHint` 为提交前积分提示,`billing.credits` 为实扣,两值可不同(口径见 §六)。

### ⑥ DELETE 语义(前端已实现,后端对齐)

- 头:`X-Project-Account`(必)+ `If-Match`(可选;**待对齐项 1**:后端若要求强制,前端一行改动)
- `404` = 已删除,前端按成功处理(幂等);`412` = 存在更新版本;`401` 登录失效
- 软删 + OSS 清理;数据分片(`data/{uid}/studio/{projectId}/…`)一并清理

## 三、联调用例清单(按序执行,✓ 通过 / ✗ 问题记录)

### 同步协议

| # | 用例 | 期望 |
| --- | --- | --- |
| S1 | 未登录 GET `/api/e/studio/projects` | 401;前端工程库回退游客模式 |
| S2 | PUT 新工程(`If-None-Match: *` + X-Project-Name + X-Project-Account) | 201,响应 `{id,name,revision,updatedAt,size}`;OSS 对象落在 `{uid}/studio/{projectId}/…` |
| S3 | 同 id 再 PUT 带 `If-Match: 旧revision` | 412;前端弹「另存副本」流程 |
| S4 | GET 下载带正确/错误 `If-Match` | 正确 → ETag 匹配 + 流完整(size 一致);错误 → 412 |
| S5 | >16MB 工程分片上传(含故意缺一片) | 分片 PUT 204;缺片终传 → 409;完整 → 200 |
| S6 | PUT 带 `X-Studio-Generation-Key: gen-xxx` | `studio_generations.studio_key` = 该工程路径 id;随后 `GET ?projectId=该id` 能查到该次生成 |
| S7 | DELETE(正确 revision / 旧 revision / 第二账号 / 已删后重删) | 204 / 412 / 404 / 404(幂等);对象与分片清理 |
| S8 | 会话过期后保存 | 401;前端提示 "Sign in again…"(文案联调时统一,见 §七) |

### 生成主链路

| # | 用例 | 期望 |
| --- | --- | --- |
| G1 | GET studio-models | models 含 label/maxCount/capabilities/creditHint;实值与 §五矩阵一致 |
| G2 | 提交合法请求 | `running` + `billing.credits` 实扣;积分余额同步扣减 |
| G3 | 同 clientRequestId 重放 | 返回同一 generationKey,不再扣费 |
| G4 | 积分不足提交 | 402 `insufficient_credits`,message 与主站生成页一致 |
| G5 | 越界 inSec/outSec / 哼唱 key(humming=false) | 422 `invalid_time_range` / 422 `model_capability` |
| G6 | 轮询到成功 | songs≤2;playUrl 签名可直接 `<audio>` 播放;有效期 ≥5 分钟,过期后重拉 §3.2 可刷新 |
| G7 | 上游失败 | `failed` + `errorCode`(约定 `generation_failed`);前端展示重试 |
| G8 | regenerate | 新 generationKey;复用原输入快照;计费同新提交 |
| G9 | 历史列表 projectId 正确/无关 id | 返回该工程 generations(含 input 快照)/ 空数组 |
| G10 | **跨源下载 playUrl**(`fetch(playUrl)`) | 需返回 CORS 头允许 Studio 源读取,或提供同源签名下载路径——前端「加入工程」依赖此项;**当前实现若不允许会明确报错,联调时定方案** |
| G11 | 高频提交 | 429 `rate_limit`,前端透传 message |

### 端到端(浏览器,前端已 stub 验证过,联调时换真实后端重跑)

| # | 场景 |
| --- | --- |
| E1 | 极简模式:选范围 → 填 Direction → 生成 → 试听 → 取名 → 工程入库(studio_key 回填) |
| E2 | 专业版:同上 + 方向图两盘坐标随提交上送 |
| E3 | 重新打开工程 → 历史生成显示 → 载入设置回填表单 → 再生成(不弹取名) |
| E4 | 加入工程:生成歌曲下载入素材库、拖入时间线 |
| E5 | 工程多端同步:A 设备保存 → B 设备打开;冲突 412 → 另存副本 |
| E6 | 删除云工程(含确认框、多端一致性) |

## 四、后端待实现清单(排期参考)

1. 生成 5 端点(含计费接入主站口径、clientRequestId 幂等、studio_generations 表与 DDL:input 快照 + studio_key 回填)
2. 同步协议 4 端点(行为基准:`project-cloud.mjs` + `project-library.ts`,含分片校验、onlyIf-ETag 并发保护、流式下载)
3. DELETE 软删 + OSS 清理队列
4. OSS 路径 `{uid}/studio/{projectId}/{revision}.zip`;配额按 zip size 计入用户总配额(402 同现有口径)
5. playUrl 跨源下载方案(G10)——CDN CORS 头或同源下载端点,二选一
6. api.md 登记:同步协议为包络特例

## 五、算法侧确认清单(勾选即可,不阻塞字段开发)

| 项 | 问题 | 影响前端 |
| --- | --- | --- |
| 1 | 参考音频:Mureka 9.5 走 reference 还是 remix 口径?songKey 可直接作参考还是需转 Mureka file id?数量上限? | 参考音频选择器(本期 D 项)的提交体组装 |
| 2 | refMidi 是否支持?key 格式? | 同上 |
| 3 | Lyria:是否支持歌词?maxCount 实值? | capabilities 下发 → 歌词入口/数量下拉 |
| 4 | 生成时长上限(inSec/outSec 合法区间,如最长 60s?) | 422 之外的前端预检提示 |
| 5 | 哼唱/图片参考确认 false | 前端已隐藏入口(现状即正确) |
| 6 | 方向图四象限 → prompt 文案映射措辞(P10) | 前端不感知映射,确认即可 |

## 六、计费口径

- 提交前提示:studio-models 的 `creditHint`(主站前端现有成本表是硬编码,Studio 以接口为准)
- 实扣:提交响应 `billing.credits`
- 402 文案与主站生成页一致;积分余额展示沿用主站 `membership-summary`(Studio 不重复实现)

## 七、文案与体验待对齐(联调时定,前端各一行改动)

1. DELETE `If-Match` 是否强制(前端现状:可选)
2. 401 文案统一主站登录引导(前端现状 "Sign in again…"/"Sign in on flowtu.cn to generate songs.")
3. 后端错误 `message` 为中文,前端直接透传展示——措辞建议与主站错误文案表对齐

## 八、已知边界(非缺陷,联调知悉)

- 前端播放签名 URL 的 `<audio>` 不受 COEP 限制;但 fetch 下载受 CORS 约束(G10 是唯一跨源请求)
- 工程同步为整包覆盖式(zip 黑盒),后端无需理解包内结构(`project.odb` + `flowtu.json` + `media/video-N`)
- 生成范围 inSec/outSec 只做提交快照,前端不要求服务端按秒截取音频

## 九、2026-11-26 后端答复后的前端适配

本节对应后端《1125期-studio后端联调答复-20261126.md》，区分本地验证与真实后端验收。

### 已落实的前端行为

- 生成提交的 HTTP 5xx、网络失败及缺少 generationKey 的异常成功响应保留 journal；明确的 4xx 拒绝清理。错误分类使用真实 HTTP 状态，不把包络业务 code 当作 HTTP 状态。
- journal 新记录绑定账号与工程图 UUID；“恢复生成”复用原 clientRequestId 和完整请求，有 generationKey 时只续接轮询。同一客户端内并行恢复合并提交。旧版没有上下文的 journal 保留但不自动关联账号/工程，避免误重放。
- 已确认落云的工程，新提交携带 projectId；提交前检查当前账号工程列表。再生成保持无 Body 契约，归属继承仍需后端实测确认。
- 两首展示以实际可播放结果为准；兼容可选 partial 标记，并在结果少于请求数量时提示。聚合 failed 时保留已有可播放歌曲，优先显示歌曲 failMessage / failLabel。
- 提交前积分提示为 creditHint × 数量，作为预计值。billing.credits 不作为实际扣费回执展示。
- 首次生成保存把工程 id 写入快照，并把 generationKey 保存在本机草稿。同步成功先持久化新 revision，再处理 X-Studio-Generation-Linked；0/error 提示关联未完成并保留关联 key，后续保存使用新 revision 重试。未带新头时兼容旧后端。
- 同步配额不足、503、超过 500MB、分片过期/不完整、已删除 id 和账号不匹配补充可操作提示；登录提示统一。本机草稿保留。
- 云生成面板没有开放音频/MIDI/哼唱参考入口；仍按能力矩阵预检，关闭能力时拒绝带参考参数。工程内本地 MIDI 的素材参考用途保持原有语义。

### 本地验证记录

- 类型检查：`pnpm typecheck`。
- 客户端与同步服务回归：`node --experimental-strip-types --test opendaw/tests-flowtu/project-generation-client.test.mjs opendaw/tests-flowtu/project-library-client.test.mjs opendaw/tests-flowtu/project-cloud.test.mjs`。
- 浏览器 fixture：启动 `pnpm --dir opendaw dev`，在独立浏览器上下文打开 `/studio/source.html`，执行 `await (await import('/studio/tests-flowtu/project-generation-browser.fixture.ts')).runGenerationBrowserChecks()`。
- 浏览器使用真实 DOM、localStorage 和 IndexedDB，接口为 stub。覆盖积分随数量变化、projectId、关闭参考参数、502 同请求恢复、两首部分成功、真实失败原因、成功歌曲保留、关联 0/error/1、新 revision 重试及配额失败草稿保留。
- 上述本地检查不能替代真实 dev 的计费、鉴权、OSS 下载和 E1～E6 验收。

### 仍需后端/产品对齐

1. dev 实际版本：答复开头为 262a21d，环境表为 5816e7b；确认可访问主站域名/端口与实际部署提交。
2. 采用部分成功 A 方案：首首已入队而第二首提交失败时返回成功响应、partial 标记，并明确实际提交首数和字段名；幂等重放保持相同结果信息。前端尚未依赖未定的实际首数字段名。
3. 生成提交幂等专项：502 后同 clientRequestId 重放不得重复扣费；replayed 时不能把已扣费结果显示成免费。实际扣费仍用余额/账单核对。
4. 两首均已提交但其中一首最终失败时，确认歌曲级失败字段、成功歌曲的保留与历史列表可见性（当前后端过滤 failed，可能隐藏混合结果）。
5. regenerate 的 projectId 继承以及网络中断后的恢复契约：当前端点无 Body，没有已约定的客户端幂等键；前端不自动重发该扣费请求，需后端补契约后再实现自动恢复。
6. X-Studio-Generation-Linked=0 包括“已有归属”；确认重复保存关联到同一工程应返回 1 还是 0，避免已关联成功但响应丢失后长期误报。当前前端 0 按关联待核实处理。
7. G4 积分不足、两首部分失败、生成失败兜底安排可控故障注入。G11 生成限流未实现，不能标记通过。
8. 视频分析另行接入：需完整 v1.2 契约，确认视频素材上传/assetKey、八字段结果映射及任务恢复；现有 score-vision 不等同于新端点。参考音频暂不纳入本期联调。


## 十、2026-11-26 真实 dev 联调记录

- 已确认入口：`https://dev.flowtu.cn`。`test0629.flowtu.cn` 及现有 `localhost:5199` 主站代理的两个 Studio 查询端点均返回 `503 {message:"StaticDir not configured"}`，不能代替 dev 验收。
- 本地通过显式 `FLOWTU_STUDIO_API_TARGET=https://dev.flowtu.cn` 代理访问。用户已授权仅将现有主站 JWT 用于 dev Studio 联调；令牌由主站页面随请求发送，不写进文件、工具参数或页面全局变量。
- 鉴权实测：无认证的工程列表返回 401，消息「请求头 Authorization 为空」；携带 Bearer、无 Cookie 的模型列表与工程列表返回 200。因此前端同步端点也补齐 Bearer，不能只依赖 Cookie。Cookie-only 登录支持情况仍需独立验证。
- G1：模型实值为 Mureka 9.5、maxCount=2、creditHint=15，音频/MIDI/哼唱/图片参考均 false。
- 工程包结构有校验：普通 ZIP 返回 409「Not a valid Flowtu project package.」。实际 Flowtu ZIP（project.odb + flowtu.json）已通过，ODB 使用 SDK 编码且可解包重开。
- S2/S3/S4：新建 201、更新 200、下载 200 且内容一致、旧 revision 保存/下载均 412。
- S5：17,827,831 字节包，两片分别返回 204，终传成功且下载大小一致；另造缺片，终传返回 409，原 revision 保持不变。
- 账号头与登录账号不一致返回 409；旧 revision 删除返回 412，工程仍可查询。
- 删除已验证：正确删除 204、重复删除 404；仅操作本次创建的联调工程。
- 生成：已单独获得一次真实生成授权（Mureka 9.5，纯音乐，1 首，预计 15 积分）。唯一一次提交返回 running，billing.credits=15、replayed=false，generationKey=`gen-f032c7e86191c99b`。该字段仍是后端计算口径，未据此宣称计费账单已核对。
- G6/G9：该次生成已返回 succeeded，歌曲 key=`mureka-eeddf0ce56824dd7`，工程历史返回 1 条且输入快照含原 prompt、模型、数量和范围。
- G10 当前环境未通过：playUrl 不带 Bearer 返回 401；携带 Bearer 后重定向到 OSS；本轮是 `localhost:5199 → 127.0.0.1:4173 代理 → OSS` 的跨源跳转，已核对最终请求头为 `Origin: null`，OSS 未返回允许来源头。此项是当前跨源联调拓扑下的失败，不能直接认定线上同源挂载也失败，亦不应要求放行 null。下一步需在正确登录的真正同源挂载环境补验 fetch 下载和加入工程。
- 直接用返回的 OSS 签名地址加载浏览器 audio 元数据已成功，时长为 187.254014 秒；没有自动播放。此结果证明媒体可解码，不替代 fetch 下载/CORS 验收。提交范围 0～10 秒仅为快照，与后端约定一致。
- 前端已修音频鉴权：试听改为按需鉴权下载 Blob，“加入工程”复用同一下载方法；仅向同源 `/api/e/` 地址附加 Bearer，外部 OSS 地址不附加。对象 URL 在结果替换/销毁时释放；下载后若工程已切换，不向新工程写入素材。
- 实际歌曲返回 songKey/title/playUrl，缺少 durationMs/coverUrl。前端已允许缺省，时长未加载时显示占位，音频 metadata 到达后更新，避免 NaN；建议后端补齐契约字段或明示可选。
- 所有本轮临时工程及本机草稿已清理；生成歌曲保留，未执行歌曲删除。未对用户已有工程做保存或删除。
- 本地回归已增补同步 Bearer 验证，共 16 项通过；类型检查通过，浏览器 stub 回归通过（含鉴权试听和缺省时长）。完整浏览器 E1～E6、第二账号隔离、两首部分失败与实际账单核对仍需专项验收。

## 十一、2026-11-27 test 主站入口验收

### 验收范围与版本边界

从 test 主站侧栏的「FlowTU Studio」实际点击进入，使用已登录的同源账号。线上主脚本为 `/studio/assets/main-C12FmJXF.js`。本轮未提交任何付费生成请求；仅创建并清理名称以 `QA-test0629-20261127-` 开头的测试工程，复用已有歌曲检查音频。

**线上页面与本地工作区不是同一功能版本**：远程 main 目前仅额外包含 build-info 修复 `2935eb5`；本地的静态资源子路径、路由依赖补丁、工程同步和云生成面板等改动仍未提交。下面区分线上复现、本地修复和后端独立验证，不能用后端接口通过代替页面流程通过。

### 已确认的问题

| 优先级 | 线上复现与证据 | 当前代码处理 |
| --- | --- | --- |
| P0 | 点击主站 `/studio/` 后，地址变成 `/create`；刷新实际回到主站，Studio 消失 | 已有子路径路由补丁需随锁文件发布；本轮补齐内部 LocalLink 的 href、Ctrl/⌘ 新窗口行为、已带前缀地址防重复，以及 `/users`、`/open-project` 的直接 history 替换路径 |
| P0 | 已登录且新工程接口返回 200，但「打开工程」提示云端不可用，「我的云工程」保存选项禁用；网络实际请求旧 `/api/projects` 并拿到主站 HTML | 本地新同步客户端已使用 `/api/e/studio/projects` 并携带 Bearer，尚未发布 |
| P0 | 极简和专业模式均不存在 `.ft-cloud-gen`，没有云歌曲生成、云历史和对应加入工程入口 | 本地 CloudGenerationPanel 及两模式接线、关联保存、下载客户端尚未发布，完整 E1/E3/E4 暂不能验收 |
| P1 | Rubik/Open Sans 请求 `/fonts/*`，HTTP 200 实际为 text/html，产生 Invalid font data；品牌图请求 `/flowtu-wordmark.png` 并破图 | 本地 Fonts/静态图/采样目录等 BASE_URL 适配需完整发布，不能只修 build-info |
| P1 | 「源代码」链接为 `/source.html`，拿到主站首页；正确页面是 `/studio/source.html` | 本地链接已按 BASE_URL 修改，尚未发布 |
| P1 | 「主页」仍指向旧的 chatgpt.site 演示站 | 本轮改为同源 `/`，仍允许 VITE_FLOWTU_HOME_URL 显式覆盖 |
| P2 | 帮助链接仍指向主站 `/manuals/` 等路径，本仓库未包含对应手册站点 | 需要确认产品希望保留官方手册还是主站帮助入口；未假定一个未经验证的新地址 |

补充代码检查：生成客户端此前无条件要求 prompt，与后端支持「歌词单独提交」不一致。本轮允许 withLyrics 的非空歌词单独提交，并在切回纯音乐后清空请求中的旧歌词；已加回归。

### 线上已通过的检查

- 主站菜单为普通 `/studio/` 链接；同源 JWT 可读取；Studio 的 crossOriginIsolated 为 true；build-info 与 WASM 加载正常。
- 《末班车》示例视频加载，时长 30 秒；极简/专业模式切换保持同一 video 元素及源；点击播放后视频时间推进。
- 本机保存 3,029,000 字节工程包并重开成功，视频恢复。示例自带 24 fps 设置，重开保留。
- **真实 test 后端（直接调用新协议，不代表旧 UI 已通）**：模型列表、工程列表 200；新建 201；下载 200，ETag 与 revision 一致且逐字节校验通过；更新 200；旧 revision 保存/下载/删除 412；账号头不匹配 409；未携带认证的列表 401。
- 分片实测：同一实际工程包分成两片上传；第一片 204，故意缺片终传 409，补第二片 204，再终传 200。
- 携带不存在的 generation key 保存仍返回 200，并给出 `X-Studio-Generation-Linked: 0`；工程 revision 正常推进。
- 同源音频下载实测：复用当前账号已有歌曲，经鉴权音频端点重定向到 OSS，fetch 返回 200、4,741,142 字节 audio/mpeg；Blob 在浏览器可解码，时长 197.482245 秒。没有自动播放该歌曲，没有产生新生成费用。本条补齐上一轮跨本地代理未通过的 G10 下载验证，但不替代缺失的「加入工程」UI 验收。
- 清理：本轮云测试工程删除 204、重复删除 404、删后下载 404；工程列表恢复到 0。仅删除本轮自己创建的本机 QA 草稿，账号已有歌曲保留。

### 修复验证与下一轮安排

- 本轮新增路由子路径/根路径回归、歌词单独提交回归；完整本地测试 82 项通过，0 失败；类型检查和生产构建通过。生产产物检查确认 /studio/ 资源前缀和云生成模块已包含，旧 build-info/字体根路径及旧演示站默认主页已移除。临时构建目录已清理，不制作发布交付包。
- 需把路由补丁及其 pnpm lock/workspace 配置、BASE_URL 资源适配、新工程同步和云生成接线完整纳入代码发布，避免再次只发布其中一两个文件。
- 下一轮必须在更新后的 test 页面验证：首次生成后命名保存、取消/失败后的保存恢复、云工程刷新重开、历史回填、试听及加入工程、多端冲突、跨账号隔离。真实生成及再生成有费用，需明确测试额度后进行。
- 两首部分成功、再生成幂等恢复、混合失败历史和实际账单核对仍按第九节等待契约与专项验证。
