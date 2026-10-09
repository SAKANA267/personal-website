<script setup lang="ts">
import { ref, watch } from 'vue'
import WriterByline from '../components/WriterByline.vue'
import CodeBlock from '../components/CodeBlock.vue'
import QuizItem from '../components/QuizItem.vue'
import { useAuth } from '../stores/auth'
import { useLocale } from '../stores/locale'
import type { Question } from '../types'

const { t } = useLocale()

const seed: Question = {
  question: 'What is the capital of France?',
  options: ['Paris', 'London', 'Berlin', 'Madrid'],
  answer: 'Paris',
}

// 登录适配：题库按用户隔离——登录用 questions:<username>，游客沿用原键 questions
// （保留游客原有数据，不迁移）；登录/退出时切换键并重载列表
const { username } = useAuth()

function storageKey(): string {
  return username.value ? `questions:${username.value}` : 'questions'
}

function loadQuestionsFromLocalStorage(): Question[] {
  const stored = localStorage.getItem(storageKey())
  if (stored) {
    try {
      return JSON.parse(stored)
    } catch {
      return []
    }
  }
  return []
}

const questions = ref<Question[]>([seed])
const storedQuestions = loadQuestionsFromLocalStorage()
if (Array.isArray(storedQuestions)) {
  questions.value = questions.value.concat(storedQuestions)
}

// 登录态切换 → 读取对应用户的题库
watch(username, () => {
  questions.value = [seed].concat(loadQuestionsFromLocalStorage())
})

function saveQuestionsToLocalStorage() {
  localStorage.setItem(storageKey(), JSON.stringify(questions.value))
}

function addQuestion() {
  const json = prompt(t('quiz.promptJson'))
  try {
    const parsed = JSON.parse(`[${json}]`) as any[]
    parsed.forEach((q: any) => {
      if (q.question && q.options && q.answer) {
        questions.value.push(q)
      } else {
        alert(t('quiz.invalidQuestion'))
      }
    })
    saveQuestionsToLocalStorage()
  } catch (e) {
    alert(t('quiz.invalidJson'))
  }
}

function viewStorage() {
  alert(localStorage.getItem(storageKey()))
}

function clearStorage() {
  localStorage.removeItem(storageKey())
  questions.value = questions.value.slice(0, 3) // 保留实例题目
}

const questionText = ref('')
const output = ref('')

function convertToJSON() {
  const lines = questionText.value.split('\n').map((l) => l.trim()).filter((l) => l)
  if (lines.length < 6) {
    alert(t('quiz.needLines'))
    return
  }
  const question = lines[0]
  const options = lines.slice(1, 5).map((o) => o.replace(/^\d+\.\s*/, ''))
  const answer = lines[5].replace('Answer: ', '')
  output.value = JSON.stringify({ question, options, answer }, null, 2)
}
</script>

<template>
  <div class="page-bank">

    <div class="container">
      <h1>{{ t('quiz.title') }}</h1>
      <WriterByline />

      <!-- 注意事项 -->
      <p>{{ t('quiz.note') }}</p>
      <p>{{ t('quiz.example') }}</p>
      <CodeBlock />

      <button id="add-question-btn" @click="addQuestion">{{ t('quiz.add') }}</button>

      <!-- 管理按钮 -->
      <div class="container">
        <button id="view-storage-btn" @click="viewStorage">{{ t('quiz.view') }}</button>
        <button id="clear-storage-btn" @click="clearStorage">{{ t('quiz.clear') }}</button>
      </div>

      <div class="container">
        <h2>{{ t('quiz.convertTitle') }}</h2>
        <label class="input-field">
          {{ t('quiz.pasteLabel') }}
          <textarea
            id="question-text"
            rows="10"
            cols="50"
            v-model="questionText"
            :placeholder="t('quiz.placeholder')"
          ></textarea>
        </label>
        <button id="convert-btn" @click="convertToJSON">{{ t('quiz.convert') }}</button>
        <div class="output" id="output">{{ output }}</div>
      </div>

      <!-- 选择题列表 -->
      <div id="question-list">
        <QuizItem v-for="(q, index) in questions" :key="index" :question="q" />
      </div>
    </div>
  </div>
</template>
