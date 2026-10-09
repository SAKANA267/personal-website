<script setup lang="ts">
import { onMounted, ref } from 'vue'
import WriterByline from '../components/WriterByline.vue'
import { api } from '../composables/useApi'
import { useAuth } from '../stores/auth'
import { useLocale } from '../stores/locale'
import type { DevLogEntry } from '../types'

const { t } = useLocale()
const logs = ref<DevLogEntry[]>([])
const content = ref('')
// 登录适配：写入改为管理员专属（服务端 401/403 门禁，前端隐藏表单）
const { isAdmin } = useAuth()

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
      alert(t('devlog.ok'))
      content.value = ''
      fetchMessages()
    } else {
      alert(t('devlog.fail'))
    }
  } catch (e) {
    alert(t('devlog.fail'))
  }
}

onMounted(fetchMessages)
</script>

<template>
  <div class="page-devlog">

    <div class="container">
      <h1>{{ t('devlog.title') }}</h1>
      <WriterByline />
    </div>

    <div v-if="isAdmin">
      <form id="message-form" @submit.prevent="submit">
        <div class="form-group">
          <label for="content">{{ t('devlog.label') }}</label>
          <textarea id="content" v-model="content" required></textarea>
        </div>
        <button type="submit">{{ t('devlog.submit') }}</button>
      </form>
    </div>

    <div class="devlog-list">
      <h2>{{ t('devlog.listTitle') }}</h2>

      <!-- 宽表格的标准滚动容器：移动端（≤480px 表格 min-width 500px）在盒内横向滚动 -->
      <div class="table-scroll">
        <table id="userTable">
          <thead>
            <tr>
              <th>{{ t('devlog.thDate') }}</th>
              <th>{{ t('devlog.thDesc') }}</th>
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
  </div>
</template>
