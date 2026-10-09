<script setup lang="ts">
import { useLocale } from '../stores/locale'

// 子路径部署：资源路径需带 base 前缀
const BASE_URL = import.meta.env.BASE_URL
const { t } = useLocale()
</script>

<template>
  <footer>
    <div class="footer-content">
      <p>&copy; 2025 sakana267. {{ t('footer.rights') }}</p>
      <div class="ICP">
        <a href="https://beian.miit.gov.cn/" target="_blank">湘ICP备2025113178号</a><br />
        <img :src="`${BASE_URL}resource/png/beian.png`" width="15" height="15" alt="beian" />
        <a
          href="https://beian.mps.gov.cn/#/query/webSearch?code=43012102001060"
          rel="noreferrer"
          target="_blank"
          >湘公网安备43012102001060号</a
        >
      </div>
    </div>
  </footer>
</template>
