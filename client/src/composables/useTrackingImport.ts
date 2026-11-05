/**
 * 数值追踪 Excel/CSV 批量导入：解析、表头侦测、列映射与单元格胁迫（纯函数，
 * UI 状态在 TrackingView）。零新增依赖——复用数据脱敏已引入的 xlsx@^0.18.5，
 * 经动态 import 惰性加载，只进本模块被引用的懒加载分包，不进主包。
 *
 * 解析保留原始类型单元格（number | string | boolean | null）而非字符串化：
 * 数值列拿到真正的 number（不经本地化字符串往返），日期列拿到 Excel 日期序列
 * 数（read 不开 cellDates，由本模块以 1899-12-30 UTC 纪元自行换算——完全确定
 * 性，不受 SheetJS Date 构造的时区语义影响）。服务端为兜底再校验一遍同规则。
 */

// ---------- 常量 ----------

export const IMPORT_MAX_MB = 10
export const IMPORT_ACCEPT = '.xlsx,.xls,.csv'
/** 单次批量请求行数上限（与服务端 BATCH_MAX_ROWS 一致）；超出由客户端分片顺序提交 */
export const IMPORT_CHUNK = 1000
/** 预览表渲染行数上限（校验与导入始终覆盖全部行） */
export const IMPORT_PREVIEW_LIMIT = 30

// ---------- 类型 ----------

export type ImportCell = number | string | boolean | null

export interface ImportSheet {
  name: string
  /** 原始类型单元格行（含表头行，若有） */
  rows: ImportCell[][]
  /** 每行对应的原始工作表行号（1 基，Excel 用户视角） */
  rowNos: number[]
  /** 首行是否判为表头 */
  hasHeader: boolean
  /** 列数（按最大行宽） */
  width: number
}

export interface ParsedImportFile {
  fileName: string
  sheets: ImportSheet[]
}

export interface ImportMapping {
  dateCol: number
  valueCol: number
  /** -1 = 不导入备注 */
  noteCol: number
}

export type ImportRowError = 'tracking.importErrDate' | 'tracking.importErrValue' | 'tracking.importErrNote'

export interface ImportRow {
  rowNo: number
  /** 解析后的 'YYYY-MM-DD HH:mm:ss'；无效行为 null */
  dateStr: string | null
  value: number | null
  note: string
  error: ImportRowError | null
  /** 该时刻已有数据点（仅提示，不阻止——同时刻多读数合法） */
  dup: boolean
}

// ---------- 上传预检（本地判定，不发起请求） ----------

/** 返回 'type' | 'size' | null；调用方自行映射本地化文案 */
export function validateImportFile(file: { name: string; size: number }): 'type' | 'size' | null {
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return 'type'
  if (file.size > IMPORT_MAX_MB * 1024 * 1024) return 'size'
  return null
}

// ---------- 单元格胁迫（与服务端校验规则对齐） ----------

const VALUE_ABS_MAX = 1e11

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Excel 日期序列 → 'YYYY-MM-DD HH:mm:ss'。锚点与换算全程 UTC，取出 UTC 分量即原始数值面值 */
function excelSerialToDate(n: number): string | null {
  // 61 = 1900-03-01（避开 Excel 的 1900 闰年 bug 段）；80000 ≈ 2119 年
  if (!Number.isFinite(n) || n < 61 || n >= 80000) return null
  const d = new Date(Math.round(n * 86400000) + Date.UTC(1899, 11, 30))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

// 字符串日期：2026-01-02 / 2026/1/2 / 2026.1.2 / 2026年1月2日 / …T08:30 / … 8:30[:00]
const STR_DATE_RE = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

/** 日期列单元格 → 'YYYY-MM-DD HH:mm:ss'；解析失败返回 null */
export function coerceDate(cell: ImportCell | undefined): string | null {
  if (typeof cell === 'number') return excelSerialToDate(cell)
  if (typeof cell === 'string') {
    const s = cell.trim()
    if (!s) return null
    const m = STR_DATE_RE.exec(s)
    if (!m) return null
    const [, y, mo, d, h = '0', mi = '0', sec = '0'] = m
    // 与服务端同款 Date 往返校验：拒绝 2 月 30 日这类不存在的日期
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec))
    if (
      dt.getFullYear() !== Number(y) || dt.getMonth() !== Number(mo) - 1 || dt.getDate() !== Number(d) ||
      dt.getHours() !== Number(h) || dt.getMinutes() !== Number(mi) || dt.getSeconds() !== Number(sec)
    ) {
      return null
    }
    return `${y}-${pad(Number(mo))}-${pad(Number(d))} ${pad(Number(h))}:${pad(Number(mi))}:${pad(Number(sec))}`
  }
  return null
}

/** 数值列单元格 → number（4 位小数内舍入，|v| < 1e11）；失败返回 null */
export function coerceValue(cell: ImportCell | undefined): number | null {
  if (typeof cell === 'number') {
    return Number.isFinite(cell) && Math.abs(cell) < VALUE_ABS_MAX ? Math.round(cell * 10000) / 10000 : null
  }
  if (typeof cell === 'string') {
    // 剥空白与千分位（半角/全角逗号）；百分比、货币符等语义不明的写法按无效处理
    const s = cell.trim().replace(/[\s,，]/g, '')
    if (!s) return null
    const v = Number(s)
    return Number.isFinite(v) && Math.abs(v) < VALUE_ABS_MAX ? Math.round(v * 10000) / 10000 : null
  }
  return null
}

function coerceNote(cell: ImportCell | undefined): { note: string; tooLong: boolean } {
  if (cell === null || cell === undefined || cell === '') return { note: '', tooLong: false }
  const note = String(cell).trim()
  return { note, tooLong: note.length > 200 }
}

// ---------- 解析（File → 类型化网格；xlsx 动态加载） ----------

export async function parseImportFile(file: File): Promise<ParsedImportFile> {
  const XLSX = await import('xlsx')
  // CSV 走文本 + raw:true 保持全字符串：SheetJS 的 CSV 解析器会把日期样字符串
  // 猜成数值序列且时间分量带 ~45 秒累积偏差（无时间的日期也被强加时刻），
  // 由本模块按字符串规则解析（确定性且与服务端校验一致）；xlsx/xls 仍读二进制。
  // 不开 cellDates：日期单元格保持数值序列，由 excelSerialToDate 确定性换算。
  const wb = /\.csv$/i.test(file.name)
    ? XLSX.read((await file.text()).replace(/^\uFEFF/, ''), { type: 'string', raw: true })
    : XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const sheets: ImportSheet[] = []
  wb.SheetNames.forEach((name) => {
    const aoa = XLSX.utils.sheet_to_json<ImportCell[]>(wb.Sheets[name], {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    })
    // 过滤全空行但保留原始 1 基行号（预览报错可对回 Excel 行）
    const rows: ImportCell[][] = []
    const rowNos: number[] = []
    aoa.forEach((r, i) => {
      if (r.some((c) => c !== null && c !== '')) {
        rows.push(r)
        rowNos.push(i + 1)
      }
    })
    if (!rows.length) return
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0)
    sheets.push({ name, rows, rowNos, hasHeader: detectHeaderRow(rows), width })
  })
  return { fileName: file.name, sheets }
}

// 首行所有非空格既解析不出日期也解析不出数值（纯文本）且还有后续行 → 判为表头
function detectHeaderRow(rows: ImportCell[][]): boolean {
  if (rows.length < 2) return false
  const first = rows[0]
  return first.every((c) => c === null || c === '' || (coerceDate(c) === null && coerceValue(c) === null))
}

// ---------- 列映射侦测 ----------

const DATE_KEYS = ['日期', '时间', '日期时间', '记录时间', '记录日期', '记录时刻', 'date', 'time', 'datetime', 'day', 'timestamp']
const VALUE_KEYS = ['数值', '值', '记录值', '测量值', '读数', 'value', 'num', 'number', 'amount']
const NOTE_KEYS = ['备注', '说明', '注释', 'note', 'notes', 'remark', 'remarks', 'comment', 'memo']

function normHeader(c: ImportCell): string {
  return typeof c === 'string' ? c.trim().toLowerCase().replace(/\s+/g, '') : ''
}

/** 表头关键词匹配：先整词，再子串（子串仅用长度 ≥ 2 的词，避免单字误命中） */
function findKeyCol(headers: string[], keys: string[]): number {
  let idx = headers.findIndex((h) => h !== '' && keys.includes(h))
  if (idx >= 0) return idx
  const subs = keys.filter((k) => k.length >= 2)
  idx = headers.findIndex((h) => h !== '' && subs.some((k) => h.includes(k)))
  return idx
}

/**
 * 数据嗅探：前 sample 行的非空格里多数（≥60%）通过测试的首个列。
 * 用多数而非全量——现实表格常夹个别坏行，全量要求会让整列误判（如纯数字列
 * 被当成日期列接手，Excel 序列换算出 1900 年的假日期）。
 */
function sniffCol(rows: ImportCell[][], test: (c: ImportCell) => boolean, skip: number[], sample = 10): number {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0)
  for (let c = 0; c < width; c++) {
    if (skip.includes(c)) continue
    const cells = rows.slice(0, sample).map((r) => r[c] ?? null).filter((x) => x !== null && x !== '')
    if (cells.length && cells.filter(test).length >= Math.max(1, Math.ceil(cells.length * 0.6))) return c
  }
  return -1
}

/** 自动侦测日期/数值/备注列；备注列仅认关键词（位置猜测风险高），否则不导入 */
export function detectMapping(sheet: ImportSheet): ImportMapping {
  const dataRows = sheet.hasHeader ? sheet.rows.slice(1) : sheet.rows
  const headers = sheet.hasHeader ? sheet.rows[0].map(normHeader) : []

  let dateCol = sheet.hasHeader ? findKeyCol(headers, DATE_KEYS) : -1
  if (dateCol < 0) dateCol = sniffCol(dataRows, (c) => coerceDate(c) !== null, [])
  if (dateCol < 0) dateCol = 0

  let valueCol = sheet.hasHeader ? findKeyCol(headers, VALUE_KEYS) : -1
  if (valueCol === dateCol) valueCol = -1
  if (valueCol < 0) valueCol = sniffCol(dataRows, (c) => coerceValue(c) !== null, [dateCol])
  if (valueCol < 0 || valueCol === dateCol) valueCol = dateCol === 0 ? 1 : 0

  let noteCol = sheet.hasHeader ? findKeyCol(headers, NOTE_KEYS) : -1
  if (noteCol === dateCol || noteCol === valueCol || noteCol >= sheet.width) noteCol = -1
  return { dateCol, valueCol, noteCol }
}

// ---------- 行映射（网格 + 映射 → 逐行校验结果） ----------

export function mapSheet(sheet: ImportSheet, mapping: ImportMapping, existingTimes?: Set<string>): ImportRow[] {
  const dataRows = sheet.hasHeader ? sheet.rows.slice(1) : sheet.rows
  const dataNos = sheet.hasHeader ? sheet.rowNos.slice(1) : sheet.rowNos
  const out: ImportRow[] = []
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i]
    const dateStr = coerceDate(r[mapping.dateCol])
    const value = coerceValue(r[mapping.valueCol])
    const { note, tooLong } = mapping.noteCol >= 0 ? coerceNote(r[mapping.noteCol]) : { note: '', tooLong: false }
    let error: ImportRowError | null = null
    if (dateStr === null) error = 'tracking.importErrDate'
    if (value === null) error = error ?? 'tracking.importErrValue'
    if (tooLong) error = error ?? 'tracking.importErrNote'
    out.push({
      rowNo: dataNos[i],
      dateStr,
      value,
      note,
      error,
      dup: dateStr !== null && !!existingTimes?.has(dateStr),
    })
  }
  return out
}

// ---------- 列标签（映射下拉展示） ----------

/** 0 → A、25 → Z、26 → AA（Excel 列标） */
export function colLetter(i: number): string {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** 'A · 日期'：列标恒有，有表头时附表头文本（截断防下拉爆宽） */
export function colLabel(sheet: ImportSheet, i: number): string {
  const head = sheet.hasHeader ? String(sheet.rows[0][i] ?? '').trim() : ''
  const h = head.length > 12 ? head.slice(0, 12) + '…' : head
  return h ? `${colLetter(i)} · ${h}` : colLetter(i)
}

// ---------- 模板下载 ----------

/** 导入模板 CSV：本地 Blob 下载（UTF-8 BOM + CRLF，Excel 打开不乱码） */
export function buildImportTemplateCsv(): void {
  const lines = [
    ['日期', '数值', '备注'],
    ['2026-01-01 08:30', '72.5', '晨起空腹'],
    ['2026-01-02 08:35', '72.8', ''],
    ['2026-01-03', '73.1', '只写日期按 0 点'],
    ['2026年1月4日 21:05', '73.4', '中文日期也认'],
  ]
  const esc = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const csv = '\uFEFF' + lines.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n'
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'tracking-import-template.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
