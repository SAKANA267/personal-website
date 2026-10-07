<script setup lang="ts">
import { ref, watch } from 'vue'
import TopNav from '../components/TopNav.vue'
import WriterByline from '../components/WriterByline.vue'
import CodeBlock from '../components/CodeBlock.vue'
import QuizItem from '../components/QuizItem.vue'
import { useAuth } from '../stores/auth'
import type { Question } from '../types'

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
  const json = prompt(
    'Enter the questions JSON string (multiple JSON objects separated by commas):'
  )
  try {
    const parsed = JSON.parse(`[${json}]`) as any[]
    parsed.forEach((q: any) => {
      if (q.question && q.options && q.answer) {
        questions.value.push(q)
      } else {
        alert(
          "Invalid question format. Please ensure each question includes 'question', 'options', and 'answer'."
        )
      }
    })
    saveQuestionsToLocalStorage()
  } catch (e) {
    alert('Invalid JSON format. Please enter valid JSON strings.')
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
    alert('Please enter a valid question with at least 4 options and an answer.')
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
    <TopNav :items="[{ label: 'Index', to: '/' }, { label: '登录', to: '/login' }, { label: 'Blog', to: '/blog' }]" />

    <div class="container">
      <h1>自定义题库</h1>
      <WriterByline />

      <!-- 注意事项 -->
      <p>题目由JavaScript读取json字符串</p>
      <p>例如</p>
      <CodeBlock />

      <button id="add-question-btn" @click="addQuestion">Add Question</button>

      <!-- 管理按钮 -->
      <div class="container">
        <button id="view-storage-btn" @click="viewStorage">View Storage</button>
        <button id="clear-storage-btn" @click="clearStorage">Clear Storage</button>
      </div>

      <div class="container">
        <h2>1.2JSON 转换</h2>
        <label class="input-field">
          Paste your question here:
          <textarea
            id="question-text"
            rows="10"
            cols="50"
            v-model="questionText"
            placeholder="Enter the question, options, and answer"
          ></textarea>
        </label>
        <button id="convert-btn" @click="convertToJSON">Convert to JSON</button>
        <div class="output" id="output">{{ output }}</div>
      </div>

      <!-- 选择题列表 -->
      <div id="question-list">
        <QuizItem v-for="(q, index) in questions" :key="index" :question="q" />
      </div>
    </div>
  </div>
</template>
