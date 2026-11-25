import { activeTracks, clipWindow, encodeWav } from './core.js'

export class AudioEngine {
  context = null
  assets = new Map()
  sources = []
  playing = false
  offset = 0
  anchor = 0
  master = null
  ensure() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' })
      this.master = this.context.createGain(); this.master.connect(this.context.destination)
    }
    return this.context
  }
  async unlock() { await this.ensure().resume() }
  position() { return this.playing ? this.offset + this.context.currentTime - this.anchor : this.offset }
  stop() {
    this.offset = this.position(); this.playing = false
    this.sources.forEach(node => { try { node.stop() } catch {} }); this.sources = []
    if (this.bus) { this.bus.disconnect(); this.bus = null }
    return this.offset
  }
  start(tracks, bpm, offset, volume) {
    this.stop(); const ctx = this.ensure()
    this.offset = offset; this.anchor = ctx.currentTime; this.playing = true
    this.master.gain.value = volume
    this.bus = ctx.createGain(); this.bus.connect(this.master)
    this.sources = schedule(ctx, this.bus, tracks, this.assets, bpm, offset, ctx.currentTime)
  }
  async addAsset(id, name, bytes) {
    const buffer = await this.ensure().decodeAudioData(bytes.slice(0))
    if (buffer.duration > 180) throw Error('原型支持最长 3 分钟的音频，请先使用更短的素材。')
    const memory = buffer.length * buffer.numberOfChannels * 4
    if (memory + [...this.assets.values()].reduce((s,a) => s + a.buffer.length * a.buffer.numberOfChannels * 4, 0) > 256 * 1024 * 1024) throw Error('音频缓存已达 256 MB，请新建工程后再导入。')
    this.assets.set(id, { id, name, buffer, bytes }); return buffer
  }
  preview(midi, volume = .18) {
    this.unlock().then(() => playNote(this.context, this.master, midi, this.context.currentTime, .3, volume))
  }
  async render(tracks, bpm, duration, volume) {
    const ctx = new OfflineAudioContext(2, Math.ceil(duration * 44100), 44100)
    const gain = ctx.createGain(); gain.gain.value = volume; gain.connect(ctx.destination)
    schedule(ctx, gain, tracks, this.assets, bpm, 0, 0)
    return encodeWav(await ctx.startRendering())
  }
}

function playNote(ctx, output, midi, when, duration, volume) {
  const oscillator = ctx.createOscillator(), envelope = ctx.createGain()
  oscillator.type = 'triangle'; oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12)
  const attack = Math.min(.012, duration / 3)
  envelope.gain.setValueAtTime(0, when); envelope.gain.linearRampToValueAtTime(volume, when + attack)
  envelope.gain.exponentialRampToValueAtTime(Math.max(.0001, volume * .28), when + Math.max(attack, duration * .8))
  envelope.gain.linearRampToValueAtTime(0, when + duration)
  oscillator.connect(envelope); envelope.connect(output)
  oscillator.start(when); oscillator.stop(when + duration + .01)
  oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect() }
  return oscillator
}

function schedule(ctx, destination, tracks, assets, bpm, cursor, now) {
  const sources = [], secondsPerBeat = 60 / bpm
  for (const track of activeTracks(tracks)) {
    const gain = ctx.createGain(); gain.gain.value = track.volume; gain.connect(destination)
    for (const clip of track.clips) {
      if (clip.type === 'audio') {
        const asset = assets.get(clip.sourceId); if (!asset) continue
        const window = clipWindow(clip, cursor, asset.buffer.duration); if (!window) continue
        const source = ctx.createBufferSource(), envelope = ctx.createGain()
        source.buffer = asset.buffer; source.connect(envelope); envelope.connect(gain)
        const start = now + window.delay, end = start + window.duration
        envelope.gain.setValueAtTime(0, start); envelope.gain.linearRampToValueAtTime(1, start + Math.min(.005, window.duration / 3))
        envelope.gain.setValueAtTime(1, Math.max(start + window.duration / 3, end - .005)); envelope.gain.linearRampToValueAtTime(0, end)
        source.start(start, window.offset, window.duration); sources.push(source)
        source.onended = () => { source.disconnect(); envelope.disconnect() }
      } else {
        for (const note of clip.notes) {
          const start = clip.start + note.beat * secondsPerBeat
          const end = Math.min(clip.start + clip.duration, start + note.duration * secondsPerBeat)
          if (end <= cursor || start >= clip.start + clip.duration) continue
          sources.push(playNote(ctx, gain, note.midi, now + Math.max(0, start - cursor), end - Math.max(cursor, start), note.velocity * .23))
        }
      }
    }
  }
  return sources
}

export function createDemo(engine) {
  const ctx = engine.ensure(), rate = 22050, duration = 16
  const instruments = ['Dust drums', 'Warm bass', 'Soft atmosphere']
  const assets = instruments.map((name, index) => {
    const buffer = ctx.createBuffer(1, rate * duration, rate), data = buffer.getChannelData(0)
    let seed = 93
    for (let i = 0; i < data.length; i++) {
      const t = i / rate, beat = t % .5, eighth = t % .25
      seed = (seed * 16807) % 2147483647
      const noise = (seed / 2147483647 - .5) * 2
      if (index === 0) {
        const kick = Math.sin(2 * Math.PI * (48 * beat + 6 * (1 - Math.exp(-beat * 28)))) * Math.exp(-beat * 20)
        const snare = Math.floor(t / .5) % 2 ? noise * Math.exp(-beat * 24) * .24 : 0
        data[i] = kick * .38 + snare + noise * Math.exp(-eighth * 100) * .06
      } else if (index === 1) {
        const midi = [36, 44, 39, 43][Math.floor(t / 4) % 4], f = 440 * 2 ** ((midi - 69) / 12)
        data[i] = Math.sin(t * f * Math.PI * 2) * .32 * Math.min(1, beat * 80) * Math.exp(-beat * 2)
      } else {
        data[i] = (Math.sin(t * 130.81 * 2 * Math.PI) + Math.sin(t * 196 * 2 * Math.PI) + Math.sin(t * 261.63 * 2 * Math.PI)) * .035 * Math.min(t, 1) * Math.min(duration - t, 1)
      }
    }
    const id = `demo-${index}`; engine.assets.set(id, { id, name, buffer, bytes: encodeWav(buffer) }); return id
  })
  return [
    { id: 't1', name: '鼓组 / DRUMS', color: '#d5eb9e', volume: .7, mute: false, solo: false, clips: [{ id: 'c1', type: 'audio', name: 'Dust drums', start: 0, duration: 16, offset: 0, sourceId: assets[0] }] },
    { id: 't2', name: '低音 / BASS', color: '#a3c8e9', volume: .7, mute: false, solo: false, clips: [{ id: 'c2', type: 'audio', name: 'Warm bass', start: 0, duration: 16, offset: 0, sourceId: assets[1] }] },
    { id: 't3', name: '氛围 / TEXTURE', color: '#d7b2d7', volume: .65, mute: false, solo: false, clips: [{ id: 'c3', type: 'audio', name: 'Soft atmosphere', start: 0, duration: 16, offset: 0, sourceId: assets[2] }] },
    { id: 't4', name: '旋律 / MELODY', color: '#edbe8e', volume: .6, mute: false, solo: false, clips: [{ id: 'c4', type: 'midi', name: 'First light', start: 0, duration: 8, notes: [60, 63, 67, 70, 67, 65, 63, 60].map((midi, i) => ({ id: `n${i}`, midi, beat: i * 2, duration: 1.5, velocity: .75 })) }] },
  ]
}
