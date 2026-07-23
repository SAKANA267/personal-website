<script setup lang="ts">
import { onMounted, ref } from 'vue'
import TopNav from '../components/TopNav.vue'
import WriterByline from '../components/WriterByline.vue'
import { api } from '../composables/useApi'
import type { DevLogEntry } from '../types'

const logs = ref<DevLogEntry[]>([])
const content = ref('')

async function fetchMessages() {
  try {
    const data = await api.getDevLogs()
    if (Array.isArray(data)) {
      logs.value = data
    } else if ((data as any)?.error) {
      console.error('Error:', (data as any).error)
    }
  } catch (e) {
    console.error('Error:', e)
  }
}

async function submit() {
  try {
    const res = await api.postDevLog({ content: content.value })
    if (res.ok) {
      alert('日志提交成功！')
      content.value = ''
      fetchMessages()
    } else {
      alert('日志提交失败，请稍后再试。')
    }
  } catch (e) {
    alert('日志提交失败，请稍后再试。')
  }
}

onMounted(fetchMessages)
</script>

<template>
  <div class="page-devlog">
    <TopNav :items="[{ label: 'Index', to: '/' }, { label: '登录', to: '/login' }]" />

    <div class="container">
      <h1>Dev log</h1>
      <WriterByline />
    </div>

    <div>
      <form id="message-form" @submit.prevent="submit">
        <div class="form-group">
          <label for="content">修改内容:</label>
          <textarea id="content" v-model="content" required></textarea>
        </div>
        <button type="submit">提交</button>
      </form>
    </div>

    <div>
      <h2>日志列表</h2>

      <table id="userTable">
        <thead>
          <tr>
            <th>日期</th>
            <th>修改内容</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(log, index) in logs"
            :key="index"
            class="userTableFadeIn"
            :style="{ animationDelay: (index + 1) * 0.15 + 's' }"
          >
            <td>{{ log.timestamp }}</td>
            <td>{{ log.change_description }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
