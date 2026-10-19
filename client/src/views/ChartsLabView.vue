<script setup lang="ts">
import { useLocale } from '../stores/locale'
import { chartsLabCases as cases } from '../content/chartsLabCases'

const { t } = useLocale()

// BASE_URL 在 dev 与生产均为 /web/，public 下的文件直接跟随该前缀
const base = import.meta.env.BASE_URL
</script>

<template>
  <div class="page-charts-lab">

    <div class="lab-container">
      <header class="lab-header">
        <div class="lab-kicker">{{ t('chartsLab.kicker') }}</div>
        <h1>{{ t('chartsLab.title') }}</h1>
        <p>
          {{ t('chartsLab.introLead') }} <strong>Lieflat Charts</strong>{{ t('chartsLab.introMid') }}
          <code>~/.zcode/skills/lieflat-charts</code>{{ t('chartsLab.introTail') }}
        </p>
      </header>

      <section class="lab-rules">
        <div class="lab-rule">
          <h3><span class="rule-no">01</span>{{ t('chartsLab.rule1Title') }}</h3>
          <p>{{ t('chartsLab.rule1Body') }}</p>
        </div>
        <div class="lab-rule">
          <h3><span class="rule-no">02</span>{{ t('chartsLab.rule2Title') }}</h3>
          <p>{{ t('chartsLab.rule2Body') }}</p>
        </div>
        <div class="lab-rule">
          <h3><span class="rule-no">03</span>{{ t('chartsLab.rule3Title') }}</h3>
          <p>{{ t('chartsLab.rule3Body') }}</p>
        </div>
      </section>

      <h2 class="lab-section-title">{{ t('chartsLab.sectionTitle') }}</h2>
      <p class="lab-section-sub">
        {{ t('chartsLab.sectionSub') }}
      </p>

      <article v-for="c in cases" :key="c.id" class="lab-case">
        <div class="lab-case-head">
          <span class="lab-case-id">{{ c.id }}</span>
          <span class="lab-case-name">{{ c.name }}</span>
          <span class="lab-case-family">{{ c.family }}</span>
        </div>
        <div class="lab-case-body">
          <p class="lab-meta"><strong>{{ t('chartsLab.shapeLabel') }}</strong>{{ c.shape }}</p>
          <p class="lab-meta">{{ c.summary }}</p>
          <!-- 伪元素标签文字经 data-label 提供（CSS content: attr()），可被 i18n 切换 -->
          <div class="lab-prompt" :data-label="t('chartsLab.promptLabel')">{{ c.prompt }}</div>
          <div class="lab-frame-wrap">
            <!-- 滚动由 CSS 控制（.lab-frame-wrap iframe）：桌面裁切、窄屏可滚，废弃的 scrolling 属性不再使用 -->
            <iframe :src="base + 'charts-lab/' + c.file" :title="c.name" loading="lazy"></iframe>
          </div>
          <p class="lab-case-src">
            {{ t('chartsLab.sourceLabel') }}{{ c.source }} · {{ c.note }} ·
            <a :href="base + 'charts-lab/' + c.file" target="_blank" rel="noopener">{{ t('chartsLab.openNewTab') }}</a>
          </p>
        </div>
      </article>

      <footer class="lab-foot">
        {{ t('chartsLab.foot1') }}
        {{ t('chartsLab.foot2') }}
        {{ t('chartsLab.foot3') }}
      </footer>
    </div>
  </div>
</template>
