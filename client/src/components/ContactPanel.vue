<script setup lang="ts">
import { useCopyText } from '../composables/useCopyText'
import { goExternal } from '../stores/loading'

const { tooltip, copy } = useCopyText()
</script>

<template>
  <div class="contact-panel">
    <!-- 复制提示，定位到点击坐标，500ms 后淡出 -->
    <div
      class="contact-tooltip"
      :class="{ show: tooltip.show }"
      :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
    >
      已复制
    </div>

    <div class="contact-container">
      <!-- Bilibili -->
      <div class="contact-item platform-bilibili" @click="goExternal('https://space.bilibili.com/35934540')">
        <div class="icon">
          <img src="/resource/svg/bilibili.svg" alt="Bilibili" />
        </div>
        <p class="label">Bilibili</p>
      </div>

      <!-- QQ -->
      <div class="contact-item platform-qq" @click="(e) => copy('2678452710', e.clientX, e.clientY)">
        <div class="icon">
          <img src="/resource/svg/QQ.svg" alt="QQ" />
        </div>
        <p class="label">2678452710</p>
      </div>

      <!-- Email -->
      <div class="contact-item platform-email" @click="(e) => copy('ibert1ne@outlook.com', e.clientX, e.clientY)">
        <div class="icon">
          <img src="/resource/svg/mail.svg" alt="Email" />
        </div>
        <p class="label">ibert1ne@outlook.com</p>
      </div>

      <!-- GitHub -->
      <div class="contact-item platform-github" @click="goExternal('https://github.com/SAKANA267')">
        <div class="icon">
          <img src="/resource/svg/github.svg" alt="GitHub" />
        </div>
        <p class="label">GitHub</p>
      </div>
    </div>
  </div>
</template>
