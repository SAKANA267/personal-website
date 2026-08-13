<script setup lang="ts">
import { computed } from 'vue'
import { useLoading } from '../stores/loading'

const { covered, hidden } = useLoading()

// covered=true：四色块依次从左滑入（loading_in）；covered=false：统一向右滑出（loading_out）
// hidden=true（标题卡首屏豁免）：完全不渲染遮罩
const overlayClass = computed(() => (covered.value ? 'loading_in' : 'loading_out'))
</script>

<template>
  <div v-if="!hidden" class="loading" :class="overlayClass">
    <div class="loading__panel loading__panel--1"></div>
    <div class="loading__panel loading__panel--2"></div>
    <div class="loading__panel loading__panel--3"></div>
    <div class="loading__panel loading__panel--4"></div>
  </div>
</template>
