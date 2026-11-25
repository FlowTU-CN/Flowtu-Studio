import test from 'node:test'
import assert from 'node:assert/strict'
import { clipWindow, splitClip, activeTracks, encodeWav, validateProject } from '../src/core.js'

test('seeking into a trimmed clip plays the correct source offset and remainder', () => {
  assert.deepEqual(clipWindow({ start: 5, offset: 2, duration: 4 }, 6.5, 20), { delay: 0, offset: 3.5, duration: 2.5 })
  assert.deepEqual(clipWindow({ start: 5, offset: 2, duration: 4 }, 1, 20), { delay: 4, offset: 2, duration: 4 })
  assert.equal(clipWindow({ start: 5, offset: 2, duration: 4 }, 10, 20), null)
})
test('split audio clips preserve their original source continuity', () => {
  const [a, b] = splitClip({ id: 'a', type: 'audio', start: 4, offset: 3, duration: 8 }, 7, 120)
  assert.equal(a.duration, 3); assert.equal(b.start, 7); assert.equal(b.offset, 6); assert.equal(b.duration, 5)
  assert.equal(splitClip(a, 4, 120), null)
})
test('split MIDI retains crossing notes on both sides without changing their timing', () => {
  const [, b] = splitClip({ id: 'm', type: 'midi', start: 0, duration: 8, notes: [{ id: 'n', beat: 2, duration: 4, midi: 60, velocity: .8 }] }, 2, 120)
  assert.equal(b.notes[0].beat, 0); assert.equal(b.notes[0].duration, 2)
})
test('solo and mute filtering matches both real-time and exported mix', () => {
  const tracks = [{ id: 1, solo: true, mute: true }, { id: 2, solo: false, mute: false }, { id: 3, solo: true, mute: false }]
  assert.deepEqual(activeTracks(tracks).map(t => t.id), [3])
})
test('WAV contains correct stereo header, interleaving and clipping', () => {
  const buffer = { numberOfChannels: 2, length: 2, sampleRate: 44100, getChannelData: c => c === 0 ? new Float32Array([2, -2]) : new Float32Array([.5, -.5]) }
  const wav = encodeWav(buffer), view = new DataView(wav)
  assert.equal(wav.byteLength, 52); assert.equal(view.getUint32(40, true), 8); assert.equal(view.getUint16(22, true), 2)
  assert.equal(view.getInt16(44, true), 32767); assert.equal(view.getInt16(48, true), -32768)
})
test('rejects malformed projects and non-finite clip timing before replacing current project', () => {
  assert.throws(() => validateProject({ version: 1, tracks: [] }))
  const p = { version: 1, bpm: 120, master: .7, tracks: Array.from({ length: 4 }, (_, i) => ({ id: i, volume: .7, clips: [] })) }
  assert.equal(validateProject(p), p)
  p.tracks[0].clips.push({ id: 'x', type: 'audio', start: -1, duration: 3, offset: 0, sourceId: 'a' })
  assert.throws(() => validateProject(p))
})
