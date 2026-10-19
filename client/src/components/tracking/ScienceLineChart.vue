<script setup lang="ts">
/**
 * 科研折线渲染器（期刊插图级）：四边框轴 + 内勾主/次刻度、主实线/次点线网格、
 * 轴标题带单位、Okabe-Ito 色盲安全分类色（尊重每项目自定义 color）、
 * 标记形状轮换 ○□△◇✕、带框图例（内/外可切）、移动平均虚线 + 可选 ±1σ 带、
 * 可选线性趋势线（图例附 R²）、十字线 + 读数面板（最近 x 吸附）。
 * 无入场动画（科研 = 静态精确）；明暗两套非数据色（isDark），数据色不变。
 * 全部样式走 SVG 属性，PNG 序列化导出后颜色完整。
 */
import { computed, ref } from 'vue'
import { useLocale } from '../../stores/locale'
import {
  OKABE_ITO, sciencePalette, niceTicks, minorDivisions, timeTicks,
  fmtTick, fmtValue, fmtDate, fmtDateTime, fmtTimeTick,
  type ChartFrame, type TrackingConfig,
} from '../../composables/useTracking'

const props = defineProps<{
  frame: ChartFrame
  config: TrackingConfig
  title: string
  isDark: boolean
}>()

const { t } = useLocale()
const P = computed(() => sciencePalette(props.isDark))

// ---------- 几何 ----------

const W = 880
const H = 460
const PX0 = 68
const PX1 = 830
const TOP = computed(() => (props.config.legendInside ? 26 : 58))
const BOTTOM = 366
const XLABEL_Y = 388
const XAXIS_Y = 416

const xDom = computed<[number, number]>(() => {
  const d = props.frame.xDomain
  if (!d) return [0, 1]
  if (d[1] - d[0] < 1) return [d[0] - 43200000, d[1] + 43200000]
  const pad = (d[1] - d[0]) * 0.01
  return [d[0] - pad, d[1] + pad]
})

// y 域：上下各留 6%
const yDom = computed<[number, number]>(() => {
  const d = props.frame.yDomain
  if (!d) return [0, 1]
  const span = d[1] - d[0] || Math.abs(d[1]) || 1
  return [d[0] - span * 0.06, d[1] + span * 0.06]
})

const x = (ts: number) => PX0 + ((ts - xDom.value[0]) / (xDom.value[1] - xDom.value[0])) * (PX1 - PX0)
const y = (v: number) => BOTTOM - ((v - yDom.value[0]) / (yDom.value[1] - yDom.value[0])) * (BOTTOM - TOP.value)

const yTicks = computed(() => niceTicks(yDom.value[0], yDom.value[1], 6))
// 次刻度：主步细分（不与主刻度重合）
const yMinor = computed(() => {
  const div = minorDivisions(yTicks.value.step)
  const out: number[] = []
  for (let i = 0; i < yTicks.value.ticks.length - 1; i++) {
    for (let j = 1; j < div; j++) out.push(yTicks.value.ticks[i] + (yTicks.value.step * j) / div)
  }
  return out
})

const xTicksRaw = computed(() => timeTicks(xDom.value[0], xDom.value[1], 8))
const xTicks = computed(() => xTicksRaw.value.map((ts) => ({ ts, px: x(ts) })))
// x 次刻度：相邻主刻度间 5 等分
const xMinor = computed(() => {
  const out: number[] = []
  for (let i = 0; i < xTicksRaw.value.length - 1; i++) {
    const a = xTicksRaw.value[i]
    const b = xTicksRaw.value[i + 1]
    for (let j = 1; j < 5; j++) out.push(a + ((b - a) * j) / 5)
  }
  return out
})

// y=0 参考线（值域跨零时加粗一档）
const hasZero = computed(() => yDom.value[0] < 0 && yDom.value[1] > 0)

const spanMs = computed(() => xDom.value[1] - xDom.value[0])

// ---------- 系列 ----------

const MARKERS = ['circle', 'square', 'triangle', 'diamond', 'cross'] as const
const MARKER_SIZE = 3.6

const perSeries = computed(() =>
  props.frame.series.map((s, i) => {
    const color = s.color || OKABE_ITO[i % OKABE_ITO.length]
    const marker = MARKERS[i % MARKERS.length]
    const d =
      s.points.length >= 2
        ? 'M' + s.points.map((q) => `${x(q.t).toFixed(1)} ${y(q.v).toFixed(1)}`).join(' L ')
        : ''
    const maD = s.ma && s.ma.length >= 2 ? 'M' + s.ma.map((q) => `${x(q.t).toFixed(1)} ${y(q.v).toFixed(1)}`).join(' L ') : ''
    // σ 带路径：上缘顺 + 下缘逆闭合
    const bandD =
      s.band && s.band.length >= 2
        ? 'M' + s.band.map((q) => `${x(q.t).toFixed(1)} ${y(q.hi).toFixed(1)}`).join(' L ') +
          ' L ' + [...s.band].reverse().map((q) => `${x(q.t).toFixed(1)} ${y(q.lo).toFixed(1)}`).join(' L ') +
          ' Z'
        : ''
    // 趋势线：贯穿绘图区两端
    let trendLine: { x1: number; y1: number; x2: number; y2: number } | null = null
    if (props.config.trendline && s.trend) {
      const f = (ts: number) => y(s.trend!.slope * ((ts - s.trend!.t0) / 86400000) + s.trend!.intercept)
      trendLine = { x1: PX0, y1: f(xDom.value[0]), x2: PX1, y2: f(xDom.value[1]) }
    }
    return { s, color, marker, d, maD, bandD, trendLine }
  })
)

const dotsOn = computed(() => {
  const maxN = Math.max(...props.frame.series.map((s) => s.points.length), 0)
  if (props.config.showPoints === 'off') return false
  if (props.config.showPoints === 'on') return maxN <= 240
  return maxN <= 60
})

// ---------- 图例 ----------

const legend = computed(() => {
  const rows = perSeries.value.map((ps) => ({
    name: ps.s.name,
    unit: ps.s.unit,
    color: ps.color,
    marker: ps.marker,
    r2: props.config.trendline && ps.s.trend ? ps.s.trend.r2 : null,
    ma: !!ps.s.ma,
  }))
  const textOf = (r: (typeof rows)[number]) =>
    `${r.name}${r.unit ? ` (${r.unit})` : ''}${r.r2 !== null ? `  R²=${r.r2.toFixed(2)}` : ''}${r.ma ? '  —' : ''}`
  const rowW = 34 + Math.max(...rows.map((r) => textOf(r).length), 0) * 7.6
  return { rows, textOf, w: Math.min(rowW, PX1 - PX0 - 24), h: rows.length * 20 + 12 }
})

// ---------- 轴标题 ----------

const yTitle = computed(() => {
  if (props.frame.normalized) return t('tracking.axisNormalized')
  const u = props.frame.yUnit
  return u ? `${t('tracking.axisValue')} / ${u}` : t('tracking.axisValue')
})

// ---------- 悬停十字线 + 读数 ----------

const hoverX = ref<number | null>(null)
const svgEl = ref<SVGSVGElement | null>(null)

const unionTs = computed(() => {
  const set = new Set<number>()
  for (const s of props.frame.series) for (const q of s.points) set.add(q.t)
  return [...set].sort((a, b) => a - b)
})

const hover = computed(() => {
  if (hoverX.value === null || unionTs.value.length === 0) return null
  const ts = hoverX.value
  const nearest = unionTs.value.reduce((p, c) => (Math.abs(c - ts) < Math.abs(p - ts) ? c : p))
  const rows: { name: string; value: string; unit: string; color: string; px: number; py: number }[] = []
  for (const ps of perSeries.value) {
    let best = ps.s.points[0]
    for (const q of ps.s.points) if (Math.abs(q.t - nearest) < Math.abs(best.t - nearest)) best = q
    if (!best) continue
    rows.push({ name: ps.s.name, value: fmtValue(best.v), unit: ps.s.unit, color: ps.color, px: x(best.t), py: y(best.v) })
  }
  if (!rows.length) return null
  const cx = x(nearest)
  const dateText = props.config.agg === 'raw' ? fmtDateTime(nearest) : fmtDate(nearest)
  const w = Math.max(dateText.length, ...rows.map((r) => `${r.name} ${r.value} ${r.unit}`.trim().length)) * 7.4 + 30
  return { cx, dateText, rows, w, h: rows.length * 19 + 14 }
})

function onMove(e: MouseEvent) {
  const svg = svgEl.value
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const vx = ((e.clientX - rect.left) / rect.width) * W
  hoverX.value = xDom.value[0] + ((vx - PX0) / (PX1 - PX0)) * (xDom.value[1] - xDom.value[0])
}
</script>

<template>
  <div class="tracking-sci-card" :class="{ 'is-dark': isDark }">
    <svg
      ref="svgEl"
      :viewBox="`0 0 ${W} ${H}`"
      class="sci-svg"
      role="img"
      @mousemove="onMove"
      @mouseleave="hoverX = null"
    >
      <!-- 全幅底色：页面上与卡体同色无感，PNG 导出后图外留白也带底（明暗随 isDark） -->
      <rect x="0" y="0" :width="W" :height="H" :fill="P.bg" />
      <!-- 绘图区底 + 四边框轴 -->
      <rect :x="PX0" :y="TOP" :width="PX1 - PX0" :height="BOTTOM - TOP" :fill="P.bg" :stroke="P.frame" stroke-width="1.2" />

      <!-- 主网格（横向）+ 次网格（点线，可选） -->
      <template v-if="config.minorGrid">
        <line v-for="(mv, i) in yMinor" :key="'ym' + i" :x1="PX0" :y1="y(mv)" :x2="PX1" :y2="y(mv)" :stroke="P.gridMinor" stroke-width="0.8" stroke-dasharray="1 3" />
      </template>
      <line v-for="(tk, i) in yTicks.ticks" :key="'yg' + i" :x1="PX0" :y1="y(tk)" :x2="PX1" :y2="y(tk)" :stroke="hasZero && tk === 0 ? P.frame : P.grid" :stroke-width="hasZero && tk === 0 ? 1 : 0.8" :opacity="hasZero && tk === 0 ? 0.9 : 1" />
      <template v-if="config.minorGrid">
        <line v-for="(mt, i) in xMinor" :key="'xm' + i" :x1="x(mt)" :y1="TOP" :x2="x(mt)" :y2="BOTTOM" :stroke="P.gridMinor" stroke-width="0.8" stroke-dasharray="1 3" />
      </template>

      <!-- y 主/次刻度（内勾）+ 刻度值 -->
      <line v-for="(mv, i) in yMinor" :key="'yt' + i" :x1="PX0" :y1="y(mv)" :x2="PX0 + 3" :y2="y(mv)" :stroke="P.frame" stroke-width="0.8" />
      <template v-for="(tk, i) in yTicks.ticks" :key="'ytm' + i">
        <line :x1="PX0" :y1="y(tk)" :x2="PX0 + 6" :y2="y(tk)" :stroke="P.frame" stroke-width="1.2" />
        <text :x="PX0 - 10" :y="y(tk) + 3.5" font-size="10.5" :fill="P.text" text-anchor="end" font-weight="600">{{ fmtTick(tk) }}</text>
      </template>

      <!-- x 主/次刻度（内勾）+ 刻度值 -->
      <line v-for="(mt, i) in xMinor" :key="'xt' + i" :x1="x(mt)" :y1="BOTTOM - 3" :x2="x(mt)" :y2="BOTTOM" :stroke="P.frame" stroke-width="0.8" />
      <template v-for="(tk, i) in xTicks" :key="'xtm' + i">
        <line :x1="tk.px" :y1="BOTTOM - 6" :x2="tk.px" :y2="BOTTOM" :stroke="P.frame" stroke-width="1.2" />
        <text :x="tk.px" :y="XLABEL_Y" font-size="10.5" :fill="P.text" text-anchor="middle" font-weight="600">{{ fmtTimeTick(tk.ts, spanMs) }}</text>
      </template>

      <!-- 轴标题 -->
      <text :x="(PX0 + PX1) / 2" :y="XAXIS_Y" font-size="12" :fill="P.text" text-anchor="middle" font-weight="700">{{ t('tracking.axisDate') }}</text>
      <text :x="18" :y="(TOP + BOTTOM) / 2" font-size="12" :fill="P.text" text-anchor="middle" font-weight="700" :transform="`rotate(-90 18 ${(TOP + BOTTOM) / 2})`">{{ yTitle }}</text>

      <!-- σ 带 -->
      <template v-for="(ps, i) in perSeries">
        <path v-if="ps.bandD" :key="'bd' + i" :d="ps.bandD" :fill="ps.color" fill-opacity="0.12" />
      </template>

      <!-- 趋势线（虚） -->
      <template v-for="(ps, i) in perSeries">
        <line
          v-if="ps.trendLine"
          :key="'tl' + i"
          :x1="ps.trendLine.x1" :y1="ps.trendLine.y1" :x2="ps.trendLine.x2" :y2="ps.trendLine.y2"
          :stroke="ps.color" stroke-width="1" stroke-dasharray="2 3" opacity="0.6"
        />
      </template>

      <!-- 数据折线 + 移动平均 + 标记 -->
      <g v-for="(ps, i) in perSeries" :key="'sg' + i">
        <path v-if="ps.d" :d="ps.d" fill="none" :stroke="ps.color" stroke-width="1.6" />
        <path v-if="ps.maD" :d="ps.maD" fill="none" :stroke="ps.color" stroke-width="1.4" stroke-dasharray="5 4" opacity="0.85" />
        <template v-if="dotsOn">
          <template v-for="(q, j) in ps.s.points" :key="'mk' + j">
            <circle v-if="ps.marker === 'circle'" :cx="x(q.t)" :cy="y(q.v)" :r="MARKER_SIZE" :fill="isDark ? P.bg : '#FFFFFF'" :stroke="ps.color" stroke-width="1.4">
              <title>{{ ps.s.name }} · {{ fmtDate(q.t) }} — {{ fmtValue(q.v) }}{{ ps.s.unit ? ' ' + ps.s.unit : '' }}</title>
            </circle>
            <rect v-else-if="ps.marker === 'square'" :x="x(q.t) - MARKER_SIZE" :y="y(q.v) - MARKER_SIZE" :width="MARKER_SIZE * 2" :height="MARKER_SIZE * 2" :fill="isDark ? P.bg : '#FFFFFF'" :stroke="ps.color" stroke-width="1.4">
              <title>{{ ps.s.name }} · {{ fmtDate(q.t) }} — {{ fmtValue(q.v) }}{{ ps.s.unit ? ' ' + ps.s.unit : '' }}</title>
            </rect>
            <polygon v-else-if="ps.marker === 'triangle'" :points="`${x(q.t)},${y(q.v) - MARKER_SIZE - 1} ${x(q.t) - MARKER_SIZE - 1},${y(q.v) + MARKER_SIZE} ${x(q.t) + MARKER_SIZE + 1},${y(q.v) + MARKER_SIZE}`" :fill="isDark ? P.bg : '#FFFFFF'" :stroke="ps.color" stroke-width="1.4">
              <title>{{ ps.s.name }} · {{ fmtDate(q.t) }} — {{ fmtValue(q.v) }}{{ ps.s.unit ? ' ' + ps.s.unit : '' }}</title>
            </polygon>
            <rect v-else-if="ps.marker === 'diamond'" :x="x(q.t) - MARKER_SIZE" :y="y(q.v) - MARKER_SIZE" :width="MARKER_SIZE * 2" :height="MARKER_SIZE * 2" :fill="isDark ? P.bg : '#FFFFFF'" :stroke="ps.color" stroke-width="1.4" :transform="`rotate(45 ${x(q.t)} ${y(q.v)})`">
              <title>{{ ps.s.name }} · {{ fmtDate(q.t) }} — {{ fmtValue(q.v) }}{{ ps.s.unit ? ' ' + ps.s.unit : '' }}</title>
            </rect>
            <g v-else-if="ps.marker === 'cross'">
              <line :x1="x(q.t) - MARKER_SIZE" :y1="y(q.v) - MARKER_SIZE" :x2="x(q.t) + MARKER_SIZE" :y2="y(q.v) + MARKER_SIZE" :stroke="ps.color" stroke-width="1.5" />
              <line :x1="x(q.t) - MARKER_SIZE" :y1="y(q.v) + MARKER_SIZE" :x2="x(q.t) + MARKER_SIZE" :y2="y(q.v) - MARKER_SIZE" :stroke="ps.color" stroke-width="1.5" />
              <title>{{ ps.s.name }} · {{ fmtDate(q.t) }} — {{ fmtValue(q.v) }}{{ ps.s.unit ? ' ' + ps.s.unit : '' }}</title>
            </g>
          </template>
        </template>
      </g>

      <!-- 悬停层：十字竖线 + 最近点标记 + 读数面板（导出 PNG 时整组剔除） -->
      <g v-if="hover" data-hover-layer>
        <line :x1="hover.cx" :y1="TOP" :x2="hover.cx" :y2="BOTTOM" :stroke="P.frame" stroke-width="0.8" stroke-dasharray="3 3" />
        <circle v-for="(r, i) in hover.rows" :key="'hm' + i" :cx="r.px" :cy="r.py" r="4.2" :fill="isDark ? P.bg : '#FFFFFF'" :stroke="r.color" stroke-width="1.8" />
        <g :transform="`translate(${PX0 + 12}, ${TOP + 12})`">
          <rect :width="hover.w" :height="hover.h" :fill="P.legendBg" :stroke="P.grid" stroke-width="1" />
          <text :x="10" :y="18" font-size="11" font-weight="700" :fill="P.text">{{ hover.dateText }}</text>
          <template v-for="(r, i) in hover.rows" :key="'hr' + i">
            <rect :x="10" :y="26 + i * 19" width="9" height="9" :fill="r.color" />
            <text :x="25" :y="26 + i * 19 + 8.5" font-size="10.5" :fill="P.text">{{ r.name }} {{ r.value }}<tspan v-if="r.unit" font-size="9" font-weight="600"> {{ r.unit }}</tspan></text>
          </template>
        </g>
      </g>

      <!-- 图例（带框）：内 = 绘图区右上；外 = 图上方右侧 -->
      <g v-if="config.legendInside" :transform="`translate(${PX1 - legend.w - 12}, ${TOP + 12})`">
        <rect :width="legend.w" :height="legend.h" :fill="P.legendBg" :stroke="P.grid" stroke-width="1" />
        <template v-for="(r, i) in legend.rows" :key="'lg' + i">
          <line :x1="12" :y1="16 + i * 20" :x2="34" :y2="16 + i * 20" :stroke="r.color" stroke-width="1.8" />
          <circle :cx="23" :cy="16 + i * 20" r="2.6" :fill="isDark ? P.legendBg : '#FFFFFF'" :stroke="r.color" stroke-width="1.2" />
          <text :x="40" :y="16 + i * 20 + 4" font-size="11" :fill="P.text">{{ legend.textOf(r) }}</text>
        </template>
      </g>
      <g v-else>
        <template v-for="(r, i) in legend.rows" :key="'lgo' + i">
          <line :x1="PX1 - legend.w + 4" :y1="20 + i * 20" :x2="PX1 - legend.w + 26" :y2="20 + i * 20" :stroke="r.color" stroke-width="1.8" />
          <circle :cx="PX1 - legend.w + 15" :cy="20 + i * 20" r="2.6" :fill="isDark ? P.legendBg : '#FFFFFF'" :stroke="r.color" stroke-width="1.2" />
          <text :x="PX1 - legend.w + 32" :y="20 + i * 20 + 4" font-size="11" :fill="P.text">{{ legend.textOf(r) }}</text>
        </template>
      </g>
    </svg>
    <p class="sci-caption">{{ title }}</p>
  </div>
</template>
