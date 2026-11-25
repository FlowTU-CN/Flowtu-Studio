export const MAX_SECONDS = 180
export const uid = () => crypto.randomUUID()
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
export const snap = (value, bpm, enabled = true) => enabled ? Math.round(value / (60 / bpm / 4)) * (60 / bpm / 4) : value
export const activeTracks = tracks => tracks.filter(t => !t.mute && (!tracks.some(t => t.solo) || t.solo))
export function clipWindow(clip, cursor, sourceDuration) {
  const elapsed = Math.max(0, cursor - clip.start)
  const offset = clip.offset + elapsed
  const duration = Math.min(clip.duration - elapsed, sourceDuration - offset)
  return duration > 0 ? { delay: Math.max(0, clip.start - cursor), offset, duration } : null
}
export function splitClip(clip, time, bpm) {
  const position = time - clip.start
  if (position < 0.05 || position > clip.duration - 0.05) return null
  const left = structuredClone(clip), right = structuredClone(clip)
  right.id = uid(); left.duration = position; right.start = time; right.duration -= position
  if (clip.type === 'audio') right.offset += position
  else {
    const beat = position * bpm / 60
    left.notes = clip.notes.filter(n => n.beat < beat).map(n => ({ ...n, duration: Math.min(n.duration, beat - n.beat) }))
    right.notes = clip.notes.filter(n => n.beat + n.duration > beat).map(n => ({ ...n, id: uid(), beat: Math.max(0, n.beat - beat), duration: n.beat < beat ? n.beat + n.duration - beat : n.duration }))
  }
  return [left, right]
}
export function encodeWav(buffer) {
  const channels = Math.min(2, buffer.numberOfChannels), frames = buffer.length
  const result = new ArrayBuffer(44 + frames * channels * 2), view = new DataView(result)
  const text = (p, s) => [...s].forEach((c, i) => view.setUint8(p + i, c.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + frames * channels * 2, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * channels * 2, true)
  const data = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i))
  for (let i = 0; i < frames; i++) for (let ch = 0; ch < channels; ch++) {
    const sample = clamp(data[ch][i], -1, 1)
    view.setInt16(44 + (i * channels + ch) * 2, sample < 0 ? sample * 32768 : sample * 32767, true)
  }
  return result
}
export function validateProject(p) {
  if (!p || p.version !== 1 || !Array.isArray(p.tracks) || p.tracks.length !== 4) throw Error('这不是有效的 Flowtu 四轨工程。')
  const finite = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi
  if (!finite(p.bpm, 40, 240) || !finite(p.master, 0, 1)) throw Error('工程的速度或音量数据无效。')
  const ids = new Set()
  for (const t of p.tracks) {
    if (!Array.isArray(t.clips) || t.clips.length > 100 || !finite(t.volume, 0, 1)) throw Error('轨道数据无效。')
    for (const c of t.clips) {
      if (!c.id || ids.has(c.id) || !['audio', 'midi'].includes(c.type) || !finite(c.start, 0, MAX_SECONDS) || !finite(c.duration, .01, MAX_SECONDS) || c.start + c.duration > MAX_SECONDS + .001) throw Error('片段时间数据无效。')
      ids.add(c.id)
      if (c.type === 'audio' && (!finite(c.offset, 0, MAX_SECONDS) || typeof c.sourceId !== 'string')) throw Error('音频片段数据无效。')
      if (c.type === 'midi' && (!Array.isArray(c.notes) || c.notes.length > 4096 || c.notes.some(n => !finite(n.beat, 0, 720) || !finite(n.duration, .01, 720) || !finite(n.midi, 0, 127) || !finite(n.velocity, 0, 1)))) throw Error('音符数据无效。')
    }
  }
  return p
}
