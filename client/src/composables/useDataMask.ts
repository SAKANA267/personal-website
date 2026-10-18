/**
 * 数据脱敏核心模块（纯前端，零网络）。
 *
 * - 8 类脱敏算法均为纯函数：哈希假名化天然确定；假数据 / 数值扰动以「单元格原值」
 *   为随机种子，同一原值在同一规则下得到同一输出——预览重算不跳变，且同值映射
 *   一致便于关联分析。空单元格一律不做处理。
 * - Excel 解析与 xlsx 导出经动态 import('xlsx')（SheetJS）惰性加载，只进入本模块
 *   被引用的路由懒加载分包，绝不进主包；CSV 导出为手写序列化（BOM + CRLF，
 *   Excel 打开中文不乱码），不依赖 xlsx。
 * - 文件内容仅以 ArrayBuffer / 字符串形式存在内存中，本模块不发起任何网络请求，
 *   也不写 localStorage / IndexedDB。
 */
import type { WorkBook } from 'xlsx'

// ---------- 常量与类型 ----------

export const MASK_MAX_MB = 10
export const MASK_ACCEPT = '.xlsx,.xls,.csv'
/** 预览渲染的行数上限：大表只画前 N 行，统计与导出仍覆盖全部行 */
export const PREVIEW_ROW_LIMIT = 50

export type MaskRuleType =
  | 'maskKeepEnds' // ① 掩码：保留前 N 后 M 位
  | 'fixedValue' // ② 固定值替换
  | 'hashPseudo' // ③ 哈希假名化（同值同输出）
  | 'fakeData' // ④ 随机假数据（姓名/手机/邮箱/身份证号）
  | 'numeric' // ⑤ 数值脱敏（区间分桶 / ±k% 扰动）
  | 'dateGeneralize' // ⑥ 日期泛化（年 / 年-月 / 年-月-日）
  | 'regexReplace' // ⑦ 自定义正则替换
  | 'nullify' // ⑧ 置空

export const MASK_RULE_TYPES: MaskRuleType[] = [
  'maskKeepEnds',
  'fixedValue',
  'hashPseudo',
  'fakeData',
  'numeric',
  'dateGeneralize',
  'regexReplace',
  'nullify',
]

export type FakeKind = 'name' | 'phone' | 'email' | 'idcard'
export type NumericMode = 'bucket' | 'jitter'
export type DateGranularity = 'year' | 'month' | 'day'

/** 规则的参数集（type 之外的全部可调参数，表单与规则卡片共用此形状） */
export interface RuleParams {
  keepFirst: number
  keepLast: number
  fillChar: string
  value: string
  salt: string
  fakeKind: FakeKind
  numericMode: NumericMode
  bucketSize: number
  jitterPct: number
  dateTo: DateGranularity
  pattern: string
  flags: string
  replacement: string
}

export interface MaskRule {
  id: number
  type: MaskRuleType
  /** 列索引（0 = 第一列数据）；表头行不受规则影响 */
  columns: number[]
  /** 数据行索引；null = 该列全部行 */
  rows: number[] | null
  params: RuleParams
}

export interface SheetGrid {
  name: string
  headers: string[]
  rows: string[][]
}

export interface ParsedWorkbook {
  fileName: string
  sheets: SheetGrid[]
  /** SheetJS 源工作簿（xlsx/xls 才有；csv 导出用不到）；xlsx 导出在其克隆上原位
   *  替换脱敏单元格，未脱敏区域（含数字格式、其余工作表）保持原样 */
  workbook: WorkBook | null
}

export const DEFAULT_RULE_PARAMS: RuleParams = {
  keepFirst: 3,
  keepLast: 4,
  fillChar: '*',
  value: '',
  salt: '',
  fakeKind: 'name',
  numericMode: 'bucket',
  bucketSize: 100,
  jitterPct: 5,
  dateTo: 'month',
  pattern: '',
  flags: 'g',
  replacement: '***',
}

let ruleSeq = 1

export function createRule(
  type: MaskRuleType,
  columns: number[],
  rows: number[] | null,
  params: RuleParams
): MaskRule {
  const p: RuleParams = { ...params }
  // 归一：填充字符取首字符；数值参数夹取安全范围
  p.fillChar = p.fillChar.slice(0, 1) || '*'
  p.keepFirst = Math.max(0, Math.floor(p.keepFirst) || 0)
  p.keepLast = Math.max(0, Math.floor(p.keepLast) || 0)
  p.bucketSize = Math.max(0.000001, Math.abs(p.bucketSize) || 100)
  p.jitterPct = Math.min(100, Math.max(0, Math.abs(p.jitterPct) || 0))
  p.flags = (p.flags.match(/[gimsuy]/g) ?? []).join('')
  return {
    id: ruleSeq++,
    type,
    columns: [...new Set(columns)].sort((a, b) => a - b),
    rows: rows && rows.length ? [...new Set(rows)].sort((a, b) => a - b) : null,
    params: p,
  }
}

// ---------- 上传预检（本地判定，不发起请求） ----------

/** 返回 'type' | 'size' | null；调用方自行映射本地化文案 */
export function validateMaskFile(file: { name: string; size: number }): 'type' | 'size' | null {
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return 'type'
  if (file.size > MASK_MAX_MB * 1024 * 1024) return 'size'
  return null
}

// ---------- 确定性哈希 / 伪随机 ----------

function fnv1a(str: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 稳定 12 位大写十六进制（两遍不同种子的 FNV-1a 拼合），同输入必同输出 */
function hashHex(str: string): string {
  const a = fnv1a(str, 0x811c9dc5).toString(16).padStart(8, '0')
  const b = fnv1a(str, 0x9dc5811c).toString(16).padStart(8, '0')
  return (a + b).toUpperCase().slice(0, 12)
}

/** mulberry32：以字符串种子复现同一随机序列 */
function seededRandom(key: string): () => number {
  let a = fnv1a(key, 0x12345678)
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- 8 类脱敏算法（纯函数，输入原值 → 输出脱敏值） ----------

function maskKeepEnds(v: string, p: RuleParams): string {
  const fill = p.fillChar || '*'
  if (v.length <= p.keepFirst + p.keepLast) return fill.repeat(v.length)
  const head = v.slice(0, p.keepFirst)
  const tail = p.keepLast > 0 ? v.slice(v.length - p.keepLast) : ''
  return head + fill.repeat(v.length - p.keepFirst - p.keepLast) + tail
}

function hashPseudo(v: string, salt: string): string {
  return hashHex(salt ? `${salt}\u0000${v}` : v)
}

const FAKE_SURNAMES = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '罗', '郑']
const FAKE_GIVEN = ['伟', '芳', '娜', '敏', '静', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '霞', '平', '刚', '辉', '婷']
const FAKE_MAIL_LOCAL = ['user', 'test', 'demo', 'mask', 'anon', 'guest']
const FAKE_MAIL_DOMAIN = ['example.com', 'example.org', 'example.net']
const FAKE_AREA = ['110101', '310104', '440305', '510107', '330102', '420102']
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CODES = '10X98765432'

function fakeValue(kind: FakeKind, seedKey: string): string {
  const rand = seededRandom(seedKey)
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]
  const digits = (n: number): string => {
    let s = ''
    for (let i = 0; i < n; i++) s += Math.floor(rand() * 10)
    return s
  }
  switch (kind) {
    case 'name': {
      const givenLen = rand() < 0.6 ? 2 : 1
      let given = ''
      for (let i = 0; i < givenLen; i++) given += pick(FAKE_GIVEN)
      return pick(FAKE_SURNAMES) + given
    }
    case 'phone':
      return '1' + pick(['3', '5', '7', '8', '9']) + digits(9)
    case 'email':
      return `${pick(FAKE_MAIL_LOCAL)}${digits(4)}@${pick(FAKE_MAIL_DOMAIN)}`
    case 'idcard': {
      // 生成格式合法的 18 位号码（含正确校验位），区域/生日均为虚构组合
      const body = pick(FAKE_AREA) +
        String(1950 + Math.floor(rand() * 55)) +
        String(1 + Math.floor(rand() * 12)).padStart(2, '0') +
        String(1 + Math.floor(rand() * 28)).padStart(2, '0') +
        String(1 + Math.floor(rand() * 999)).padStart(3, '0')
      let sum = 0
      for (let i = 0; i < 17; i++) sum += Number(body[i]) * ID_WEIGHTS[i]
      return body + ID_CODES[sum % 11]
    }
  }
}

/** 剥掉千分位/货币符号/百分号后解析数值；解析失败返回 null（保持原值） */
function parseNumeric(v: string): { n: number; pct: boolean; decimals: number } | null {
  const pct = /%\s*$/.test(v)
  const s = v.replace(/[\s,，￥$€£¥]/g, '').replace(/%$/, '')
  if (!/^-?\d*\.?\d+$/.test(s)) return null
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return null
  const dot = s.indexOf('.')
  return { n, pct, decimals: dot < 0 ? 0 : s.length - dot - 1 }
}

function trimNum(x: number): string {
  return String(Math.round(x * 1e6) / 1e6)
}

function numericMask(v: string, p: RuleParams, seedKey: string): string {
  const parsed = parseNumeric(v)
  if (!parsed) return v
  const { n, pct, decimals } = parsed
  let out: string
  if (p.numericMode === 'jitter') {
    const rand = seededRandom(seedKey)
    const factor = 1 + (rand() * 2 - 1) * (p.jitterPct / 100)
    out = (n * factor).toFixed(decimals)
  } else {
    const lo = Math.floor(n / p.bucketSize) * p.bucketSize
    const hi = lo + p.bucketSize
    out = `${trimNum(lo)}~${trimNum(hi)}`
  }
  return pct ? `${out}%` : out
}

const DATE_RE = /(\d{4})[-/.年]\s*(\d{1,2})(?:[-/.月]\s*(\d{1,2}))?/

function dateGeneralize(v: string, to: DateGranularity): string {
  const m = DATE_RE.exec(v)
  let y: number, mo: number, d: number
  if (m) {
    y = Number(m[1])
    mo = Number(m[2])
    d = m[3] ? Number(m[3]) : 1
  } else {
    const ts = Date.parse(v)
    if (Number.isNaN(ts)) return v
    const dt = new Date(ts)
    y = dt.getFullYear()
    mo = dt.getMonth() + 1
    d = dt.getDate()
  }
  if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > 31) return v
  const pad = (x: number) => String(x).padStart(2, '0')
  if (to === 'year') return String(y)
  if (to === 'month') return `${y}-${pad(mo)}`
  return `${y}-${pad(mo)}-${pad(d)}`
}

export function tryCompileRegex(pattern: string, flags: string): RegExp | null {
  if (!pattern) return null
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

// ---------- 规则应用（数据行级管道，表头行不受影响） ----------

export interface MaskResult {
  rows: string[][]
  changed: number
}

function maskCell(value: string, rule: MaskRule, seedKey: string): string {
  const p = rule.params
  switch (rule.type) {
    case 'maskKeepEnds':
      return maskKeepEnds(value, p)
    case 'fixedValue':
      return p.value
    case 'hashPseudo':
      return hashPseudo(value, p.salt)
    case 'fakeData':
      return fakeValue(p.fakeKind, seedKey)
    case 'numeric':
      return numericMask(value, p, seedKey)
    case 'dateGeneralize':
      return dateGeneralize(value, p.dateTo)
    case 'regexReplace': {
      // 规则创建时已验证；此处兜底防止运行期异常中断整表
      const re = tryCompileRegex(p.pattern, p.flags.includes('g') ? p.flags : p.flags + 'g')
      return re ? value.replace(re, p.replacement) : value
    }
    case 'nullify':
      return ''
  }
}

/** 对数据行应用规则列表（按列表顺序叠加）。返回脱敏后的矩形网格与变更单元格数。 */
export function applyMaskRules(rows: string[][], rules: MaskRule[]): MaskResult {
  if (!rules.length) return { rows, changed: 0 }
  const compiled = rules.map((rule) => ({
    rule,
    cols: new Set(rule.columns),
    rowScope: rule.rows ? new Set(rule.rows) : null,
  }))
  let changed = 0
  const out = rows.map((row, r) =>
    row.map((cell, c) => {
      if (cell === '') return cell
      let v = cell
      for (const { rule, cols, rowScope } of compiled) {
        if (!cols.has(c)) continue
        if (rowScope && !rowScope.has(r)) continue
        v = maskCell(v, rule, `${rule.id}:${c}:${v}`)
        if (v === '') break
      }
      if (v !== cell) changed++
      return v
    })
  )
  return { rows: out, changed }
}

// ---------- 解析（File → 网格；xlsx 动态加载） ----------

export async function parseWorkbookFile(file: File): Promise<ParsedWorkbook> {
  const buf = await file.arrayBuffer()
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const sheets: SheetGrid[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name]
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true,
    })
    const width = aoa.reduce((m, r) => Math.max(m, r.length), 0)
    const grid = aoa.map((r) => {
      const out = r.map((cell) => (cell == null ? '' : String(cell)))
      while (out.length < width) out.push('')
      return out
    })
    const [headerRow, ...dataRows] = grid
    return { name, headers: headerRow ?? [], rows: dataRows }
  })
  return { fileName: file.name, sheets, workbook: wb }
}

// ---------- 导出（浏览器本地生成下载，不经过网络） ----------

/** 手写 CSV 序列化：UTF-8 BOM + CRLF（Excel 打开不乱码），含逗号/引号/换行的字段加引号转义 */
export function toCsv(headers: string[], rows: string[][]): string {
  const esc = (s: string): string => {
    const need = /[",\r\n]/.test(s) || /^ /.test(s) || / $/.test(s)
    return need ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers, ...rows].map((r) => r.map(esc).join(','))
  return '\uFEFF' + lines.join('\r\n')
}

/**
 * xlsx 导出：克隆源工作簿，对每张工作表只把发生变化的单元格原位替换为脱敏
 * 字符串——未脱敏区域（数字格式、未配置规则的工作表）逐格原样；克隆保证
 * 多次导出互不污染。workbook 为空（不应发生，解析总会给出）时退化为整表重建。
 */
export interface MaskedSheetExport {
  name: string
  headers: string[]
  originalRows: string[][]
  maskedRows: string[][]
}

export async function buildMaskedXlsx(
  workbook: WorkBook | null,
  sheets: MaskedSheetExport[]
): Promise<Blob> {
  const XLSX = await import('xlsx')
  const wb: WorkBook = workbook
    ? (typeof structuredClone === 'function'
        ? structuredClone(workbook)
        : (JSON.parse(JSON.stringify(workbook)) as WorkBook))
    : XLSX.utils.book_new()
  for (const sheet of sheets) {
    const maskedGrid = [sheet.headers, ...sheet.maskedRows]
    const origGrid = [sheet.headers, ...sheet.originalRows]
    let ws = wb.Sheets[sheet.name]
    if (!ws) {
      ws = XLSX.utils.aoa_to_sheet(maskedGrid)
      XLSX.utils.book_append_sheet(wb, ws, sheet.name)
      continue
    }
    for (let r = 0; r < maskedGrid.length; r++) {
      for (let c = 0; c < maskedGrid[r].length; c++) {
        if (maskedGrid[r][c] === (origGrid[r]?.[c] ?? '')) continue
        ws[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: maskedGrid[r][c] }
      }
    }
    // 兜底扩 ref（正常同源网格不会超出原范围）
    let range
    try {
      range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    } catch {
      range = { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }
    }
    const width = maskedGrid.reduce((m, r) => Math.max(m, r.length), 0)
    range.e.r = Math.max(range.e.r, maskedGrid.length - 1)
    range.e.c = Math.max(range.e.c, width - 1)
    ws['!ref'] = XLSX.utils.encode_range(range)
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
