<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
const props = defineProps(['buffer', 'offset', 'duration', 'color'])
const canvas = ref(null)
let observer
function draw() {
  const el = canvas.value; if (!el || !props.buffer) return
  const width = el.clientWidth, height = el.clientHeight, ratio = devicePixelRatio || 1
  el.width = width * ratio; el.height = height * ratio
  const ctx = el.getContext('2d'); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height)
  const data = props.buffer.getChannelData(0), rate = props.buffer.sampleRate
  const from = Math.floor((props.offset || 0) * rate), count = Math.floor(props.duration * rate)
  ctx.fillStyle = props.color
  for (let x = 0; x < width; x += 3) {
    const a = from + Math.floor(x / width * count), b = Math.min(data.length, from + Math.ceil((x + 3) / width * count))
    let peak = 0
    for (let i = a; i < b; i += Math.max(1, Math.floor((b - a) / 24))) peak = Math.max(peak, Math.abs(data[i]))
    const h = Math.max(1, peak * height * 1.5)
    ctx.fillRect(x, (height - h) / 2, 1.8, h)
  }
}
onMounted(() => { observer = new ResizeObserver(draw); observer.observe(canvas.value); draw() })
watch(() => [props.buffer, props.offset, props.duration, props.color], draw)
onUnmounted(() => observer?.disconnect())
</script>
<template><canvas ref="canvas" class="waveform" aria-hidden="true" /></template>
