<script setup lang="ts">
/**
 * 墨线折线渲染器（lieflat Mono 语法，移植自 charts-lab hairline-line 正本）：
 * 卡片四件套（结论式标题 + 副标题 + SVG + 全大写来源行）、发丝 1px 折线、
 * 逐点圆点（>60 点自动收敛）、周末空心点、top-1 峰值 paint-order 光晕标注、
 * 底部日历条码、draw/pop/fade 入场动画（reduced-motion 降级）。
 *
 * 多系列按 Mono 灰阶阶梯分配（明度即数据，最多 6 条，超出由视图提示切科研风格）；
 * 卡片固定暖纸墨色，不随站点暗色主题切换（与 charts-lab 图表「如图片」同惯例）。
 * 全部样式走 SVG 属性（非 CSS 变量），PNG 序列化导出后颜色完整。
 */
import { computed, ref } from 'vue'
import { useLocale } from '../../stores/locale'
import {
  INK_LADDER, INK_PALETTE, niceTicks, fmtTick, fmtDate, fmtDateTime, fmtValue,
  type ChartFrame, type TrackingConfig,
} from '../../composables/useTracking'

const props = defineProps<{
  frame: ChartFrame
  config: TrackingConfig
  title: string
  sourceLabel: string
}>()

const { t } = useLocale()

const INK = INK_PALETTE
const INK_SERIES_CAP = 6

// ---------- 几何（viewBox 固定，width:100% 自适应缩放） ----------

const W = 880
const H = 460
const PX0 = 56 // 绘图区左界（y 刻度文案在左）
const PX1 = 824
const PY0 = 46 // 顶（上部给系列图例行留位）
const PY1 = 340 // 基线
const BARCODE_Y2 = 347 // 日历条码下端
const XLABEL_Y = 364
const FOOT_Y = 432

const series = computed(() => props.frame.series.slice(0, INK_SERIES_CAP))
const overflow = computed(() => props.frame.series.length > INK_SERIES_CAP)

// x 域：单点时左右各垫半天，避免零跨度映射
const xDom = computed<[number, number]>(() => {
  const d = props.frame.xDomain
  if (!d) return [0, 1]
  if (d[1] - d[0] < 1) return [d[0] - 43200000, d[1] + 43200000]
  const pad = (d[1] - d[0]) * 0.01
  return [d[0] - pad, d[1] + pad]
})

// y 域：上下各留 10%（顶部给峰值标注光晕）
const yDom = computed<[number, number]>(() => {
  const d = props.frame.yDomain
  if (!d) return [0, 1]
  const span = d[1] - d[0] || Math.abs(d[1]) || 1
  return [d[0] - span * 0.1, d[1] + span * 0.1]
})

const x = (ts: number) => PX0 + ((ts - xDom.value[0]) / (xDom.value[1] - xDom.value[0])) * (PX1 - PX0)
const y = (v: number) => PY1 - ((v - yDom.value[0]) / (yDom.value[1] - yDom.value[0])) * (PY1 - PY0)

const yTicks = computed(() => niceTicks(yDom.value[0], yDom.value[1], 5))

const isWeekend = (ts: number) => [0, 6].includes(new Date(ts).getDay())

// 点显示策略：auto ≤60 点；on 上限 240（性能兜底）；off 全关
const dotsOn = computed(() => {
  const maxN = Math.max(...series.value.map((s) => s.points.length), 0)
  if (props.config.showPoints === 'off') return false
  if (props.config.showPoints === 'on') return maxN <= 240
  return maxN <= 60
})
// 空心周末点只在逐点语义（raw/日聚合）下有意义
const hollowWeekend = computed(() => props.config.agg === 'raw' || props.config.agg === 'day')

const perSeries = computed(() =>
  series.value.map((s, i) => {
    const color = INK_LADDER[i % INK_LADDER.length]
    const d =
      s.points.length >= 2
        ? 'M' + s.points.map((q) => `${x(q.t).toFixed(1)} ${y(q.v).toFixed(1)}`).join(' L ')
        : ''
    // top-1 峰值（≤3 系列才标注，避免拥挤）
    let peak: { px: number; py: number; label: string } | null = null
    if (props.config.peakLabels && series.value.length <= 3 && s.points.length > 0) {
      let best = s.points[0]
      for (const q of s.points) if (q.v > best.v) best = q
      peak = { px: x(best.t), py: y(best.v), label: fmtTick(best.v) }
    }
    const maD = s.ma && s.ma.length >= 2 ? 'M' + s.ma.map((q) => `${x(q.t).toFixed(1)} ${y(q.v).toFixed(1)}`).join(' L ') : ''
    return { s, color, d, peak, maD }
  })
)

// 日历条码：每桶一枚 7px 短线；>120 枚抽稀
const barcodeStep = computed(() => {
  const maxN = Math.max(...series.value.map((s) => s.points.length), 0)
  return Math.ceil(maxN / 120)
})
const barcodeTicks = computed(() => {
  const out: number[] = []
  for (const { s } of perSeries.value) {
    s.points.forEach((_q, i) => {
      if (i % barcodeStep.value === 0) out.push(i)
    })
    break // 条码按首系列（主系列）的日历画
  }
  return out
})

// x 轴三处日期标注：首 / 中 / 尾
const xLabels = computed(() => {
  const [a, b] = [xDom.value[0], xDom.value[1]]
  return [
    { ts: a, anchor: 'start' as const },
    { ts: (a + b) / 2, anchor: 'middle' as const },
    { ts: b, anchor: 'end' as const },
  ]
})

// 系列图例行（多系列时置于图内顶部，灰阶小线段 + 名称）
const legendEntries = computed(() => {
  let cx = PX0
  return series.value.map((s, i) => {
    const color = INK_LADDER[i % INK_LADDER.length]
    const w = s.name.length * 8.2 + 30
    const entry = { name: s.name, color, x: cx, w }
    cx += w + 14
    return entry
  })
})

// 副标题：图例语义 · 聚合口径 · 时间范围
const subLine = computed(() => {
  const parts: string[] = []
  const agg = props.config.agg
  if (agg !== 'raw') {
    const byKey = { avg: 'tracking.aggByAvg', min: 'tracking.aggByMin', max: 'tracking.aggByMax', last: 'tracking.aggByLast' } as const
    const aggKey = { day: 'tracking.aggDay', week: 'tracking.aggWeek', month: 'tracking.aggMonth' } as const
    parts.push(`${t(aggKey[agg])}${t(byKey[props.config.aggBy])}`)
  }
  if (props.frame.normalized) parts.push(t('tracking.normMinmaxShort'))
  if (props.frame.rangeLabel) parts.push(props.frame.rangeLabel)
  return parts.join(' · ')
})

// 底注：点语义说明（与 hairline 原版同位）
const footNote = computed(() => {
  const parts: string[] = []
  if (dotsOn.value) parts.push(t('tracking.inkDotNote'))
  if (dotsOn.value && hollowWeekend.value) parts.push(t('tracking.inkHollowNote'))
  return parts.join(' · ')
})

// ---------- 悬停读数（竖发丝 + 墨色小签；吸附全体系列最近时间点） ----------

const hoverX = ref<number | null>(null)
const svgEl = ref<SVGSVGElement | null>(null)

const unionTs = computed(() => {
  const set = new Set<number>()
  for (const s of series.value) for (const q of s.points) set.add(q.t)
  return [...set].sort((a, b) => a - b)
})

interface HoverRow { name: string; color: string; px: number; py: number; label: string }

const hover = computed(() => {
  if (hoverX.value === null || unionTs.value.length === 0) return null
  const ts = hoverX.value
  const nearest = unionTs.value.reduce((p, c) => (Math.abs(c - ts) < Math.abs(p - ts) ? c : p))
  const rows: HoverRow[] = []
  for (const ps of perSeries.value) {
    let best = ps.s.points[0]
    for (const q of ps.s.points) if (Math.abs(q.t - nearest) < Math.abs(best.t - nearest)) best = q
    if (!best) continue
    rows.push({ name: ps.s.name, color: ps.color, px: x(best.t), py: y(best.v), label: fmtValue(best.v) })
  }
  if (!rows.length) return null
  const cx = x(nearest)
  const dateText = props.config.agg === 'raw' ? fmtDateTime(nearest) : fmtDate(nearest)
  // 小签定位：跟随竖线右侧，越界翻到左侧
  const width = Math.max(dateText.length, ...rows.map((r) => r.name.length + r.label.length + 2)) * 6.4 + 18
  const chipX = cx + 12 + width > PX1 ? cx - 12 - width : cx + 12
  return { cx, chipX, width, dateText, rows }
})

function onMove(e: MouseEvent) {
  const svg = svgEl.value
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const vx = ((e.clientX - rect.left) / rect.width) * W
  const ts = xDom.value[0] + ((vx - PX0) / (PX1 - PX0)) * (xDom.value[1] - xDom.value[0])
  hoverX.value = ts
}
</script>

<template>
  <div class="tracking-ink-card">
    <h3 class="ink-title">{{ title }}</h3>
    <p class="ink-sub">
      <template v-if="overflow">{{ t('tracking.inkOverflow') }}</template>
      <template v-else-if="subLine">{{ subLine }}</template>
      <span v-else aria-hidden="true">&nbsp;</span>
    </p>
    <svg
      ref="svgEl"
      :viewBox="`0 0 ${W} ${H}`"
      class="ink-svg"
      role="img"
      @mousemove="onMove"
      @mouseleave="hoverX = null"
    >
      <!-- 全幅纸底：页面上被卡片同色遮住无感，PNG 序列化导出后自带暖纸底（不在 CSS 里，导出不丢） -->
      <rect x="0" y="0" :width="W" :height="H" rx="16" :fill="INK.paper" />
      <!-- 基线 + y 刻度（无网格——发丝折线的留白读法） -->
      <line :x1="PX0 - 6" :y1="PY1" :x2="PX1" :y2="PY1" :stroke="INK.grid" stroke-width="0.8" class="fade" />
      <text
        v-for="(tk, i) in yTicks.ticks"
        :key="'y' + i"
        :x="PX0 - 10"
        :y="y(tk) + 3"
        font-size="10"
        font-weight="600"
        :fill="INK.muted"
        text-anchor="end"
        class="fade"
      >{{ fmtTick(tk) }}</text>

      <!-- 日历条码（主系列逐桶） -->
      <template v-for="(ps, si) in perSeries" :key="'bar' + si">
        <template v-if="si === 0">
          <line
            v-for="(bi, i) in barcodeTicks"
            :key="'bt' + i"
            :x1="x(ps.s.points[bi].t)"
            :y1="PY1"
            :x2="x(ps.s.points[bi].t)"
            :y2="BARCODE_Y2"
            stroke="#CFCEC7"
            stroke-width="0.6"
            class="fade"
            :style="{ animationDelay: `${i * 0.008}s` }"
          />
        </template>
      </template>

      <!-- x 轴首/中/尾日期 -->
      <text
        v-for="(lb, i) in xLabels"
        :key="'xl' + i"
        :x="x(lb.ts)"
        :y="XLABEL_Y"
        font-size="10"
        font-weight="600"
        :fill="INK.muted"
        :text-anchor="lb.anchor"
        letter-spacing="0.08em"
        class="fade"
      >{{ fmtDate(lb.ts) }}</text>

      <!-- 系列图例行（多系列时） -->
      <template v-if="series.length > 1">
        <g v-for="(lb, i) in legendEntries" :key="'lg' + i" class="fade" :style="{ animationDelay: `${0.3 + i * 0.08}s` }">
          <line :x1="lb.x" :y1="20" :x2="lb.x + 18" :y2="20" :stroke="lb.color" stroke-width="1.4" />
          <text :x="lb.x + 24" :y="23.5" font-size="11" font-weight="700" :fill="INK.ink">{{ lb.name }}</text>
        </g>
      </template>

      <!-- σ 带（墨线下的极简表达：同色 8% 透明度） -->
      <template v-for="(ps, si) in perSeries" :key="'band' + si">
        <path
          v-if="ps.s.band && ps.s.band.length >= 2"
          :d="'M' + ps.s.band.map((q) => `${x(q.t).toFixed(1)} ${y(q.hi).toFixed(1)}`).join(' L ') + ' L ' + [...ps.s.band].reverse().map((q) => `${x(q.t).toFixed(1)} ${y(q.lo).toFixed(1)}`).join(' L ') + ' Z'"
          :fill="ps.color"
          fill-opacity="0.08"
          class="fade"
        />
      </template>

      <!-- 发丝折线 + 移动平均虚线 + 逐点圆点 -->
      <g v-for="(ps, si) in perSeries" :key="'s' + si">
        <path
          v-if="ps.d"
          :d="ps.d"
          fill="none"
          :stroke="ps.color"
          stroke-width="1"
          pathLength="1"
          class="draw"
          :style="{ animationDuration: '1.1s', animationDelay: `${si * 0.15}s` }"
        />
        <path
          v-if="ps.maD"
          :d="ps.maD"
          fill="none"
          :stroke="ps.color"
          stroke-width="0.7"
          stroke-dasharray="3 3"
          opacity="0.9"
          class="fade"
          :style="{ animationDelay: `${0.8 + si * 0.12}s` }"
        />
        <template v-if="dotsOn">
          <circle
            v-for="(q, i) in ps.s.points"
            :key="'d' + i"
            :cx="x(q.t)"
            :cy="y(q.v)"
            :r="2.1"
            :fill="hollowWeekend && isWeekend(q.t) ? INK.paper : ps.color"
            :stroke="ps.color"
            :stroke-width="hollowWeekend && isWeekend(q.t) ? 1 : 0"
            class="pop"
            :style="{ animationDelay: `${0.2 + i * 0.02}s` }"
          >
            <title>{{ ps.s.name }} · {{ fmtDate(q.t) }} — {{ fmtValue(q.v) }}{{ ps.s.unit ? ' ' + ps.s.unit : '' }}</title>
          </circle>
        </template>
        <!-- 峰值光晕标注 -->
        <text
          v-if="ps.peak"
          :x="ps.peak.px"
          :y="ps.peak.py - 10"
          font-size="10.5"
          font-weight="800"
          :fill="ps.color"
          text-anchor="middle"
          class="fade"
          :style="{ paintOrder: 'stroke', stroke: INK.paper, strokeWidth: '3px', animationDelay: `${1 + si * 0.06}s` }"
        >{{ ps.peak.label }}</text>
      </g>

      <!-- 悬停层：竖发丝 + 读数小签（导出 PNG 时整组剔除） -->
      <g v-if="hover" data-hover-layer>
        <line :x1="hover.cx" :y1="PY0 - 6" :x2="hover.cx" :y2="PY1" :stroke="INK.ink" stroke-width="0.6" opacity="0.5" />
        <circle v-for="(r, i) in hover.rows" :key="'hr' + i" :cx="r.px" :cy="r.py" r="3.4" :fill="INK.paper" :stroke="r.color" stroke-width="1.4" />
        <g :transform="`translate(${hover.chipX}, ${PY0})`">
          <rect :width="hover.width" :height="24 + hover.rows.length * 17" rx="4" :fill="INK.paper" :stroke="INK.ink" stroke-width="0.8" />
          <text :x="9" :y="16" font-size="10" font-weight="700" :fill="INK.ink">{{ hover.dateText }}</text>
          <template v-for="(r, i) in hover.rows" :key="'hrow' + i">
            <rect :x="9" :y="24 + i * 17 + 1" width="8" height="8" :fill="r.color" />
            <text :x="22" :y="24 + i * 17 + 9" font-size="10" font-weight="600" :fill="INK.ink">{{ r.name }} {{ r.label }}</text>
          </template>
        </g>
      </g>

      <!-- 底注：点语义说明 -->
      <text v-if="footNote" :x="(PX0 + PX1) / 2" :y="FOOT_Y" font-size="9.5" font-weight="600" :fill="INK.faint" text-anchor="middle" letter-spacing="0.12em" class="fade" :style="{ animationDelay: '1.1s' }">{{ footNote }}</text>
    </svg>
    <p class="ink-src">INK LINE · {{ frame.series.length }} {{ t('tracking.srcSeries') }} · {{ sourceLabel }}</p>
  </div>
</template>
