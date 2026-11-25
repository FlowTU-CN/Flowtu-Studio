<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { AudioLines, Film, Music2, Play, Pause, Square, SkipBack, Repeat2, Upload, Download, Save, FolderOpen, Plus, Scissors, Copy, Trash2, Undo2, Redo2, Volume2, ChevronDown, X, KeyboardMusic, Maximize2, Headphones, SlidersHorizontal, Check, LoaderCircle, MousePointer2, Magnet, CircleHelp } from 'lucide-vue-next'
import Waveform from './Waveform.vue'
import { AudioEngine, createDemo } from './engine.js'
import { uid, clamp, snap, splitClip, validateProject, MAX_SECONDS } from './core.js'
import { loadLocal, saveLocal } from './storage.js'

const engine = new AudioEngine()
const tracks = ref([]), title = ref('Untitled session'), bpm = ref(120), master = ref(.72)
const cursor = ref(0), playing = ref(false), loop = ref(false), snapping = ref(true), zoom = ref(1)
const selectedTrack = ref('t4'), selectedClip = ref('c4'), selectedNote = ref(null)
const video = ref(null), videoUrl = ref(''), videoName = ref(''), videoDuration = ref(0), videoBlob = ref(null)
const audioInput = ref(null), videoInput = ref(null), projectInput = ref(null), timeline = ref(null), pianoGrid = ref(null)
const busy = ref(''), notice = ref(''), help = ref(false), saved = ref(false), modal = ref(null), projectMenu = ref(false)
const history = ref([]), future = ref([])
let raf, timer, toastTimer, importMode = 'add', runningToken = 0, destroyed = false, dragCleanup
const track = computed(() => tracks.value.find(t => t.id === selectedTrack.value))
const clip = computed(() => track.value?.clips.find(c => c.id === selectedClip.value))
const note = computed(() => clip.value?.notes?.find(n => n.id === selectedNote.value))
const contentEnd = computed(() => Math.max(8, videoDuration.value, ...tracks.value.flatMap(t => t.clips.map(c => c.start + c.duration))))
const duration = computed(() => Math.min(MAX_SECONDS, contentEnd.value))
const timelineDuration = computed(() => Math.min(MAX_SECONDS, Math.max(24, Math.ceil(duration.value / 8) * 8 + 4)))
const pxPerSecond = computed(() => 42 * zoom.value)
const timelineWidth = computed(() => timelineDuration.value * pxPerSecond.value)
const ruler = computed(() => Array.from({ length: Math.ceil(timelineDuration.value / 2) + 1 }, (_, i) => i * 2))
const pitches = Array.from({ length: 24 }, (_, i) => 71 - i)
const pianoBeats = computed(() => clip.value?.type === 'midi' ? Math.max(1, clip.value.duration * bpm.value / 60) : 16)
const gridWidth = computed(() => Math.max(720, pianoBeats.value * 48))
const noteName = midi => ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12] + (Math.floor(midi / 12) - 1)
const blackKey = midi => [1, 3, 6, 8, 10].includes(midi % 12)
const time = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${(value % 60).toFixed(2).padStart(5, '0')}`
const clone = value => JSON.parse(JSON.stringify(value))
function toast(message) { notice.value = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => notice.value = '', 5000) }
function snapshot() { return JSON.stringify({ tracks: tracks.value, bpm: bpm.value, title: title.value, master: master.value }) }
function commit() {
  const s = snapshot()
  if (history.value.at(-1) !== s) { history.value.push(s); if (history.value.length > 60) history.value.shift(); future.value = []; saved.value = false }
}
function applyState(s) {
  pause(); const p = JSON.parse(s); tracks.value = p.tracks; bpm.value = p.bpm; title.value = p.title; master.value = p.master
  if (!clip.value) { selectedClip.value = null; selectedNote.value = null }; saved.value = false
}
function undo() { if (history.value.length > 1) { future.value.push(history.value.pop()); applyState(history.value.at(-1)) } }
function redo() { if (future.value.length) { const s = future.value.pop(); history.value.push(s); applyState(s) } }
function pause() { runningToken++; cursor.value = clamp(engine.stop(), 0, duration.value); playing.value = false; video.value?.pause() }
async function play() {
  if (playing.value || busy.value) return
  const token = ++runningToken
  try {
    await engine.unlock()
    if (token !== runningToken) return
    if (cursor.value >= duration.value - .02) cursor.value = 0
    if (videoUrl.value && video.value && cursor.value < videoDuration.value - .04) {
      video.value.currentTime = cursor.value
      await video.value.play()
      if (token !== runningToken) { video.value.pause(); return }
    }
    engine.start(clone(tracks.value), bpm.value, cursor.value, master.value); playing.value = true
  } catch (e) { pause(); toast('无法开始播放：' + e.message) }
}
function togglePlay() { playing.value ? pause() : play() }
function stop() { pause(); seek(0) }
function seek(value) {
  const resume = playing.value; pause()
  cursor.value = clamp(Number(value) || 0, 0, duration.value); engine.offset = cursor.value
  if (video.value && videoUrl.value) video.value.currentTime = Math.min(cursor.value, videoDuration.value)
  if (resume) play()
}
function updateTransport() {
  if (playing.value) {
    cursor.value = engine.position()
    if (cursor.value >= duration.value) { if (loop.value) { pause(); seek(0); play() } else { pause(); seek(duration.value) } }
    else if (video.value && videoUrl.value && cursor.value < videoDuration.value - .08 && !video.value.seeking) {
      if (Math.abs(video.value.currentTime - cursor.value) > .12) video.value.currentTime = cursor.value
    }
  }
}
function frame() { updateTransport(); raf = requestAnimationFrame(frame) }
function reschedule() { if (playing.value) { const pos = engine.position(); engine.start(clone(tracks.value), bpm.value, pos, master.value) } commit() }
function setBpm(value) {
  pause(); const old = bpm.value; bpm.value = clamp(Number(value) || 120, 40, 240)
  for (const t of tracks.value) for (const c of t.clips) if (c.type === 'midi') {
    c.duration = Math.min(MAX_SECONDS - c.start, c.duration * old / bpm.value)
    c.notes = c.notes.filter(n => n.beat * 60 / bpm.value < c.duration)
  }
  commit()
}
function chooseClip(t, c) { selectedTrack.value = t.id; selectedClip.value = c.id; selectedNote.value = null }
function beginGesture(event, onMove, onEnd = commit) {
  if (event.button !== 0) return
  pause(); event.preventDefault(); dragCleanup?.()
  const move = e => { if (e.buttons === 0) { end(); return }; onMove(e) }
  const end = () => { cleanup(); onEnd() }
  const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('blur', end); dragCleanup = null }
  dragCleanup = cleanup
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); window.addEventListener('blur', end)
}
function dragClip(event, t, c, mode = 'move') {
  chooseClip(t, c); const origin = clone(c), x = event.clientX
  beginGesture(event, e => {
    const delta = (e.clientX - x) / pxPerSecond.value
    if (mode === 'move') c.start = clamp(snap(origin.start + delta, bpm.value, snapping.value), 0, MAX_SECONDS - c.duration)
    else if (mode === 'left' && c.type === 'audio') {
      const move = clamp(snap(origin.start + delta, bpm.value, snapping.value) - origin.start, Math.max(-origin.start, -origin.offset), origin.duration - .05)
      c.start = origin.start + move; c.offset = origin.offset + move; c.duration = origin.duration - move
    } else if (mode === 'right' && c.type === 'audio') {
      c.duration = clamp(snap(origin.duration + delta, bpm.value, snapping.value), .05, Math.min(MAX_SECONDS - c.start, engine.assets.get(c.sourceId).buffer.duration - c.offset))
    }
  })
}
function timelineSeek(event) { const rect = event.currentTarget.getBoundingClientRect(); seek((event.clientX - rect.left) / pxPerSecond.value) }
function editClip(field, value) {
  if (!clip.value) return
  pause(); const c = clip.value, v = Number(value)
  if (!Number.isFinite(v)) return
  if (field === 'start') c.start = clamp(v, 0, MAX_SECONDS - c.duration)
  if (field === 'offset' && c.type === 'audio') { c.offset = clamp(v, 0, engine.assets.get(c.sourceId).buffer.duration - .05); c.duration = Math.min(c.duration, engine.assets.get(c.sourceId).buffer.duration - c.offset) }
  if (field === 'duration') {
    c.duration = clamp(v, c.type === 'midi' ? .25 * 60 / bpm.value : .05, Math.min(MAX_SECONDS - c.start, c.type === 'audio' ? engine.assets.get(c.sourceId).buffer.duration - c.offset : MAX_SECONDS))
    if (c.type === 'midi') c.notes = c.notes.filter(n => n.beat < c.duration * bpm.value / 60).map(n => ({ ...n, duration: Math.min(n.duration, c.duration * bpm.value / 60 - n.beat) }))
  }
  commit()
}
function removeClip() { if (!clip.value) return; pause(); track.value.clips = track.value.clips.filter(c => c.id !== selectedClip.value); selectedClip.value = null; commit() }
function duplicateClip() {
  if (!clip.value) return
  const c = clone(clip.value); c.id = uid(); c.start += c.duration
  if (c.start + c.duration > MAX_SECONDS) { toast('片段超过 3 分钟原型时间范围。'); return }
  pause(); track.value.clips.push(c); selectedClip.value = c.id; commit()
}
function splitSelected() {
  if (!clip.value) return
  const result = splitClip(clone(clip.value), cursor.value, bpm.value)
  if (!result) { toast('把播放头放到所选片段内部，再进行分割。'); return }
  pause(); const index = track.value.clips.indexOf(clip.value); track.value.clips.splice(index, 1, ...result); selectedClip.value = result[1].id; commit()
}
function addMidi() {
  pause(); const c = { id: uid(), type: 'midi', name: 'New melody', start: Math.min(cursor.value, MAX_SECONDS - 16 * 60 / bpm.value), duration: 16 * 60 / bpm.value, notes: [] }
  track.value.clips.push(c); selectedClip.value = c.id; selectedNote.value = null; commit()
}
function addNote(event) {
  if (clip.value?.type !== 'midi' || event.target.closest('.note')) return
  pause(); const rect = pianoGrid.value.getBoundingClientRect()
  const beat = clamp(Math.floor((event.clientX - rect.left) / gridWidth.value * pianoBeats.value * 4) / 4, 0, pianoBeats.value - .25)
  const midi = clamp(71 - Math.floor((event.clientY - rect.top) / 14), 48, 71)
  const n = { id: uid(), midi, beat, duration: Math.min(1, pianoBeats.value - beat), velocity: .75 }
  clip.value.notes.push(n); selectedNote.value = n.id; engine.preview(midi); commit()
}
function dragNote(event, n, resize = false) {
  selectedNote.value = n.id
  const x = event.clientX, y = event.clientY, original = { ...n }
  engine.preview(n.midi)
  beginGesture(event, e => {
    const delta = Math.round((e.clientX - x) / gridWidth.value * pianoBeats.value * 4) / 4
    if (resize) n.duration = clamp(original.duration + delta, .25, pianoBeats.value - n.beat)
    else { n.beat = clamp(original.beat + delta, 0, pianoBeats.value - n.duration); n.midi = clamp(original.midi - Math.round((e.clientY - y) / 14), 48, 71) }
  })
}
function deleteNote(id = selectedNote.value) { if (clip.value?.type !== 'midi') return; pause(); clip.value.notes = clip.value.notes.filter(n => n.id !== id); selectedNote.value = null; commit() }
function importAudio(mode = 'add') { importMode = mode; audioInput.value.value = ''; audioInput.value.click() }
async function receiveAudio(files, targetId = selectedTrack.value) {
  const file = files?.[0]; if (!file) return
  if (file.size > 50 * 1024 * 1024) return toast('请选择小于 50 MB 的音频。')
  if (busy.value) return
  pause(); busy.value = '正在读取音频…'
  const destination = tracks.value.find(t => t.id === targetId), existing = importMode === 'replace' ? clip.value : null
  try {
    const id = uid(), buffer = await engine.addAsset(id, file.name, await file.arrayBuffer())
    if (existing?.type === 'audio') { existing.sourceId = id; existing.name = file.name; existing.offset = 0; existing.duration = Math.min(existing.duration, buffer.duration) }
    else {
      const start = Math.min(cursor.value, MAX_SECONDS - .05)
      const c = { id: uid(), type: 'audio', name: file.name, start, duration: Math.min(buffer.duration, MAX_SECONDS - start), offset: 0, sourceId: id }
      destination.clips.push(c); chooseClip(destination, c)
    }
    commit(); toast('音频已加入，可拖动片段两侧裁剪。')
  } catch (e) { toast('音频导入失败：' + e.message) } finally { busy.value = ''; importMode = 'add' }
}
async function receiveVideo(file) {
  if (!file || busy.value) return
  if (file.size > 250 * 1024 * 1024) return toast('请选择小于 250 MB 的参考视频。')
  pause(); busy.value = '正在读取视频…'; const url = URL.createObjectURL(file), probe = document.createElement('video')
  try {
    const length = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('读取超时，请尝试 H.264 MP4 或 WebM。')), 12000)
      probe.onloadedmetadata = () => { clearTimeout(timeout); resolve(probe.duration) }
      probe.onerror = () => { clearTimeout(timeout); reject(Error('浏览器不支持此视频编码，请尝试 H.264 MP4 或 WebM。')) }
      probe.src = url; probe.preload = 'metadata'
    })
    if (!Number.isFinite(length) || length > MAX_SECONDS) throw Error('原型支持最长 3 分钟的参考视频。')
    if (videoUrl.value) URL.revokeObjectURL(videoUrl.value)
    videoUrl.value = url; videoName.value = file.name; videoDuration.value = length; videoBlob.value = file; saved.value = false
    await nextTick(); video.value.currentTime = Math.min(cursor.value, length); toast('参考视频已就绪，原声静音，与工程同步。')
  } catch (e) { URL.revokeObjectURL(url); toast(e.message) } finally { probe.removeAttribute('src'); probe.load(); busy.value = '' }
}
function removeVideo() { pause(); URL.revokeObjectURL(videoUrl.value); videoUrl.value = ''; videoBlob.value = null; videoName.value = ''; videoDuration.value = 0; saved.value = false }
function onVideoStall() { if (playing.value && video.value?.readyState < 3) { pause(); toast('视频正在缓冲，待画面就绪后点击播放继续。') } }
function projectData() {
  const used = new Set(tracks.value.flatMap(t => t.clips.filter(c => c.type === 'audio').map(c => c.sourceId)))
  return { version: 1, title: title.value, bpm: bpm.value, master: master.value, tracks: clone(tracks.value), assets: [...engine.assets.values()].filter(a => used.has(a.id)).map(a => ({ id: a.id, name: a.name, bytes: a.bytes })), videoName: videoName.value }
}
async function save() {
  if (busy.value) return
  busy.value = '正在保存…'
  try { await saveLocal({ ...projectData(), videoBlob: videoBlob.value, videoDuration: videoDuration.value }); saved.value = true; toast('工程和素材已保存在当前浏览器。') }
  catch { toast('本地保存失败（可能空间不足），请导出工程文件备份。') } finally { busy.value = '' }
}
function download(blob, filename) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000) }
function toBase64(bytes) { const arr = new Uint8Array(bytes); let s = ''; for (let i = 0; i < arr.length; i += 16384) s += String.fromCharCode(...arr.subarray(i, i + 16384)); return btoa(s) }
async function exportProject() {
  const p = projectData(); p.assets = p.assets.map(a => ({ ...a, bytes: toBase64(a.bytes) }))
  download(new Blob([JSON.stringify(p)], { type: 'application/json' }), `${title.value || 'Flowtu'}.flowtu`); projectMenu.value = false
  toast('工程已导出，包含音频和音符；参考视频需要重新选择。')
}
async function restore(p, fromFile = false) {
  validateProject(p)
  if (!Array.isArray(p.assets) || p.assets.length > 100) throw Error('工程素材数量无效。')
  const staged = new Map(); let memory = 0
  for (const a of p.assets) {
    const bytes = fromFile ? Uint8Array.from(atob(a.bytes), c => c.charCodeAt(0)).buffer : a.bytes
    const buffer = await engine.ensure().decodeAudioData(bytes.slice(0))
    memory += buffer.length * buffer.numberOfChannels * 4
    if (buffer.duration > MAX_SECONDS || memory > 256 * 1024 * 1024) throw Error('工程音频超过原型容量限制。')
    staged.set(a.id, { id: a.id, name: a.name, bytes, buffer })
  }
  for (const t of p.tracks) for (const c of t.clips) if (c.type === 'audio' && (!staged.has(c.sourceId) || c.offset + c.duration > staged.get(c.sourceId).buffer.duration + .02)) throw Error('工程缺失音频素材或裁剪范围无效。')
  pause(); removeVideo(); engine.assets = staged; tracks.value = p.tracks; title.value = String(p.title || 'Untitled session').slice(0, 120); bpm.value = p.bpm; master.value = p.master
  selectedTrack.value = tracks.value[0].id; selectedClip.value = tracks.value[0].clips[0]?.id; seek(0)
  if (p.videoBlob) { videoBlob.value = p.videoBlob; videoUrl.value = URL.createObjectURL(p.videoBlob); videoName.value = p.videoName; videoDuration.value = p.videoDuration }
  history.value = [snapshot()]; future.value = []; saved.value = !fromFile
}
async function importProject(file) {
  if (!file || busy.value) return
  if (file.size > 100 * 1024 * 1024) return toast('工程文件超过 100 MB。')
  busy.value = '正在打开工程…'
  try { await restore(JSON.parse(await file.text()), true); toast('工程已打开；如有参考视频，请重新导入。') } catch (e) { toast('打开失败：' + e.message) } finally { busy.value = '' }
}
async function exportMix() {
  if (busy.value) return; pause(); busy.value = '正在混音导出…'
  try { const bytes = await engine.render(clone(tracks.value), bpm.value, duration.value, master.value); download(new Blob([bytes], { type: 'audio/wav' }), `${title.value || 'Flowtu'}-mix.wav`); toast('WAV 混音已导出。') }
  catch (e) { toast('导出失败：' + e.message) } finally { busy.value = '' }
}
function resetProject(demo) {
  dragCleanup?.(); pause(); removeVideo(); engine.assets.clear(); bpm.value = 120; master.value = .72
  tracks.value = createDemo(engine)
  if (!demo) { tracks.value.forEach(t => t.clips = []); engine.assets.clear() }
  title.value = demo ? 'First light / 日光练习' : 'Untitled session'; selectedTrack.value = 't4'; selectedClip.value = demo ? 'c4' : null
  seek(0); history.value = [snapshot()]; future.value = []; saved.value = false; modal.value = null; projectMenu.value = false
}
function keyboard(event) {
  if (event.target.closest('input,textarea,select,button') || modal.value || help.value) return
  if (event.code === 'Space') { event.preventDefault(); togglePlay() }
  if (event.code === 'Home') { event.preventDefault(); seek(0) }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); selectedNote.value ? deleteNote() : removeClip() }
  if (event.key.toLowerCase() === 's' && !(event.metaKey || event.ctrlKey)) splitSelected()
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save() }
}
function beforeUnload(event) { if (!saved.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(async () => {
  resetProject(true); raf = requestAnimationFrame(frame); timer = setInterval(updateTransport, 100)
  window.addEventListener('keydown', keyboard); window.addEventListener('beforeunload', beforeUnload)
  try { const p = await loadLocal(); if (p && !destroyed) { busy.value = '恢复已保存的工程…'; await restore(p); toast('已恢复上次保存的工程。') } } catch { toast('本地工程未能恢复，可以重新导入工程文件。') } finally { busy.value = '' }
})
onUnmounted(() => { destroyed = true; pause(); dragCleanup?.(); cancelAnimationFrame(raf); clearInterval(timer); clearTimeout(toastTimer); window.removeEventListener('keydown', keyboard); window.removeEventListener('beforeunload', beforeUnload); URL.revokeObjectURL(videoUrl.value); engine.context?.close() })
</script>

<template>
  <div class="studio">
    <aside class="rail"><div class="brand-mark"><AudioLines :size="23" /></div><button class="rail-item active" title="音频工作室" aria-label="音频工作室"><SlidersHorizontal :size="20" /></button><button class="rail-item" title="导入参考视频" aria-label="导入参考视频" @click="videoInput.click()"><Film :size="20" /></button><span class="rail-spacer"></span><button class="rail-item" aria-label="使用帮助" @click="help = true"><CircleHelp :size="20" /></button><div class="avatar">F</div></aside>
    <div class="workspace">
      <header class="topbar"><a class="wordmark" href="#">flowtu<span>STUDIO</span></a><div class="project-title"><input v-model="title" aria-label="工程名称" @change="commit" maxlength="120" /><span class="save-status"><i :class="{ saved }"></i>{{ saved ? '已保存到此浏览器' : '本地工程 · 未保存' }}</span></div><div class="top-actions"><div class="menu-wrap"><button class="button subtle" @click="projectMenu = !projectMenu"><FolderOpen :size="15" />工程<ChevronDown :size="13" /></button><div v-if="projectMenu" class="dropdown"><button @click="modal = 'empty'; projectMenu = false">新建空白工程</button><button @click="modal = 'demo'; projectMenu = false">载入示例工程</button><button @click="projectInput.value = ''; projectInput.click(); projectMenu = false">打开工程文件</button><button @click="exportProject">导出工程文件</button></div></div><button class="button subtle" :disabled="!!busy" @click="save"><Save :size="15" />保存</button><button class="button primary" :disabled="!!busy" @click="exportMix"><Download :size="15" />导出 WAV</button></div></header>
      <div class="transport"><div class="transport-buttons"><button class="icon-button" aria-label="回到开头" @click="seek(0)"><SkipBack :size="17" /></button><button class="play-button" :disabled="!!busy" :aria-label="playing ? '暂停' : '播放'" @click="togglePlay"><Pause v-if="playing" :size="19" fill="currentColor" /><Play v-else :size="19" fill="currentColor" /></button><button class="icon-button" aria-label="停止" @click="stop"><Square :size="15" fill="currentColor" /></button><button class="icon-button" :class="{ toggled: loop }" :aria-pressed="loop" aria-label="循环播放" @click="loop = !loop"><Repeat2 :size="18" /></button></div><div class="time-display">{{ time(cursor) }}<span>/ {{ time(duration) }}</span></div><div class="transport-divider"></div><label class="tempo"><input type="number" :value="bpm" min="40" max="240" aria-label="BPM" @change="setBpm($event.target.value)" /><span>BPM</span></label><div class="signature">4 / 4<span>拍号</span></div><span class="transport-space"></span><span class="engine-status"><i></i>{{ playing ? '正在播放' : '引擎就绪' }}</span><label class="master"><Volume2 :size="16" /><input type="range" min="0" max="1" step="0.01" v-model.number="master" aria-label="总音量" @input="engine.master && (engine.master.gain.value = master)" @change="commit" /><span>{{ Math.round(master * 100) }}%</span></label></div>
      <main>
        <section class="preview-row">
          <div class="video-panel panel"><div class="panel-heading"><div><Film :size="15" /><span>参考画面</span><span class="tag">VIDEO SYNC</span></div><div><span class="muted small">原声静音</span><button v-if="videoUrl" class="icon-button small-button" title="移除视频" aria-label="移除视频" @click="removeVideo"><X :size="15" /></button><button class="icon-button small-button" :disabled="!videoUrl" title="全屏预览" aria-label="全屏预览" @click="video?.requestFullscreen?.()"><Maximize2 :size="14" /></button></div></div><div class="video-stage" @dragover.prevent @drop.prevent="receiveVideo($event.dataTransfer.files[0])"><video v-if="videoUrl" ref="video" :src="videoUrl" muted playsinline preload="auto" @waiting="onVideoStall" @error="toast('视频播放失败，请换用 H.264 MP4 或 WebM。')" /><div v-else class="video-empty"><div class="frame-corner tl"></div><div class="frame-corner tr"></div><div class="frame-corner bl"></div><div class="frame-corner br"></div><Film :size="32" :stroke-width="1" /><h2>让声音，跟上画面。</h2><p>拖入参考视频，开始你的配乐</p><button class="button outlined" :disabled="!!busy" @click="videoInput.value = ''; videoInput.click()"><Plus :size="14" />导入视频</button><span class="format-hint">MP4 / WEBM · 最长 3 分钟</span></div><div v-if="videoUrl" class="video-overlay"><span>{{ videoName }}</span><span>{{ time(cursor) }}</span></div></div><div class="video-footer"><span><i class="status-dot"></i>{{ videoUrl ? '已连接工程时钟' : '等待参考视频' }}</span><button @click="videoInput.value = ''; videoInput.click()">{{ videoUrl ? '替换视频' : '选择本地视频' }}<Upload :size="12" /></button></div></div>
          <div class="inspector panel"><div class="panel-heading"><div><SlidersHorizontal :size="15" /><span>片段设置</span></div><span class="tag">{{ clip ? (clip.type === 'audio' ? 'AUDIO' : 'MIDI') : 'INSPECTOR' }}</span></div><template v-if="clip"><div class="clip-summary"><div class="clip-symbol" :style="{ color: track.color }"><AudioLines v-if="clip.type === 'audio'" :size="25" /><KeyboardMusic v-else :size="25" /></div><div><input v-model="clip.name" aria-label="片段名称" @change="commit" /><span>{{ track.name }} <b>·</b> {{ clip.type === 'audio' ? '音频片段' : `${clip.notes.length} 个音符` }}</span></div></div><div class="property-grid"><label>开始位置 <span>秒</span><input type="number" :value="clip.start.toFixed(2)" min="0" step="0.1" aria-label="片段开始位置" @change="editClip('start', $event.target.value)" /></label><label>片段长度 <span>秒</span><input type="number" :value="clip.duration.toFixed(2)" min="0.05" step="0.1" aria-label="片段长度" @change="editClip('duration', $event.target.value)" /></label><label v-if="clip.type === 'audio'">素材入点 <span>秒</span><input type="number" :value="clip.offset.toFixed(2)" min="0" step="0.1" aria-label="素材入点" @change="editClip('offset', $event.target.value)" /></label><div v-else class="instrument-label"><span>乐器</span><strong>Soft keys <span>柔和琴音</span></strong></div><label>轨道音量 <span>%</span><input type="number" :value="Math.round(track.volume * 100)" min="0" max="100" aria-label="所选轨道音量" @change="track.volume = clamp(Number($event.target.value) / 100, 0, 1); reschedule()" /></label></div><div class="clip-actions"><button class="button outlined" v-if="clip.type === 'audio'" :disabled="!!busy" @click="importAudio('replace')"><Upload :size="14" />替换音频</button><button class="button outlined" @click="duplicateClip"><Copy :size="14" />复制</button><button class="icon-button danger" aria-label="删除片段" @click="removeClip"><Trash2 :size="15" /></button></div></template><div v-else class="inspector-empty"><MousePointer2 :size="25" /><p>选择时间轴中的片段</p><span>调整位置、长度或替换素材</span></div></div>
        </section>
        <section class="arrangement panel"><div class="arrangement-toolbar"><div class="section-title">编排 <span>04 TRACKS</span></div><div class="edit-tools"><button class="icon-button" :disabled="history.length < 2" aria-label="撤销" @click="undo"><Undo2 :size="16" /></button><button class="icon-button" :disabled="!future.length" aria-label="重做" @click="redo"><Redo2 :size="16" /></button><span class="tool-divider"></span><button class="icon-button" :disabled="!clip" aria-label="在播放头处分割片段" title="分割片段 · S" @click="splitSelected"><Scissors :size="16" /></button><button class="icon-button" :class="{ toggled: snapping }" :aria-pressed="snapping" aria-label="网格吸附" @click="snapping = !snapping"><Magnet :size="16" /></button></div><span class="transport-space"></span><label class="zoom-control">缩放<input type="range" v-model.number="zoom" min="0.5" max="3" step="0.25" aria-label="时间轴缩放" /></label><button class="button subtle" :disabled="!track || !!busy" @click="addMidi"><Plus :size="14" />音符片段</button><button class="button outlined" :disabled="!track || !!busy" @click="importAudio()"><Upload :size="14" />导入音频</button></div>
          <div class="timeline-layout"><div class="track-headers"><div class="track-ruler">轨道 / TRACKS</div><div v-for="(t, index) in tracks" :key="t.id" class="track-header" :class="{ selected: selectedTrack === t.id }" :style="{ '--track-color': t.color }" @click="selectedTrack = t.id; selectedClip = t.clips[0]?.id; selectedNote = null"><div class="track-name"><span class="track-number">0{{ index + 1 }}</span><input v-model="t.name" :aria-label="`轨道 ${index + 1} 名称`" @change="commit" /></div><div class="track-controls"><button :class="{ on: t.mute }" :aria-label="`静音轨道 ${index + 1}`" :aria-pressed="t.mute" @click.stop="t.mute = !t.mute; reschedule()">M</button><button :class="{ on: t.solo }" :aria-label="`独奏轨道 ${index + 1}`" :aria-pressed="t.solo" @click.stop="t.solo = !t.solo; reschedule()">S</button><input type="range" min="0" max="1" step="0.01" v-model.number="t.volume" :aria-label="`轨道 ${index + 1} 音量`" @click.stop @input="reschedule" /></div></div></div><div class="timeline-scroll" ref="timeline"><div class="timeline-content" :style="{ width: `${timelineWidth}px`, '--grid-size': `${pxPerSecond * 2}px` }"><div class="ruler" @pointerdown="timelineSeek"><span v-for="second in ruler" :key="second" :style="{ left: `${second * pxPerSecond}px` }">{{ time(second).slice(0, 5) }}</span></div><div v-for="t in tracks" :key="t.id" class="track-lane" :class="{ selected: selectedTrack === t.id }" @pointerdown.self="selectedTrack = t.id; selectedClip = null; timelineSeek($event)" @dragover.prevent @drop.prevent="importMode = 'add'; receiveAudio($event.dataTransfer.files, t.id)"><span v-if="!t.clips.length" class="empty-lane">拖入音频，或添加音符片段</span><div v-for="c in t.clips" :key="c.id" class="timeline-clip" :class="{ active: selectedClip === c.id, muted: t.mute, midi: c.type === 'midi' }" :style="{ left: `${c.start * pxPerSecond}px`, width: `${c.duration * pxPerSecond}px`, '--clip-color': t.color }" role="button" tabindex="0" :aria-label="`片段 ${c.name}`" @focus="chooseClip(t, c)" @pointerdown.stop="dragClip($event, t, c)" @keydown.enter="chooseClip(t, c)"><div class="clip-header"><Music2 v-if="c.type === 'midi'" :size="11" /><AudioLines v-else :size="11" /><span>{{ c.name }}</span></div><Waveform v-if="c.type === 'audio'" :buffer="engine.assets.get(c.sourceId)?.buffer" :offset="c.offset" :duration="c.duration" :color="t.color" /><div v-else class="mini-notes"><i v-for="n in c.notes" :key="n.id" :style="{ left: `${n.beat * 60 / bpm / c.duration * 100}%`, width: `${n.duration * 60 / bpm / c.duration * 100}%`, top: `${(71 - n.midi) / 24 * 100}%` }"></i></div><div v-if="c.type === 'audio'" class="trim-handle left" @pointerdown.stop="dragClip($event, t, c, 'left')"></div><div v-if="c.type === 'audio'" class="trim-handle right" @pointerdown.stop="dragClip($event, t, c, 'right')"></div></div></div><div class="playhead" :style="{ left: `${cursor * pxPerSecond}px` }"><span></span></div></div></div></div><div class="timeline-footer"><span><span class="keyboard-key">SPACE</span> 播放 / 暂停 <b>·</b> 拖动片段编排，拖动两侧裁剪</span><span>{{ tracks.reduce((s, t) => s + t.clips.length, 0) }} 个片段 <b>·</b> {{ time(duration) }}</span></div>
        </section>
        <section class="piano-panel panel"><div class="panel-heading"><div><KeyboardMusic :size="16" /><span>钢琴卷帘窗</span><span class="tag">PIANO ROLL</span><span v-if="clip?.type === 'midi'" class="muted small">{{ clip.name }}</span></div><div v-if="clip?.type === 'midi'" class="piano-tools"><span class="muted small">1/16 网格</span><label v-if="note" class="velocity">力度 <input type="range" min="0.05" max="1" step="0.05" v-model.number="note.velocity" aria-label="音符力度" @change="reschedule" /></label><button class="icon-button small-button" :disabled="!note" aria-label="删除音符" @click="deleteNote()"><Trash2 :size="14" /></button></div></div><div v-if="clip?.type === 'midi'" class="piano-scroll"><div class="piano-inner" :style="{ width: `${gridWidth + 50}px` }"><div class="piano-ruler"><span v-for="i in Math.ceil(pianoBeats / 4)" :key="i" :style="{ left: `${50 + (i - 1) * 4 / pianoBeats * gridWidth}px` }">{{ i }}</span></div><div class="piano-keys"><button v-for="pitch in pitches" :key="pitch" :class="{ black: blackKey(pitch) }" :aria-label="`试听 ${noteName(pitch)}`" @click="engine.preview(pitch)">{{ pitch % 12 === 0 ? noteName(pitch) : '' }}</button></div><div class="piano-grid" ref="pianoGrid" :style="{ width: `${gridWidth}px`, '--beat-width': `${gridWidth / pianoBeats}px` }" @pointerdown.self="addNote"><div v-for="pitch in pitches" :key="pitch" class="piano-row" :class="{ black: blackKey(pitch) }" @pointerdown="addNote"></div><div v-for="n in clip.notes" :key="n.id" class="note" :class="{ selected: selectedNote === n.id }" :style="{ left: `${n.beat / pianoBeats * gridWidth}px`, width: `${n.duration / pianoBeats * gridWidth}px`, top: `${(71 - n.midi) * 14 + 1}px`, opacity: .45 + n.velocity * .55 }" :title="`${noteName(n.midi)} · 拖动移动，右侧拉伸，右键删除`" @pointerdown.stop="dragNote($event, n)" @contextmenu.prevent="deleteNote(n.id)"><span>{{ noteName(n.midi) }}</span><i @pointerdown.stop="dragNote($event, n, true)"></i></div><div v-if="cursor >= clip.start && cursor <= clip.start + clip.duration" class="piano-playhead" :style="{ left: `${(cursor - clip.start) / clip.duration * gridWidth}px` }"></div></div></div></div><div v-else class="piano-empty"><KeyboardMusic :size="24" /><div><p>选中音符片段，写下你的旋律</p><span>或在当前轨道添加一个新的音符片段</span></div><button class="button outlined" :disabled="!track || !!busy" @click="addMidi"><Plus :size="14" />添加音符片段</button></div><div v-if="clip?.type === 'midi'" class="piano-hint">点击空白处添加音符 · 拖动移动 · 拖动右侧改变长度 · 右键删除</div></section>
        <footer class="page-footer"><span>FLOWTU STUDIO <b> / </b> MAKE SPACE FOR SOUND.</span><span><Headphones :size="13" />推荐使用耳机试听 · 素材仅在当前浏览器处理</span></footer>
      </main>
    </div>
    <input ref="audioInput" hidden type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac" @change="receiveAudio($event.target.files)" /><input ref="videoInput" hidden type="file" accept="video/*,.mp4,.webm,.mov" @change="receiveVideo($event.target.files[0])" /><input ref="projectInput" hidden type="file" accept=".flowtu,.json" @change="importProject($event.target.files[0])" />
    <div v-if="notice" class="toast" role="status"><Check :size="16" />{{ notice }}<button aria-label="关闭提示" @click="notice = ''"><X :size="13" /></button></div><div v-if="busy" class="busy-badge" role="status"><LoaderCircle class="spin" :size="16" />{{ busy }}</div>
    <div v-if="help || modal" class="modal-backdrop" @click.self="help = false; modal = null"><div class="modal"><button class="modal-close icon-button" aria-label="关闭" @click="help = false; modal = null"><X :size="19" /></button><template v-if="help"><h2>你的四轨声音工作台</h2><p>1. 导入参考视频：画面与工程同步，视频原声静音。</p><p>2. 选择轨道，导入音频或添加音符片段。</p><p>3. 拖动音频两侧裁剪，用 S 在播放头处分割。</p><p>4. 点击钢琴格添加音符，拖动右侧调整长度。</p><p>5. 保存到浏览器，或导出工程备份、WAV 混音。</p><div class="help-note">原型限制：最长 3 分钟；单个音频 50 MB、视频 250 MB；基础琴音；不包含视频剪辑或 MP4 合成导出。工程文件包含音频，参考视频需重新选择。</div></template><template v-else><h2>{{ modal === 'demo' ? '载入示例工程？' : '开始一个新工程？' }}</h2><p>当前工作区会被替换。未保存的修改不会自动保留，请先保存或导出工程。</p><div class="modal-actions"><button class="button outlined" @click="modal = null">取消</button><button class="button primary" @click="resetProject(modal === 'demo')">继续</button></div></template></div></div>
  </div>
</template>
