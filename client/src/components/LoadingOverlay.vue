<script setup lang="ts">
import { useLoading } from '../stores/loading'
const { covered } = useLoading()
</script>

<template>
  <div class="loading" :class="{ loading_out: !covered }">
    <svg viewBox="0 0 50 50">
      <circle r="25" cx="25" cy="25"></circle>
    </svg>
    <p>LOADING</p>
  </div>
</template>
