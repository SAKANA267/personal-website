<script setup lang="ts">
import { useLocale } from '../stores/locale'

const { t } = useLocale()

interface ChartCase {
  id: string
  name: string
  family: string
  shape: string
  summary: string
  prompt: string
  file: string
  source: string
  note: string
}

// BASE_URL 在 dev 与生产均为 /web/，public 下的文件直接跟随该前缀
const base = import.meta.env.BASE_URL

const cases: ChartCase[] = [
  {
    id: 'F1',
    name: 'Rung Bars 阶梯柱',
    family: 'Lupi Basics · basics-gallery',
    shape: '少类目比较（≤8）',
    summary: '柱状图的「可数化」改写：柱身是一格格横档，1 档 = 一个诚实单位，远看是柱状图，近看每档都数得出来。',
    prompt: '帮我把这周各板块的访问量画一下：首页 380、博客 270、聊天 220、题库 160、日志 110、留言 70。',
    file: 'rung-bars.html',
    source: 'templates/basics-gallery.html · 卡片「Revenue by plan, rung by rung」',
    note: '主力图型。数据只有几个类目时的默认选择之一。',
  },
  {
    id: 'F2',
    name: 'Hairline Line 发丝折线',
    family: 'Lupi Basics · basics-gallery',
    shape: '日序列（≤30 天）',
    summary: '折线图的 Lupi 化：底部条码是「诚实的日历」（每天一根刻度，无论有没有数据），发丝线 + 逐日圆点，周末空心，峰值自动标数。',
    prompt: '这是最近 30 天的每日访客量，做一张图放进年报里。',
    file: 'hairline-line.html',
    source: 'templates/basics-gallery.html · 卡片「Thirty days of sign-ups」',
    note: '逐日读数用 F2；30–60 天看形态用 F3；90 天要肌理用 L3。',
  },
  {
    id: 'F4',
    name: 'Tick Donut 刻度环',
    family: 'Lupi Basics · basics-gallery',
    shape: '100% 构成（≤6 段）',
    summary: '饼图的默认替代：1 刻 = 1%，绕成一圈表盘顺时针读，灰阶按重要性分配——最重要的类目最黑。',
    prompt: '访客来源是直达 37%、搜索 28%、友链 21%、社交 14%，可视化一下构成。',
    file: 'tick-donut.html',
    source: 'templates/basics-gallery.html · 卡片「Where the traffic comes from」',
    note: '「明度即数据」：多系列按重要性沿灰阶梯分配，不按顺序乱拿。',
  },
  {
    id: 'G4',
    name: 'Dot Waffle 点阵华夫',
    family: 'Glance · glance-gallery',
    shape: '100% 构成（快读版）',
    summary: '上面 F4 的「姊妹图」：同一份构成数据的三秒版。每 1 点 = 1%，十乘十的方阵一眼数清。适合 dashboard、周报这类扫一眼的场合。',
    prompt: '同一份来源数据，我要放进周报 dashboard，三秒能读完的那种。',
    file: 'dot-waffle.html',
    source: 'templates/glance-gallery.html · 卡片「Where sign-ups come from」',
    note: 'Glance 是降级方案：默认先选 Lupi 系，明确要 dashboard / 三秒快读时才用它。',
  },
  {
    id: 'F12',
    name: 'Dumbbell Queue 哑铃队列',
    family: 'Lupi Basics · basics-gallery',
    shape: '两时点对比（前后 / 今昔）',
    summary: '空心点 = 改版前，实心点 = 改版后，两点之间的串珠 = 省下的时间，一珠一珠可数。全部向左走，没有交叉线。',
    prompt: '对比一下 Vue 化改版前后五个页面的首屏耗时，改版前 1.4s / 1.9s / 2.6s / 3.1s / 3.8s，改版后 0.6s / 0.9s / 1.3s / 2.1s / 3.0s。',
    file: 'dumbbell-queue.html',
    source: 'templates/basics-gallery.html · 卡片「Onboarding, before and after the redesign」',
    note: '类目级前后对比的 Lupi 位；序列多了要画趋势线时才考虑粗线斜率图。',
  },
  {
    id: 'F10',
    name: 'Dot Heat 点热力',
    family: 'Lupi Basics · basics-gallery',
    shape: '星期 × 小时 × 量',
    summary: '热力图的点阵皮：点面积 ∝ 数量（面积编码记得开方换算半径），沉默的格子留一粒微点——沉默也要可见。最热格自动加虚线圈。',
    prompt: '画一下聊天室一周内什么时段最活跃，按星期和小时。',
    file: 'dot-heat.html',
    source: 'templates/basics-gallery.html · 卡片「When support gets loud」',
    note: '星期 × 小时的重复周期用 F10；整年 52 周的日期热力才用 L17。',
  },
  {
    id: 'L15',
    name: 'Ballot Tally 投票刻度',
    family: 'Lupi Editorial · lupi-gallery',
    shape: '多选题百分比（各项独立 0–100）',
    summary: '小数据的「单位分解」示范：每个选项是一排 100 根发丝刻度——一百个人站队，勾了它的上墨。加总可以超过 100，因为可多选。',
    prompt: '访客调研多选题（100 人，可多选）：看博客 51、刷题库 46、聊天 41、看日志 22，画一张有编辑感的图。',
    file: 'ballot-tally.html',
    source: 'templates/lupi-gallery.html · 卡片「What they fear, tick by tick」',
    note: '数据少不等于只能画粗柱：把百分比摊回可数单位，密度来自单位而不是记录数。',
  },
]
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
