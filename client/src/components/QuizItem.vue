<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Question } from '../types'

const props = defineProps<{ question: Question }>()

const selected = ref<string | null>(null)

// 选中正确→绿(#00FF7F)，错误→红(#FF4500)，未选→无（与原题库一致，无计分）
const bg = computed(() => {
  if (selected.value === null) return ''
  return selected.value === props.question.answer ? '#00FF7F' : '#FF4500'
})
</script>

<template>
  <div class="question-item">
    <div class="question" :style="{ backgroundColor: bg }">{{ question.question }}</div>
    <div class="options">
      <label class="option" v-for="(option, index) in question.options" :key="index">
        <input type="radio" :name="'question-' + question.question" :value="option" v-model="selected" />
        {{ index + 1 }}. {{ option }}
      </label>
    </div>
  </div>
</template>
