<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useAshParticles } from '../composables/useAshParticles'

const container = ref<HTMLElement | null>(null)
const { start, stop } = useAshParticles()

onMounted(() => {
  if (container.value) start(container.value)
})
onUnmounted(() => {
  if (container.value) stop(container.value)
})
</script>

<template>
  <div class="ember-container" id="emberContainer" ref="container"></div>
</template>
