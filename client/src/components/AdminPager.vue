<script setup lang="ts">
// 管理面板分页条：页码信息 + 每页条数 + 前后翻页（服务端分页，全部事件上抛）
defineProps<{
  page: number
  pageSize: number
  total: number
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'go', page: number): void
  (e: 'size', pageSize: number): void
}>()

function pages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}
</script>

<template>
  <div class="admin-pager">
    <span class="admin-pager-info">共 {{ total }} 条 · 第 {{ page }} / {{ pages(total, pageSize) }} 页</span>
    <div class="admin-pager-ctl">
      <select
        class="admin-select admin-pager-size"
        :value="pageSize"
        aria-label="每页条数"
        @change="emit('size', Number(($event.target as HTMLSelectElement).value))"
      >
        <option :value="20">20 条/页</option>
        <option :value="50">50 条/页</option>
        <option :value="100">100 条/页</option>
      </select>
      <button type="button" class="admin-btn" :disabled="page <= 1 || loading" @click="emit('go', page - 1)">
        上一页
      </button>
      <button
        type="button"
        class="admin-btn"
        :disabled="page >= pages(total, pageSize) || loading"
        @click="emit('go', page + 1)"
      >
        下一页
      </button>
    </div>
  </div>
</template>
