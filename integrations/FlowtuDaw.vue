<script setup lang="ts">
// Host this view in an isolated Nuxt route (see README). The source is the deployed openDAW app.
defineProps<{ src: string }>()
</script>
<template>
  <iframe :src="src" title="Flowtu 音频工作室" class="flowtu-daw"
    allow="autoplay; cross-origin-isolated; midi; clipboard-write; fullscreen" />
</template>
<style scoped>
.flowtu-daw { width:100%; height:calc(100dvh - 64px); min-height:680px; border:0; display:block; }
</style>
