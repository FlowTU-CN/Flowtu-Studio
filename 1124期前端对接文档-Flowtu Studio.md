# 1124 期前端对接文档 - Flowtu Studio 云工程与生成主链路

- 期次：1124 期 | 状态：**可对接终稿 v1.1（2026-11-25）**——基于前端 11-25 版源码核对后定稿；工程同步协议=前端已实现照建，生成主链路=字段名锁定待联调
- 产品依据：《FlowTU Studio MVP 左栏与生成主链路 PRD》V0.4（sprint1123/）
- 设计文档：《Flowtu Studio 云工程接入 - 详细技术开发设计文档》（本目录）
- 响应包络：新规范 `{"ok":true,"code":200,"message":"success","logid":"...","data":{...}}`；错误 `{"ok":false,"code":<HTTP>,"error":"<语义码>","message":"<中文>","data":null}`，前端判 `error` 字段。**例外：工程包同步协议（§二点五）为二进制流+HTTP 原生语义，不走包络**

## 〇、部署形态（前端必读，2026-11-25 定稿）

| 项 | 定稿 | 前端动作 |
| --- | --- | --- |
| 挂载方式 | **主站域名路径挂载**：`https://www.flowtu.cn/studio/`（nginx location 指向 studio dist） | **构建必改**：vite `base: '/studio/'`（资源路径/AudioWorklet/WASM fetch 全部随 base，改后需全链路自测一遍，见 §3.7 spike） |
| 响应头 | COOP/COEP 两条由 **nginx 加**（前端不用管） | 页面将运行在 cross-origin-isolated 环境（SharedArrayBuffer 可用，引擎正常工作）；不要在页面里加重复头 |
| 登录态 | 同 origin（与主站同域），**无 token 换发、无跳转** | 直读主站登录态；存储位置（localStorage/cookie）为对接首项确认（见 §3.7） |
| 跨域 | 全部同域请求（`/api/e/*` 与页面同源） | **无需 CORS 配置**；fetch 保持前端现状（工程同步 `credentials: 'same-origin'` 正好正确） |
| 部署流程 | dist 独立发版：nginx root 指向 studio dist 目录，**只换文件即发版**，回滚=换回备份 | 构建产物结构与 11-25 版一致即可；主站发版不受影响 |
| 独立域名 | **弃用（2026-11-25 拍板）**：`daw.flowtu.cn` 后续下线，唯一入口 = `www.flowtu.cn/studio/` | 只构建一份产物（base `/studio/`）；切换上线时建议 nginx 给 daw.flowtu.cn 加 301 → `/studio/` 过渡存量书签 |

> 被否/弃用方案（不再讨论）：主站 SPA 前端路由（构建体系搬家）、iframe 嵌入（主站全局 COEP 污染）、独立域名跳转 + token 换发、daw.flowtu.cn 独立域名（弃用）。

## 一、端点总览（product-ext，前缀 /api/e）

> **鉴权双轨（挂载形态已定稿）**：生成主链路（§三）Bearer——前端同 origin 读主站登录态；工程包同步（§二点五）Cookie 同源会话——浏览器自动携带。均为同域请求，无跨域配置。

### 新增端点（生成侧 5 个 + 工程同步协议 1 组，2026-11-25 精简后）

| # | 方法 | 路径 | 用途 | PRD 章节 |
| --- | --- | --- | --- | --- |
| 1 | POST | `/me/studio-generations` | **提交歌曲生成（主链路核心）** | §3/§4.1 |
| 2 | GET | `/me/studio-generations/:key` | 生成状态轮询（成功返回 songs+签名播放 URL） | §4.1 |
| 3 | GET | `/me/studio-generations?projectId=` | 按工程列生成记录（Assets/再生成回填数据源） | §5/§6 |
| 4 | POST | `/me/studio-generations/:key/regenerate` | 再生成（载入原输入快照） | §5.2 |
| 5 | GET | `/me/studio-models` | 模型列表 + 能力矩阵 + 积分提示 | §3.1 |
| 6 | DELETE | `/studio/projects/:id` | 删除工程（后端待实现，§二点五；软删+OSS 清理） | — |

> 表中路径省略 `/api/e` 前缀；`projectId` 即 PUT 工程包时的路径 id（前端 `crypto.randomUUID()`）。

工程列表/下载/保存/删除走 §二点五同步协议（前端已实现）；Session/Cue 持久化在工程包内（odb 元数据），无独立端点。

### 复用端点（零改动）

| 用途 | 端点 |
| --- | --- |
| 上传参考附件/哼唱录音/本地音乐 | `POST /me/upload-audio`（两步式）+ `POST /me/uploaded-assets` |
| 素材重命名 | `PATCH /me/uploaded-assets/:assetKey/name` |
| 试听播放 | 现有签名播放（media_token/签名 URL） |
| Style 风格库 | 现有风格库接口 |
| 视频导入 | `POST /me/upload-video` |

## 二、核心时序

### 2.1 生成主链路（PRD §4.1，先生成后命名）

```
前端选择 In/Out + 填写 Music Direction（提示词/歌词/模型/数量/Style/方向图/附件）
  │ POST /me/upload-audio ×N（参考附件、哼唱录音，先行）
  │ POST /me/studio-generations {prompt, lyrics, contentType, model, count, style,
  │   direction:{melodyArrangement:{x,y}, emotionStyle:{x,y}}, inSec, outSec,
  │   refAudioKeys[], refMidiKeys[], hummingKey?, clientRequestId}
  │   ← {generationKey, status:"running"}   计费在此扣（沿用主站生成口径）
  │ 轮询 GET /me/studio-generations/:key（建议 3s 起，连续 5 次后步进到 5s；联调时定）
  │   ← status:"succeeded", songKeys:[...]（≤2，签名播放 URL）
  ▼ 首次成功 → 弹「给Studio取名」（同批多首仅弹一次）
  │ PUT /api/e/studio/projects/:uuid （If-None-Match:* 即新建）
  │   头带 X-Project-Name + X-Studio-Generation-Key → 后端回填 generations.studio_key
  ▼ 后续生成/编辑 → PUT 同一路径（If-Match 乐观锁，§二点五协议）
```

幂等约束：`clientRequestId` 重复提交返回既有 generationKey（不重复扣费、不重复发起）；命名保存重试复用原项目（PRD §6.2"重试不会重复创建"）。

### 2.2 Session/Cue 持久化（PRD §2.2 Use Selection）——**无后端调用**

Session/Cue 全部持久化在**工程包内 odb 元数据**（前端 schema `flowtu.score-cue.v1`：名称/起止秒/prompt/analysis），随 §二点五 PUT 整包保存、解包恢复。Use Selection 写包内状态即可。生成范围（inSec/outSec）只在提交生成时随 §3.1 传给后端（快照存 studio_generations）。

### 2.3 方向图两维

纯前端 UI（PRD §3.3），随 §3.1 提交生成传 `direction` 嵌套对象（结构与 3.1 示例一致）：`melodyArrangement`（旋律×配器）与 `emotionStyle`（情绪×风格），取值 0~100 整数，中心 50。后端映射 prompt 附加文案（四象限措辞），前端不感知映射细节。

## 二点五、工程包云同步协议（2026-11-25 按前端 11-25 版定稿，前端原样实现后端照建）

> 前端 `project-library.ts` 已完整实现该协议（IndexedDB 本地缓存 + 云端同步，离线优先），后端按此协议实现，前端仅改路径常量两行。**包络豁免**：本组接口为二进制流 + HTTP 原生语义（If-Match/ETag/412），不适用 `{ok,...}` 包络，api.md 登记为协议特例。

| 端点 | 方法 | 语义 |
| --- | --- | --- |
| `/api/e/studio/projects` | GET | 工程列表；Cookie 同源会话鉴权；响应 `{accountId, projects:[{id,name,revision,updatedAt,size}]}`（401=未登录） |
| `/api/e/studio/projects/:id` | GET | 下载工程包（zip 二进制流）；请求头 `If-Match: "revision"` + `X-Project-Account`；响应头 ETag；size 不符前端报完整性错误 |
| `/api/e/studio/projects/:id` | PUT | 保存工程包（`application/octet-stream`）；头 `X-Project-Name`(encodeURIComponent) + `If-Match`(更新)/`If-None-Match: *`(新建) + `X-Project-Account`；>16MB 先分片 `PUT :id/uploads/:uploadId/:partIndex`（12MB/片），终传带 `X-Project-Upload/Parts/Size`；响应 `{id,name,revision,updatedAt,size}` |
| 错误语义 | — | `412` revision 冲突（前端 ProjectConflict→提示另存副本）；`409` 业务错误（体 `{error}`）；`401` 登录失效（"Sign in again"） |

- 工程包内容（前端 zip v2，后端黑盒）：`project.odb` + `flowtu.json`（version 2：title/offset/timeSettings/activeVideoId/videos[]）+ `media/video-N`（视频内嵌）；**整包同步**（P6 定稿修订：云端引用模式作废，本地 IndexedDB=缓存层，云端=真身，跨设备从云端拉取）。
- 存储：OSS 按 `{uid}/studio/{projectId}/{revision}.zip`；配额按 zip size 计入用户总配额（402 同现有口径）。
- 鉴权：Cookie 同源会话（挂载主站形态下浏览器自动携带；ext Cookie 软鉴权通道现成）。
- 生成主链路关联：PUT 可选头 `X-Studio-Generation-Key`（首次命名保存携带 generationKey），无此头=普通保存。后端回填 `studio_generations.studio_key` = 该工程路径 id（前端 UUID）——**与 §3.3′ 查询参数 projectId 为同一标识**。

## 三、字段级契约

> 挂载形态已定稿（P2）：Studio 以 `www.flowtu.cn/studio/` 路径挂载主站，同 origin 直读主站登录态，无 token 换发端点。字段名遵循 camelCase 约定；`clientRequestId` 由前端生成 UUID。

### 3.0 `GET /me/studio-models` 模型列表与能力矩阵

```json
// data
{ "models": [
  { "model": "mureka-9.5",            // 模型标识（提交生成时回传）
    "label": "Mureka 9.5",
    "maxCount": 2,                     // 歌曲数量上限
    "capabilities": {                  // P11 能力矩阵：前端据此显隐输入控件
      "withLyrics": true, "instrumental": true,
      "refAudio": true, "refMidi": true,
      "humming": false, "refImage": false },
    "creditHint": 15 } ] }             // 单次生成积分提示（计费口径沿用主站）
```

**能力矩阵实值对照（2026-11-25，P11 待算法侧最终确认）**：

| PRD §3 能力 | 现有链路 | 矩阵初值 |
| --- | --- | --- |
| 带歌词/纯音乐完整歌曲 | Mureka 9.5（mureka-async） | true |
| 纯音乐/影视配乐 | Lyria（lyria-async，11-24 分段集成已定稿） | true |
| 模型下拉/数量≤2/歌词/Style | 现有模型配置与风格库 | true |
| 参考音频 | Mureka reference/remix 口径待确认 | 待确认 |
| 哼唱录音→歌曲 | 无模型支持 | **false（前端隐藏入口）** |
| 图片参考→生成 | 无模型支持 | **false（前端隐藏入口）** |
| 方向图结构化参数 | 无直接映射，prompt 四象限文案兜底（P10） | 按 prompt 映射 |

哼唱/图片参考如产品坚持要做，需算法侧引入新模型另行立项，不在 Studio 接入范围。

### 3.1 `POST /me/studio-generations` 提交生成（核心）

```json
// 请求体
{ "clientRequestId": "uuid-v4",        // 必填，幂等键（重复提交返回既有 generationKey，不重复扣费）
  "prompt": "紧张悬疑的追逐段落",         // 必填，文字描述
  "lyrics": "",                        // contentType=withLyrics 时必填；纯音乐忽略
  "contentType": "instrumental",       // 必填：instrumental | withLyrics
  "model": "mureka-9.5",               // 必填，来自 3.0 列表
  "count": 2,                          // 必填，1~models.maxCount（≤2）
  "style": "electronic",               // 可选，风格枚举；"follow"=跟随提示词（默认）
  "direction": {                       // 可选，方向图坐标 0~100 整数，中心 50
    "melodyArrangement": { "x": 30, "y": 70 },   // 旋律×配器
    "emotionStyle":       { "x": 80, "y": 20 } },  // 情绪×风格
  "inSec": 12.350, "outSec": 30.000,   // 必填，生成范围秒（三位小数），out>in≥0
  "refAudioKeys": ["s-xxxx", "up-xxxx"],  // 可选，音频参考（生成歌曲 songKey / 上传素材 assetKey）
  "refMidiKeys":   ["up-xxxx"],           // 可选，MIDI 参考
  "hummingKey": "up-xxxx" }               // 可选，哼唱录音（模型 capabilities.humming=true 才传）

// data 响应
{ "generationKey": "gen-<16hex>", "status": "running",
  "estimatedSeconds": 60, "billing": { "credits": 15 } }
```

错误：`400 invalid_params` / `402 insufficient_credits`（积分不足，文案同主站生成）/ `422 invalid_time_range` / `422 model_capability`（模型不支持所传参考类型）/ `429 rate_limit`。

```json
// 错误响应示例（生成侧接口统一此形态）
{ "ok": false, "code": 422, "error": "invalid_time_range",
  "message": "结束时间须大于开始时间", "data": null }
```

### 3.2 `GET /me/studio-generations/:key` 轮询

```json
// data（running 与终态同构）
{ "generationKey": "gen-xxx", "status": "succeeded",
  "songs": [                          // succeeded 时返回，1~2 首
    { "songKey": "s-xxxx", "title": "……", "durationMs": 180000,
      "playUrl": "https://…签名URL", "coverUrl": null } ],
  "errorCode": null,                  // failed 时如 "generation_failed"
  "createdAt": "2026-11-24T10:00:00+08:00", "completedAt": "…" }
```

- `playUrl` **已签名，前端直接用于 `<audio>`/试听，无需另调签名接口**；有效期约 5 分钟，过期后重拉 §3.2 或 §3.3′ 刷新；
- 轮询建议 3s 起步（见 §2.1），终态（succeeded/failed）后停止轮询。

### 3.3 ~~懒创建 / Session 端点 / 打开恢复~~ **已作废（2026-11-25 与前端实现对齐）**

前端 11-25 版已实现：新建=PUT `If-None-Match: *`（upsert，§二点五）；Cue/Session 持久化=工程包内 odb 元数据（schema `flowtu.score-cue.v1`：cue 名称/起止秒/prompt/analysis），恢复=解包，**不需要 sessions 独立端点与打开恢复端点**；工程名=PUT `X-Project-Name` 头。对应 DDL `studio_sessions` 表移除（生成范围快照已在 studio_generations）。

### 3.3′ `GET /api/e/me/studio-generations?projectId=xxx` 按工程列生成记录（真缺口，新增）

打开工程后拉取该工程的历史生成（Assets 音频与再生成回填的数据源；签名 URL 动态，包内不可缓存）：

```json
// data
{ "generations": [
  { "generationKey": "gen-xxx",
    "songs": [ { "songKey": "s-xxx", "title": "…", "durationMs": 180000, "playUrl": "https://…", "coverUrl": null } ],
    "input": { "prompt": "…", "lyrics": "…", "contentType": "instrumental", "model": "…", "count": 2,
               "style": "…", "direction": { "melodyArrangement": {"x":30,"y":70}, "emotionStyle": {"x":80,"y":20} },
               "inSec": 12.350, "outSec": 30.000 } } ] }
```

`input` 即再生成回填 Music Direction 的完整快照；`projectId` = PUT 工程包时的路径 id（前端 `crypto.randomUUID()`，见 §二点五关联说明）。

### 3.6 其余端点（契约先锁定，字段随实现补齐）

- 工程列表/下载/保存/删除：全部走 §二点五协议（前端已实现，仅 DELETE 待后端补：`DELETE /api/e/studio/projects/:id`，软删+OSS 清理队列）；
- `409 version_conflict` → 协议实际为 `412`（If-Match/ETag）；`package_invalid` 校验 = zip 缺 `project.odb` 422；
- `POST /me/studio-generations/:key/regenerate`：无 Body（复用原输入快照），返回同 3.1（新 generationKey）。

### 3.7 待确认清单（不阻塞契约，阻塞实现细节）

- vite base 改 `/studio/` 后 AudioWorklet/WASM/素材路径全链路 spike（前端，小时级）；
- `.odb` 内音频内嵌 vs 引用（仅影响 zip 体积预估，**整包同步定稿下不阻塞**；前端装依赖后读 `ProjectBundle.encode` 源码即可确认；视频已实证内嵌 media/video-N）；
- 模型能力矩阵实值与上游分流（P10~P12 算法侧，字段名已锁定可先行开发）。

## 四、前端注意事项

1. **生成计费沿用主站口径**：提交前积分提示取 §3.0 的 `creditHint`；提交响应的 `billing.credits` 为实际扣费值；402 `insufficient_credits` 处理与主站生成页一致；
2. **双模式共用端点**：后端不感知极简/专业模式，前端两模式各自组装入口；
3. **生成等待态**：PRD 要求「您的音频在生成中」提示框，轮询间隔对齐主站生成页既有节奏；
4. **登录态失效**：同域直读主站登录态，失效时引导用户走主站统一登录；工程包保存失败有本地 IndexedDB 兜底（前端离线优先架构自带），恢复后自动同步；
5. **数据口径**：生成产物均为标准 user_songs，试听/发布/FlowDeck 与主站完全一致，无特殊逻辑。
