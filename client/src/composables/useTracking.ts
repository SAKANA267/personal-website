import { computed, reactive, ref, watch } from 'vue'
import { api } from './useApi'
import { useAuth } from '../stores/auth'
import { IMPORT_CHUNK } from './useTrackingImport'
import type { TrackingPoint, TrackingProject } from '../types'

/**
 * 数值追踪：状态与数据管线（/tracking 页，模块级单例——与 useDataMask 同风格）。
 *
 * 项目与数据点存服务端（/api/tracking，登录私有），此处维护
 * projects + 全量点位缓存；游客可载入确定性演示数据体验全部图表客制化。
 *
 * 图表数据管线（墨线/科研两个渲染器共用，纯函数 buildFrame）：
 *   范围过滤 → 分桶聚合（raw/day/week/month × avg/min/max/last）→ 统计（原始刻度）
 *   → 移动平均 + 滚动 σ 带 → 归一化（minmax/zscore）→ 趋势回归（最终显示刻度）。
 * 配置整体持久化在 localStorage['trackingConfig']（浅合并默认值，前向兼容）。
 */

// ---------- 类型 ----------

export type TrackingStyle = 'ink' | 'science'
export type TrackingAgg = 'raw' | 'day' | 'week' | 'month'
export type TrackingAggBy = 'avg' | 'min' | 'max' | 'last'
export type TrackingNormalize = 'none' | 'minmax' | 'zscore'
export type TrackingRangePreset = 'all' | 'd7' | 'd30' | 'd90' | 'year' | 'custom'

export interface TrackingConfig {
  style: TrackingStyle
  title: string // 空 = 自动结论式标题（墨线卡头）
  rangePreset: TrackingRangePreset
  rangeFrom: string // yyyy-MM-dd（preset=custom 时生效）
  rangeTo: string
  agg: TrackingAgg
  aggBy: TrackingAggBy
  smooth: number // 移动平均窗口，0 = 关，2-30
  normalize: TrackingNormalize
  showPoints: 'auto' | 'on' | 'off' // auto = 点数 ≤60 才显示
  peakLabels: boolean // 墨线：峰值光晕标注
  legendInside: boolean // 科研：图例框内/外
  minorGrid: boolean // 科研：次网格
  trendline: boolean // 科研：线性趋势线 + R²
  sigmaBand: boolean // 科研：移动平均 ±1σ 带（需 smooth > 1）
  yManualOn: boolean
  yMin: number | null
  yMax: number | null
  visible: Record<string, boolean> // 项目 id → 是否参与对比（缺省 = true）
}

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  style: 'ink',
  title: '',
  rangePreset: 'all',
  rangeFrom: '',
  rangeTo: '',
  agg: 'raw',
  aggBy: 'avg',
  smooth: 0,
  normalize: 'none',
  showPoints: 'auto',
  peakLabels: true,
  legendInside: true,
  minorGrid: true,
  trendline: false,
  sigmaBand: false,
  yManualOn: false,
  yMin: null,
  yMax: null,
  visible: {},
}

export interface StatBlock {
  count: number
  mean: number
  min: number
  max: number
  first: number | null
  last: number | null
  delta: number | null // last - first
  deltaPct: number | null // (last-first)/|first|，first=0 时 null
  slope: number | null // 线性回归斜率（单位/天，最终显示刻度）
  r2: number | null
}

export interface FrameSeries {
  key: string
  id: number
  name: string
  unit: string
  color: string | null // 用户自定义色（科研风格采纳；墨线固定灰阶）
  points: { t: number; v: number }[]
  ma: { t: number; v: number }[] | null
  band: { t: number; lo: number; hi: number }[] | null
  trend: { slope: number; intercept: number; r2: number; t0: number } | null
  stats: StatBlock
}

export interface ChartFrame {
  series: FrameSeries[]
  xDomain: [number, number] | null // 全体可见系列的 t 并集（紧界，渲染器自行留白）
  yDomain: [number, number] | null
  yUnit: string // 主单位（首系列；混合单位且未归一化时渲染器提示）
  normalized: boolean
  mixedUnits: boolean
  rangeLabel: string // 'YYYY-MM-DD ~ YYYY-MM-DD'（实际渲染区间）
}

// ---------- 常量与调色 ----------

export const CONFIG_KEY = 'trackingConfig'

// 墨线 Mono 灰阶（明度即数据：越靠前越重要越黑；与 charts-lab 同族）
export const INK_LADDER = ['#1C1C1A', '#413F3A', '#6C6A63', '#97958D', '#B8B6AE', '#D3D1C8']
// 墨线卡固定暖纸墨色（两种主题下都如图片般保持原样，PNG 导出同色）
export const INK_PALETTE = { paper: '#F0EFEB', ink: '#1C1C1A', muted: '#8F8E88', faint: '#C6C5BF', grid: '#DEDDD6' }

// 科研风格：Okabe-Ito 色盲安全分类色（去掉黑与过浅的黄，6 色循环；深浅底均可用）
export const OKABE_ITO = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9']

// 科研风格明暗两套非数据色（框轴/网格/文字；数据色不变）
export function sciencePalette(isDark: boolean) {
  return isDark
    ? { bg: '#101318', frame: '#8B93A1', text: '#C9D1DC', grid: '#2A3038', gridMinor: '#22272E', legendBg: '#161A21' }
    : { bg: '#FFFFFF', frame: '#3C4654', text: '#1F2937', grid: '#E2E6EC', gridMinor: '#EEF1F5', legendBg: '#FFFFFF' }
}

// ---------- 数值格式化 ----------

/** 至多 4 位小数、去尾零（与 DECIMAL(15,4) 精度一致） */
export function fmtValue(v: number): string {
  if (!Number.isFinite(v)) return '-'
  const r = Math.round(v * 10000) / 10000
  return Object.is(r, -0) ? '0' : String(r)
}

/** 轴刻度数字：大数缩位（k/M），其余至多 3 位小数去尾零 */
export function fmtTick(v: number): string {
  if (!Number.isFinite(v)) return '-'
  const a = Math.abs(v)
  if (a >= 1e9) return `${fmtValue(Math.round(v / 1e8) / 10)}G`
  if (a >= 1e6) return `${fmtValue(Math.round(v / 1e5) / 10)}M`
  if (a >= 1e4) return `${fmtValue(Math.round(v / 1e3) / 10)}k`
  return fmtValue(Math.round(v * 1000) / 1000)
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export function fmtDate(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function fmtDateTime(t: number): string {
  const d = new Date(t)
  return `${fmtDate(t)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 轴时间刻度文案：跨度 ≤2 天带时分，≤240 天到日，其余到月（数字格式，中英通用） */
export function fmtTimeTick(t: number, spanMs: number): string {
  const d = new Date(t)
  if (spanMs <= 2 * 86400000) return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (spanMs <= 240 * 86400000) return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

// ---------- 刻度工具（渲染器共用） ----------

/** 1-2-5 进位的“好刻度”：返回 [min,max] 区间内的刻度值与步长（就近取级，避免刻度过稀） */
export function niceTicks(min: number, max: number, count = 5): { ticks: number[]; step: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [], step: 1 }
  if (min === max) {
    const pad = Math.abs(min) || 1
    min -= pad / 2
    max += pad / 2
  }
  const rawStep = (max - min) / Math.max(1, count - 1)
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const candidates = [1, 2, 5, 10].map((m) => m * mag)
  // 取与理想步长最接近的候选（并列时取较小——刻度宁密勿稀）
  const step = candidates.reduce((a, b) => (Math.abs(b - rawStep) < Math.abs(a - rawStep) ? b : a))
  const start = Math.ceil(min / step - 1e-9) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return { ticks, step }
}

/** 次刻度细分格数（主步 2×10^k 用 4 格，1/5 用 5 格——不与主刻度重合） */
export function minorDivisions(step: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(step)))
  const norm = Math.round(step / mag)
  return norm === 2 ? 4 : 5
}

/** 时间轴刻度：按跨度自动选 时/日/周/月 步进（日以上对齐本地零点；月步进逐月推进） */
export function timeTicks(x0: number, x1: number, count = 6): number[] {
  if (!(x1 > x0)) return [x0]
  const span = x1 - x0
  const DAY = 86400000
  const days = span / DAY
  if (days <= 2) {
    const fixed = [60000, 300000, 3600000, 3 * 3600000, 6 * 3600000, 12 * 3600000]
    for (const s of fixed) {
      if (span / s <= count) {
        const out: number[] = []
        for (let t = Math.ceil(x0 / s) * s; t <= x1; t += s) out.push(t)
        return out
      }
    }
  }
  const daySteps = [1, 2, 7, 14]
  for (const ds of daySteps) {
    if (days / ds <= count) {
      const s = ds * DAY
      const d0 = new Date(x0)
      d0.setHours(0, 0, 0, 0)
      const out: number[] = []
      for (let t = d0.getTime() + (ds === 1 ? 0 : 0); t <= x1 + s; t += s) if (t >= x0 && t <= x1) out.push(t)
      return out
    }
  }
  // 月步进：从 x0 所在月起逐月推进
  let months = 1
  while (days / (months * 30.44) > count) months *= 2
  const out: number[] = []
  const d = new Date(x0)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  while (d.getTime() <= x1) {
    if (d.getTime() >= x0) out.push(d.getTime())
    d.setMonth(d.getMonth() + months)
  }
  return out
}

// ---------- 分桶聚合 ----------

interface RawPoint { t: number; v: number }

function bucketStart(t: number, agg: 'day' | 'week' | 'month'): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  if (agg === 'day') return d.getTime()
  if (agg === 'week') {
    const day = (d.getDay() + 6) % 7 // 周一为一周之始
    return d.getTime() - day * 86400000
  }
  d.setDate(1)
  return d.getTime()
}

function aggregate(points: RawPoint[], agg: TrackingAgg, aggBy: TrackingAggBy): RawPoint[] {
  if (agg === 'raw') return points
  // 逐点归桶（点已升序，Map 保持插入序 = 桶时间序）
  const buckets = new Map<number, number[]>()
  for (const p of points) {
    const key = bucketStart(p.t, agg)
    const arr = buckets.get(key)
    if (arr) arr.push(p.v)
    else buckets.set(key, [p.v])
  }
  const out: RawPoint[] = []
  for (const [t, vs] of buckets) {
    let v: number
    if (aggBy === 'min') v = Math.min(...vs)
    else if (aggBy === 'max') v = Math.max(...vs)
    else if (aggBy === 'last') v = vs[vs.length - 1]
    else v = vs.reduce((s, x) => s + x, 0) / vs.length
    out.push({ t, v: Math.round(v * 10000) / 10000 })
  }
  return out
}

// ---------- 统计与回归 ----------

function computeStats(points: RawPoint[]): StatBlock {
  const n = points.length
  if (n === 0) {
    return { count: 0, mean: NaN, min: NaN, max: NaN, first: null, last: null, delta: null, deltaPct: null, slope: null, r2: null }
  }
  let sum = 0
  let min = Infinity
  let max = -Infinity
  for (const p of points) {
    sum += p.v
    if (p.v < min) min = p.v
    if (p.v > max) max = p.v
  }
  const first = points[0].v
  const last = points[n - 1].v
  // 回归（t 以天计；方差为 0 的常数序列无趋势）
  let slope: number | null = null
  let r2: number | null = null
  if (n >= 2) {
    const t0 = points[0].t
    let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0
    for (const p of points) {
      const x = (p.t - t0) / 86400000
      sx += x; sy += p.v; sxx += x * x; sxy += x * p.v; syy += p.v * p.v
    }
    const den = n * sxx - sx * sx
    if (den > 1e-12) {
      slope = (n * sxy - sx * sy) / den
      const intercept = (sy - slope * sx) / n
      const yMean = sy / n
      const ssTot = syy - n * yMean * yMean
      const ssRes = points.reduce((s, p) => {
        const yHat = slope! * ((p.t - t0) / 86400000) + intercept
        return s + (p.v - yHat) * (p.v - yHat)
      }, 0)
      r2 = ssTot > 1e-12 ? Math.max(0, 1 - ssRes / ssTot) : null
    }
  }
  return {
    count: n,
    mean: sum / n,
    min, max, first, last,
    delta: last - first,
    deltaPct: first !== 0 ? (last - first) / Math.abs(first) : null,
    slope, r2,
  }
}

// ---------- 移动平均 / σ 带 / 归一化 ----------

function movingAverage(points: RawPoint[], w: number): { ma: RawPoint[]; band: { t: number; lo: number; hi: number }[] } {
  const ma: RawPoint[] = []
  const band: { t: number; lo: number; hi: number }[] = []
  for (let i = w - 1; i < points.length; i++) {
    let sum = 0
    for (let j = i - w + 1; j <= i; j++) sum += points[j].v
    const m = sum / w
    let sq = 0
    for (let j = i - w + 1; j <= i; j++) sq += (points[j].v - m) * (points[j].v - m)
    const sd = Math.sqrt(sq / w)
    ma.push({ t: points[i].t, v: m })
    band.push({ t: points[i].t, lo: m - sd, hi: m + sd })
  }
  return { ma, band }
}

// ---------- 范围解析 ----------

function rangeBounds(cfg: TrackingConfig): { from: number | null; to: number | null } {
  const endOfToday = (() => {
    const d = new Date()
    d.setHours(23, 59, 59, 999)
    return d.getTime()
  })()
  switch (cfg.rangePreset) {
    case 'd7': return { from: endOfToday - 6 * 86400000, to: null }
    case 'd30': return { from: endOfToday - 29 * 86400000, to: null }
    case 'd90': return { from: endOfToday - 89 * 86400000, to: null }
    case 'year': {
      const d = new Date()
      d.setMonth(0, 1)
      d.setHours(0, 0, 0, 0)
      return { from: d.getTime(), to: null }
    }
    case 'custom': {
      const from = cfg.rangeFrom ? new Date(`${cfg.rangeFrom}T00:00:00`).getTime() : null
      const to = cfg.rangeTo ? new Date(`${cfg.rangeTo}T23:59:59.999`).getTime() : null
      return { from: Number.isFinite(from as number) ? from : null, to: Number.isFinite(to as number) ? to : null }
    }
    default: return { from: null, to: null }
  }
}

// ---------- 核心：图表帧构建（纯函数，真实/演示数据共用） ----------

export function buildFrame(
  cfg: TrackingConfig,
  projects: TrackingProject[],
  pointsMap: Record<number, TrackingPoint[]>
): ChartFrame {
  const { from, to } = rangeBounds(cfg)
  const visible = projects.filter((p) => cfg.visible[String(p.id)] !== false)
  const series: FrameSeries[] = []

  for (const p of visible) {
    const raw = (pointsMap[p.id] || [])
      .map((pt) => ({ t: new Date(pt.recordedAt).getTime(), v: pt.value }))
      .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.v))
      .filter((x) => (from === null || x.t >= from) && (to === null || x.t <= to))
      .sort((a, b) => a.t - b.t)
    const agg = aggregate(raw, cfg.agg, cfg.aggBy)
    if (agg.length === 0) continue

    const stats = computeStats(agg)

    // 归一化变换（作用于点/均线/σ带的同一函数，保证几何一致）
    let f: (v: number) => number = (v) => v
    if (cfg.normalize === 'minmax') {
      const lo = stats.min
      const hi = stats.max
      const span = hi - lo
      if (span > 1e-12) f = (v) => (v - lo) / span
    } else if (cfg.normalize === 'zscore') {
      // 总体 σ
      let sq = 0
      for (const q of agg) sq += (q.v - stats.mean) * (q.v - stats.mean)
      const sd = Math.sqrt(sq / agg.length)
      if (sd > 1e-12) f = (v) => (v - stats.mean) / sd
    }

    const points = agg.map((q) => ({ t: q.t, v: f(q.v) }))
    let ma: RawPoint[] | null = null
    let band: { t: number; lo: number; hi: number }[] | null = null
    if (cfg.smooth >= 2 && agg.length >= cfg.smooth) {
      const r = movingAverage(agg, cfg.smooth)
      ma = r.ma.map((q) => ({ t: q.t, v: f(q.v) }))
      band = cfg.sigmaBand ? r.band.map((q) => ({ t: q.t, lo: f(q.lo), hi: f(q.hi) })) : null
    }

    // 趋势回归在最终显示刻度上计算（归一化后 slope 单位随之变化，图上几何正确）
    let trend: FrameSeries['trend'] = null
    if (points.length >= 2) {
      const s = computeStats(points)
      if (s.slope !== null && s.r2 !== null) {
        const t0 = points[0].t
        // y = slope·x + intercept，x = (t - t0) 换算为天（与 computeStats 同一原点）
        const xMean = points.reduce((acc, q) => acc + (q.t - t0) / 86400000, 0) / points.length
        const yMean = points.reduce((acc, q) => acc + q.v, 0) / points.length
        trend = { slope: s.slope, intercept: yMean - s.slope * xMean, r2: s.r2, t0 }
      }
    }

    series.push({
      key: `p${p.id}`,
      id: p.id,
      name: p.name,
      unit: p.unit,
      color: p.color,
      points,
      ma,
      band,
      trend,
      stats,
    })
  }

  // x/y 域取全体可见系列的并集（y 含均线与 σ 带）
  let xDomain: [number, number] | null = null
  let yDomain: [number, number] | null = null
  for (const s of series) {
    for (const q of s.points) {
      if (!xDomain) xDomain = [q.t, q.t]
      else { if (q.t < xDomain[0]) xDomain[0] = q.t; if (q.t > xDomain[1]) xDomain[1] = q.t }
      if (!yDomain) yDomain = [q.v, q.v]
      else { if (q.v < yDomain[0]) yDomain[0] = q.v; if (q.v > yDomain[1]) yDomain[1] = q.v }
    }
    for (const q of s.ma || []) {
      if (q.v < yDomain![0]) yDomain![0] = q.v
      if (q.v > yDomain![1]) yDomain![1] = q.v
    }
    for (const q of s.band || []) {
      if (q.lo < yDomain![0]) yDomain![0] = q.lo
      if (q.hi > yDomain![1]) yDomain![1] = q.hi
    }
  }
  // 手动 y 轴覆盖（min/max 各自独立生效，可只夹一端）
  if (yDomain && cfg.yManualOn) {
    if (cfg.yMin !== null && Number.isFinite(cfg.yMin)) yDomain[0] = cfg.yMin
    if (cfg.yMax !== null && Number.isFinite(cfg.yMax)) yDomain[1] = cfg.yMax
  }

  const units = new Set(series.map((s) => s.unit))
  const rangeLabel = xDomain ? `${fmtDate(xDomain[0])} ~ ${fmtDate(xDomain[1])}` : ''

  return {
    series,
    xDomain,
    yDomain,
    yUnit: series[0]?.unit || '',
    normalized: cfg.normalize !== 'none',
    mixedUnits: units.size > 1,
    rangeLabel,
  }
}

// ---------- 演示数据（确定性伪随机，刷新不变；charts-lab rnd 同式） ----------

const rnd = (i: number, k: number) => Math.abs(((i * 73856093) ^ (k * 19349663)) % 1000) / 1000

export function buildDemoData(): { projects: TrackingProject[]; points: Record<number, TrackingPoint[]> } {
  const N = 90
  const today = new Date()
  today.setHours(20, 0, 0, 0)
  const dayTs = (i: number) => today.getTime() - (N - 1 - i) * 86400000

  const mkProject = (id: number, name: string, unit: string): TrackingProject => ({
    id, name, unit, description: '', color: null, createdAt: fmtDate(dayTs(0)),
    pointCount: 0, latestValue: null, latestAt: null, minValue: null, maxValue: null,
  })
  const p1 = mkProject(-1, '体重', 'kg')
  const p2 = mkProject(-2, '睡眠时长', 'h')
  const p3 = mkProject(-3, '跑步里程', 'km')

  const points: Record<number, TrackingPoint[]> = { [-1]: [], [-2]: [], [-3]: [] }
  let seq = 0
  const push = (pid: number, t: number, v: number) => {
    points[pid].push({ id: -1000 - seq++, value: Math.round(v * 100) / 100, recordedAt: new Date(t).toISOString().slice(0, 19), note: '' })
  }

  for (let i = 0; i < N; i++) {
    const t = dayTs(i)
    const weekend = [0, 6].includes(new Date(t).getDay())
    // 体重：缓慢下行 + 周期波动 + 噪声，约 15% 的天缺测
    if (rnd(i, 11) >= 0.15) {
      push(-1, t, 76.4 - i * 0.022 + 0.55 * Math.sin(i / 5.5) + (rnd(i, 1) - 0.5) * 0.7)
    }
    // 睡眠：日周期 + 周末补偿 + 噪声
    push(-2, t, 7.15 + 0.8 * Math.sin(i / 6.2) + (weekend ? 0.7 : 0) + (rnd(i, 2) - 0.5) * 0.9)
    // 跑步：隔天跑，周末加量
    if (i % 2 === 0 || weekend) {
      push(-3, t, 3.1 + 1.7 * Math.sin(i / 9) + (weekend ? 1.4 : 0) + rnd(i, 3) * 1.2)
    }
  }

  for (const p of [p1, p2, p3]) {
    const vs = points[p.id]
    p.pointCount = vs.length
    const last = vs[vs.length - 1]
    p.latestValue = last.value
    p.latestAt = last.recordedAt.replace('T', ' ').slice(0, 16)
    p.minValue = Math.min(...vs.map((x) => x.value))
    p.maxValue = Math.max(...vs.map((x) => x.value))
  }
  return { projects: [p1, p2, p3], points }
}

// ---------- CSV / PNG 导出 ----------

/** CSV 文件名日期段 */
function fileStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`
}

function csvCell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 当前对比视图导出 CSV：时间戳并集对齐各系列（+均线列），UTF-8 BOM + CRLF */
export function exportFrameCsv(frame: ChartFrame): void {
  const header = ['date']
  // 各系列的列起点（主值列 + 可选均线列，列序与表头一致）
  const offsets: number[] = []
  let col = 1
  for (const s of frame.series) {
    offsets.push(col)
    header.push(`${s.name}${s.unit ? ` (${s.unit})` : ''}`)
    col++
    if (s.ma) {
      header.push(`${s.name} MA`)
      col++
    }
  }
  const rows = new Map<number, (string | null)[]>()
  frame.series.forEach((s, i) => {
    for (const q of s.points) {
      const row = rows.get(q.t) || new Array(col).fill(null)
      row[offsets[i]] = fmtValue(q.v)
      rows.set(q.t, row)
    }
    if (s.ma) {
      for (const q of s.ma) {
        const row = rows.get(q.t) || new Array(col).fill(null)
        row[offsets[i] + 1] = fmtValue(q.v)
        rows.set(q.t, row)
      }
    }
  })
  const times = [...rows.keys()].sort((a, b) => a - b)
  const lines = [header.map(csvCell).join(',')]
  for (const t of times) {
    const row = rows.get(t)!
    // row[0] 恒空（date 列由此处前置），输出时跳过避免整行右移
    lines.push([fmtDateTime(t).replace(' ', 'T'), ...row.slice(1).map((c) => c ?? '')].map(csvCell).join(','))
  }
  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n'
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `tracking-${fileStamp()}.csv`)
}

/**
 * SVG 节点导出 PNG：克隆 → 剥动画/悬停层 → 显式宽高 → 序列化 →
 * blob URL → Image → 2x canvas 位图化。渲染器全部用 SVG 属性着色，
 * 序列化后颜色完整；CSP 的 img-src blob: 已放行（二维码导出同路径）。
 */
export function exportSvgPng(svg: SVGSVGElement, filename?: string): void {
  const vb = (svg.getAttribute('viewBox') || '0 0 880 420').split(/\s+/).map(Number)
  const w = vb[2] || 880
  const h = vb[3] || 420
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.querySelectorAll('[class]').forEach((n) => n.removeAttribute('class'))
  clone.querySelectorAll('[data-hover-layer]').forEach((n) => n.remove())
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  const xml = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = w * 2
    canvas.height = h * 2
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(2, 2)
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, filename || `tracking-${fileStamp()}.png`)
        URL.revokeObjectURL(url)
      }, 'image/png')
    } else {
      URL.revokeObjectURL(url)
    }
  }
  img.onerror = () => URL.revokeObjectURL(url)
  img.src = url
}

// ---------- 模块状态（真实数据 + 演示模式 + 配置） ----------

const { username } = useAuth()

const projects = ref<TrackingProject[]>([])
const pointsMap = ref<Record<number, TrackingPoint[]>>({})
const loaded = ref(false)
const loading = ref(false)
const loadError = ref(false)

const demoMode = ref(false)
const demoData = ref<{ projects: TrackingProject[]; points: Record<number, TrackingPoint[]> } | null>(null)

const selectedProjectId = ref<number | null>(null)

const config = reactive<TrackingConfig>(loadConfig())

function loadConfig(): TrackingConfig {
  const base: TrackingConfig = JSON.parse(JSON.stringify(DEFAULT_TRACKING_CONFIG))
  // 枚举字段的合法值白名单（坏存量值回落默认）
  const enums: Record<string, readonly unknown[]> = {
    style: ['ink', 'science'],
    agg: ['raw', 'day', 'week', 'month'],
    aggBy: ['avg', 'min', 'max', 'last'],
    normalize: ['none', 'minmax', 'zscore'],
    rangePreset: ['all', 'd7', 'd30', 'd90', 'year', 'custom'],
    showPoints: ['auto', 'on', 'off'],
  }
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) {
      const saved = JSON.parse(raw)
      for (const k of Object.keys(base) as (keyof TrackingConfig)[]) {
        if (k === 'visible') continue
        const v = saved[k]
        if (v === undefined) continue
        if (enums[k] && !enums[k].includes(v)) continue
        if (v !== undefined && typeof v === typeof base[k]) (base as any)[k] = v
      }
      if (saved.visible && typeof saved.visible === 'object') base.visible = saved.visible
      if (base.smooth !== 0 && (base.smooth < 2 || base.smooth > 30)) base.smooth = 0
    }
  } catch {
    // 坏数据走默认
  }
  return base
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => JSON.parse(JSON.stringify(config)),
  (cfg) => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)) } catch { /* 忽略配额错误 */ }
    }, 300)
  },
  { deep: true }
)

// ---------- 数据加载 ----------

/** 全量加载：项目列表 + 各项目点位（个人量级，一次拉齐供对比视图直接用） */
async function loadAll() {
  loading.value = true
  loadError.value = false
  try {
    const list = await api.getTrackingProjects()
    if (!Array.isArray(list)) throw new Error('bad shape')
    projects.value = list
    const map: Record<number, TrackingPoint[]> = {}
    await Promise.all(
      list.map(async (p) => {
        try {
          map[p.id] = await api.getTrackingPoints(p.id)
        } catch {
          map[p.id] = []
        }
      })
    )
    pointsMap.value = map
    loaded.value = true
    pruneVisible()
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

/** 清掉 visible 里已不存在的项目 id（项目删除后不留脏勾选） */
function pruneVisible() {
  const ids = new Set([...projects.value, ...(demoData.value?.projects || [])].map((p) => String(p.id)))
  for (const k of Object.keys(config.visible)) {
    if (!ids.has(k)) delete config.visible[k]
  }
}

// 登录态变化：真实数据随会话重载（游客登录后自动拉取；登出回空）
watch(username, () => {
  projects.value = []
  pointsMap.value = {}
  loaded.value = false
  selectedProjectId.value = null
  if (username.value) void loadAll()
})

// ---------- 演示模式 ----------

function enterDemo() {
  demoData.value = buildDemoData()
  demoMode.value = true
  selectedProjectId.value = demoData.value.projects[0].id
  pruneVisible()
}

function exitDemo() {
  demoMode.value = false
  demoData.value = null
  selectedProjectId.value = null
}

// ---------- 渲染输入（真实或演示二选一） ----------

const activeProjects = computed<TrackingProject[]>(() =>
  demoMode.value && demoData.value ? demoData.value.projects : projects.value
)
const activePoints = computed<Record<number, TrackingPoint[]>>(() =>
  demoMode.value && demoData.value ? demoData.value.points : pointsMap.value
)
const frame = computed<ChartFrame>(() => buildFrame(config, activeProjects.value, activePoints.value))

// ---------- 写操作（登录真实数据；演示模式禁用） ----------

export interface ApiResult { ok: boolean; error?: string }

async function run(fn: () => Promise<{ ok: boolean; data: any }>): Promise<ApiResult> {
  try {
    const r = await fn()
    if (!r.ok) return { ok: false, error: String(r.data?.error || 'SERVER_ERROR') }
    return { ok: true }
  } catch {
    return { ok: false, error: 'NETWORK' }
  }
}

async function refreshProject(id: number) {
  const list = await api.getTrackingProjects().catch(() => null)
  if (Array.isArray(list)) {
    projects.value = list
    const still = list.some((p) => p.id === id)
    if (still) {
      try { pointsMap.value = { ...pointsMap.value, [id]: await api.getTrackingPoints(id) } } catch { /* 保留旧值 */ }
    }
    pruneVisible()
  }
}

async function createProject(data: { name: string; unit?: string; description?: string; color?: string | null }): Promise<ApiResult> {
  const r = await run(() => api.createTrackingProject(data))
  if (r.ok) await loadAll()
  return r
}

async function updateProject(id: number, data: { name: string; unit?: string; description?: string; color?: string | null }): Promise<ApiResult> {
  const r = await run(() => api.updateTrackingProject(id, data))
  if (r.ok) await refreshProject(id)
  return r
}

async function deleteProject(id: number): Promise<ApiResult> {
  const r = await run(() => api.deleteTrackingProject(id))
  if (r.ok) {
    projects.value = projects.value.filter((p) => p.id !== id)
    const map = { ...pointsMap.value }
    delete map[id]
    pointsMap.value = map
    if (selectedProjectId.value === id) selectedProjectId.value = null
    pruneVisible()
  }
  return r
}

async function addPoint(projectId: number, data: { value: number; recordedAt?: string; note?: string }): Promise<ApiResult> {
  const r = await run(() => api.addTrackingPoint(projectId, data))
  if (r.ok) await refreshProject(projectId)
  return r
}

async function updatePoint(id: number, projectId: number, data: { value?: number; recordedAt?: string; note?: string }): Promise<ApiResult> {
  const r = await run(() => api.updateTrackingPoint(id, data))
  if (r.ok) await refreshProject(projectId)
  return r
}

async function deletePoint(id: number, projectId: number): Promise<ApiResult> {
  const r = await run(() => api.deleteTrackingPoint(id))
  if (r.ok) await refreshProject(projectId)
  return r
}

// ---------- Excel 批量导入（分片顺序提交，每片服务端单语句原子） ----------

/** 单项目数据点上限（与服务端 POINT_PROJECT_LIMIT 一致，预览容量拦截用） */
export const TRACKING_POINT_CAP = 10000

export interface ImportPointsResult {
  /** 全部分片成功为 true；false 时 imported 为中断前已入库条数（≥0） */
  ok: boolean
  imported: number
  error?: string
}

async function importPoints(
  projectId: number,
  rows: { value: number; recordedAt: string; note: string }[],
  onProgress?: (done: number, total: number) => void
): Promise<ImportPointsResult> {
  let imported = 0
  try {
    for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
      const chunk = rows.slice(i, i + IMPORT_CHUNK)
      const r = await api.importTrackingPoints(projectId, chunk)
      if (!r.ok) {
        // 中断也刷新（已入库的分片要在页面上可见），并带回已导入数
        if (imported > 0) await refreshProject(projectId)
        return { ok: false, imported, error: String(r.data?.error || 'SERVER_ERROR') }
      }
      imported += chunk.length
      onProgress?.(imported, rows.length)
    }
  } catch {
    if (imported > 0) await refreshProject(projectId)
    return { ok: false, imported, error: 'NETWORK' }
  }
  await refreshProject(projectId)
  return { ok: true, imported }
}

// ---------- 导出 ----------

export function useTracking() {
  return {
    // 状态
    projects: activeProjects,
    allProjects: projects,
    pointsMap: activePoints,
    loaded, loading, loadError,
    demoMode,
    selectedProjectId,
    config,
    frame,
    // 动作
    loadAll, enterDemo, exitDemo,
    createProject, updateProject, deleteProject,
    addPoint, updatePoint, deletePoint,
    importPoints,
    // 导出
    exportFrameCsv, exportSvgPng,
  }
}
