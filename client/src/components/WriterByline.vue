<script setup lang="ts">
// 署名：默认 SAKANA（静态内容），用户文章传入作者用户名
import { useLocale } from '../stores/locale'

defineProps<{ author?: string }>()

const { t } = useLocale()
</script>

<template>
  <p id="writer"><em>{{ t('common.byline', { name: author || 'SAKANA' }) }}</em></p>
</template>
