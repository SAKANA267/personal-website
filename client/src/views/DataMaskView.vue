<script setup lang="ts">
import { computed, markRaw, reactive, ref } from 'vue'
import { useLocale } from '../stores/locale'
import {
  MASK_ACCEPT,
  MASK_MAX_MB,
  MASK_RULE_TYPES,
  PREVIEW_ROW_LIMIT,
  applyMaskRules,
  buildMaskedXlsx,
  createRule,
  parseWorkbookFile,
  toCsv,
  tryCompileRegex,
  validateMaskFile,
  type DateGranularity,
  type FakeKind,
  type MaskRule,
  type MaskRuleType,
  type NumericMode,
  type ParsedWorkbook,
  type SheetGrid,
} from '../composables/useDataMask'

const { t } = useLocale()

// ---------- 状态 ----------

const fileInput = ref<HTMLInputElement | null>(null)
const parsed = ref<ParsedWorkbook | null>(null)
const fileSize = ref(0)
const parsing = ref(false)
const uploadError = ref<'' | 'type' | 'size' | 'parse' | 'empty'>('')
const dragOn = ref(false)
const activeSheet = ref(0)
// 规则按工作表分别保存（切换工作表不丢配置；列索引按各表自己的表头）
const rulesBySheet = ref<Record<number, MaskRule[]>>({})
const selectedCols = ref<number[]>([])
const selectedRows = ref<number[]>([])
const showOriginal = ref(false)
const exportError = ref(false)

const form = reactive({
  type: 'maskKeepEnds' as MaskRuleType,
  keepFirst: 3,
  keepLast: 4,
  fillChar: '*',
  value: '',
  salt: '',
  fakeKind: 'name' as FakeKind,
  numericMode: 'bucket' as NumericMode,
  bucketSize: 100,
  jitterPct: 5,
  dateTo: 'month' as DateGranularity,
  pattern: '',
  flags: 'g',
  replacement: '***',
})

// ---------- 派生 ----------

const sheet = computed<SheetGrid | null>(() => parsed.value?.sheets[activeSheet.value] ?? null)
const rules = computed<MaskRule[]>(() => rulesBySheet.value[activeSheet.value] ?? [])
const masked = computed(() =>
  sheet.value ? applyMaskRules(sheet.value.rows, rules.value) : { rows: [], changed: 0 }
)
const previewRows = computed(() => masked.value.rows.slice(0, PREVIEW_ROW_LIMIT))
const hasAnyRules = computed(() => Object.values(rulesBySheet.value).some((list) => list.length))

const uploadErrorText = computed(() => {
  switch (uploadError.value) {
    case 'type':
      return t('dataMask.errType')
    case 'size':
      return t('dataMask.errSize', { max: MASK_MAX_MB })
    case 'parse':
      return t('dataMask.errParse')
    case 'empty':
      return t('dataMask.errEmpty')
    default:
      return ''
  }
})

const fileSizeText = computed(() =>
  fileSize.value >= 1024 * 1024
    ? `${(fileSize.value / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(fileSize.value / 1024))} KB`
)

const typeLabels = computed<Record<MaskRuleType, string>>(() => ({
  maskKeepEnds: t('dataMask.typeMask'),
  fixedValue: t('dataMask.typeFixed'),
  hashPseudo: t('dataMask.typeHash'),
  fakeData: t('dataMask.typeFake'),
  numeric: t('dataMask.typeNumeric'),
  dateGeneralize: t('dataMask.typeDate'),
  regexReplace: t('dataMask.typeRegex'),
  nullify: t('dataMask.typeNullify'),
}))

const fakeKindLabels = computed<Record<FakeKind, string>>(() => ({
  name: t('dataMask.fakeName'),
  phone: t('dataMask.fakePhone'),
  email: t('dataMask.fakeEmail'),
  idcard: t('dataMask.fakeIdcard'),
}))

const dateToLabels = computed<Record<DateGranularity, string>>(() => ({
  year: t('dataMask.toYear'),
  month: t('dataMask.toMonth'),
  day: t('dataMask.toDay'),
}))

const regexValid = computed(() => {
  if (form.type !== 'regexReplace') return true
  return tryCompileRegex(form.pattern, form.flags) !== null
})

const applyDisabled = computed(() => !sheet.value || selectedCols.value.length === 0 || !regexValid.value)

const targetLine = computed(() => {
  const rowsPart = selectedRows.value.length
    ? t('dataMask.targetSomeRows', { n: selectedRows.value.length })
    : t('dataMask.targetAllRows')
  return t('dataMask.targetLabel', { cols: selectedCols.value.length, rows: rowsPart })
})

function colLabel(c: number): string {
  const h = sheet.value?.headers[c]?.trim()
  return h || `#${c + 1}`
}

function cellChanged(ri: number, c: number, cell: string): boolean {
  return cell !== (sheet.value?.rows[ri]?.[c] ?? '')
}

function ruleSummary(r: MaskRule): string {
  const p = r.params
  switch (r.type) {
    case 'maskKeepEnds':
      return t('dataMask.sumMask', { a: p.keepFirst, b: p.keepLast, f: p.fillChar })
    case 'fixedValue':
      return t('dataMask.sumFixed', { v: p.value })
    case 'hashPseudo':
      return p.salt ? t('dataMask.sumHashSalt', { salt: p.salt }) : t('dataMask.sumHash')
    case 'fakeData':
      return fakeKindLabels.value[p.fakeKind]
    case 'numeric':
      return p.numericMode === 'bucket'
        ? t('dataMask.sumBucket', { w: p.bucketSize })
        : t('dataMask.sumJitter', { p: p.jitterPct })
    case 'dateGeneralize':
      return t('dataMask.sumDate', { to: dateToLabels.value[p.dateTo] })
    case 'regexReplace':
      return t('dataMask.sumRegex', { p: p.pattern, r: p.replacement })
    case 'nullify':
      return t('dataMask.sumNull')
  }
}

function ruleTarget(r: MaskRule): string {
  const names = r.columns.map(colLabel)
  const colsText = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')}…`
  const rowsText = r.rows ? t('dataMask.targetSomeRows', { n: r.rows.length }) : t('dataMask.targetAllRows')
  return `${colsText} · ${rowsText}`
}

// ---------- 上传（本地预检 → 内存解析，零网络请求） ----------

function pickFile() {
  fileInput.value?.click()
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (f) void handleFile(f)
}

function onDrop(e: DragEvent) {
  const f = e.dataTransfer?.files?.[0]
  if (f) void handleFile(f)
}

async function handleFile(f: File) {
  const pre = validateMaskFile(f)
  if (pre) {
    uploadError.value = pre
    return
  }
  uploadError.value = ''
  parsing.value = true
  try {
    const wb = await parseWorkbookFile(f)
    const hasData = wb.sheets.some((s) => s.rows.length > 0 || s.headers.some((h) => h !== ''))
    if (!wb.sheets.length || !hasData) {
      uploadError.value = 'empty'
      return
    }
    // markRaw：SheetJS 工作簿是纯数据快照（导出时才读），不参与响应式——
    // 深层 Proxy 会让 structuredClone 抛 DataCloneError，且代理大对象浪费性能
    parsed.value = { ...wb, workbook: wb.workbook ? markRaw(wb.workbook) : null }
    fileSize.value = f.size
    activeSheet.value = 0
    rulesBySheet.value = {}
    resetSelection()
  } catch (err) {
    console.error('Failed to parse workbook:', err)
    uploadError.value = 'parse'
  } finally {
    parsing.value = false
  }
}

function changeFile() {
  if (hasAnyRules.value && !window.confirm(t('dataMask.changeConfirm'))) return
  parsed.value = null
  uploadError.value = ''
  rulesBySheet.value = {}
  resetSelection()
}

// ---------- 选择（列 = 表头点选；行 = 行首勾选，用于限定新规则范围） ----------

function resetSelection() {
  selectedCols.value = []
  selectedRows.value = []
}

function toggleCol(c: number) {
  const i = selectedCols.value.indexOf(c)
  if (i >= 0) selectedCols.value.splice(i, 1)
  else selectedCols.value.push(c)
}

function toggleRow(r: number) {
  const i = selectedRows.value.indexOf(r)
  if (i >= 0) selectedRows.value.splice(i, 1)
  else selectedRows.value.push(r)
}

function switchSheet(i: number) {
  activeSheet.value = i
  resetSelection()
}

// ---------- 规则管理 ----------

function applyRule() {
  if (applyDisabled.value) return
  const cols = [...selectedCols.value]
  const rows = selectedRows.value.length ? [...selectedRows.value] : null
  const rule = createRule(form.type, cols, rows, { ...form })
  const list = rulesBySheet.value[activeSheet.value] ?? []
  rulesBySheet.value[activeSheet.value] = [...list, rule]
}

function removeRule(id: number) {
  rulesBySheet.value[activeSheet.value] = rules.value.filter((r) => r.id !== id)
}

function resetRules() {
  if (!rules.value.length) return
  if (!window.confirm(t('dataMask.resetConfirm'))) return
  rulesBySheet.value[activeSheet.value] = []
}

// ---------- 导出（本地 Blob 下载，未脱敏区域原样） ----------

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

async function exportFile(kind: 'xlsx' | 'csv') {
  const s = sheet.value
  if (!s || !parsed.value) return
  exportError.value = false
  try {
    const blob =
      kind === 'csv'
        ? new Blob([toCsv(s.headers, masked.value.rows)], { type: 'text/csv;charset=utf-8' })
        : await buildMaskedXlsx(
            parsed.value.workbook,
            // 全部工作表逐表应用各自规则（未配规则的表 maskedRows 即原样）
            parsed.value.sheets.map((sh, i) => {
              const m = applyMaskRules(sh.rows, rulesBySheet.value[i] ?? [])
              return { name: sh.name, headers: sh.headers, originalRows: sh.rows, maskedRows: m.rows }
            })
          )
    const base = (parsed.value?.fileName ?? 'data').replace(/\.[^.]+$/, '') || 'data'
    downloadBlob(blob, `${base}_masked.${kind}`)
  } catch (err) {
    console.error('Export failed:', err)
    exportError.value = true
  }
}
</script>

<template>
  <div class="page-data-mask">
    <div class="mask-container">
      <header class="mask-header">
        <h1>{{ t('dataMask.title') }}</h1>
        <p class="mask-desc">{{ t('dataMask.desc') }}</p>
        <p class="mask-privacy">{{ t('dataMask.privacy') }}</p>
      </header>

      <!-- 上传区：本地预检 + 内存解析，文件不出浏览器 -->
      <section v-if="!parsed" class="mask-upload">
        <div
          class="mask-drop"
          :class="{ 'is-drag': dragOn, 'is-busy': parsing }"
          role="button"
          tabindex="0"
          :aria-label="t('dataMask.pick')"
          @click="pickFile"
          @keydown.enter.prevent="pickFile"
          @dragover.prevent="dragOn = true"
          @dragleave="dragOn = false"
          @drop.prevent="dragOn = false; onDrop($event)"
        >
          <p class="mask-drop-title">{{ parsing ? t('dataMask.parsing') : t('dataMask.pick') }}</p>
          <p class="mask-drop-hint">{{ t('dataMask.pickHint', { max: MASK_MAX_MB }) }}</p>
        </div>
        <p v-if="uploadError" class="mask-error" role="alert">{{ uploadErrorText }}</p>
        <input
          ref="fileInput"
          type="file"
          :accept="MASK_ACCEPT"
          class="mask-file-input"
          @change="onFileChange"
        />
      </section>

      <!-- 工作区 -->
      <template v-else>
        <div v-if="sheet" class="mask-filebar">
          <span class="mask-file-name" :title="parsed.fileName">{{ parsed.fileName }}</span>
          <span class="mask-file-meta">{{ fileSizeText }}</span>
          <label v-if="parsed.sheets.length > 1" class="mask-sheet-pick">
            {{ t('dataMask.sheetLabel') }}
            <select
              class="mask-input"
              :value="activeSheet"
              @change="switchSheet(Number(($event.target as HTMLSelectElement).value))"
            >
              <option v-for="(s, i) in parsed.sheets" :key="s.name" :value="i">{{ s.name }}</option>
            </select>
          </label>
          <span class="mask-file-meta">
            {{ t('dataMask.dims', { rows: sheet.rows.length, cols: sheet.headers.length }) }}
          </span>
          <span class="mask-file-meta mask-stat">
            {{ t('dataMask.maskedCells', { n: masked.changed.toLocaleString() }) }}
          </span>
          <button type="button" class="mask-mini-btn" @click="changeFile">
            {{ t('dataMask.changeFile') }}
          </button>
        </div>
        <p v-if="parsed.sheets.length > 1" class="mask-note">{{ t('dataMask.sheetNote') }}</p>

        <div v-if="sheet" class="mask-workspace">
          <!-- 预览：宽表在容器内滚动，绝不撑开页面 -->
          <section class="mask-panel">
            <div class="mask-panel-head">
              <h2>{{ t('dataMask.previewTitle') }}</h2>
              <label class="mask-compare">
                <input v-model="showOriginal" type="checkbox" />
                {{ t('dataMask.compare') }}
              </label>
            </div>
            <p class="mask-note">{{ t('dataMask.selectHint') }}</p>
            <div v-if="selectedCols.length || selectedRows.length" class="mask-selbar">
              <span>{{ t('dataMask.selCols', { n: selectedCols.length }) }}</span>
              <span v-if="selectedRows.length">{{ t('dataMask.selRows', { n: selectedRows.length }) }}</span>
              <button type="button" class="mask-mini-btn" @click="resetSelection">
                {{ t('dataMask.clearSel') }}
              </button>
            </div>

            <p v-if="!sheet.rows.length" class="mask-note">{{ t('dataMask.sheetEmpty') }}</p>
            <div v-else class="mask-table-scroll">
              <table class="mask-table">
                <colgroup>
                  <col class="mask-col-gutter" />
                  <col
                    v-for="(_h, c) in sheet.headers"
                    :key="c"
                    :class="{ 'is-col-on': selectedCols.includes(c) }"
                  />
                </colgroup>
                <thead>
                  <tr>
                    <th class="mask-th mask-th-gutter" scope="col">#</th>
                    <th
                      v-for="(_h, c) in sheet.headers"
                      :key="c"
                      class="mask-th"
                      :class="{ 'is-col-on': selectedCols.includes(c) }"
                      scope="col"
                      role="button"
                      tabindex="0"
                      :aria-pressed="selectedCols.includes(c)"
                      :title="t('dataMask.toggleCol')"
                      @click="toggleCol(c)"
                      @keydown.enter.prevent="toggleCol(c)"
                      @keydown.space.prevent="toggleCol(c)"
                    >
                      <span class="mask-th-label">{{ colLabel(c) }}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, ri) in previewRows" :key="ri" :class="{ 'is-row-on': selectedRows.includes(ri) }">
                    <td class="mask-td mask-td-gutter">
                      <input
                        type="checkbox"
                        class="mask-row-check"
                        :checked="selectedRows.includes(ri)"
                        :aria-label="t('dataMask.toggleRow', { n: ri + 1 })"
                        @change="toggleRow(ri)"
                      />
                    </td>
                    <td
                      v-for="(cell, c) in row"
                      :key="c"
                      class="mask-td"
                      :class="{ 'is-changed': cellChanged(ri, c, cell) }"
                    >
                      <span
                        v-if="showOriginal && cellChanged(ri, c, cell)"
                        class="mask-orig"
                        :title="sheet.rows[ri]?.[c] ?? ''"
                        >{{ sheet.rows[ri]?.[c] ?? '' }}</span
                      >
                      <span class="mask-val" :title="cell">{{ cell }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="sheet.rows.length > PREVIEW_ROW_LIMIT" class="mask-note">
              {{ t('dataMask.previewNote', { shown: PREVIEW_ROW_LIMIT, total: sheet.rows.length.toLocaleString() }) }}
            </p>
          </section>

          <!-- 规则配置 + 导出 -->
          <aside class="mask-side">
            <section class="mask-panel mask-rule-panel">
              <h2>{{ t('dataMask.rulesTitle') }}</h2>
              <form class="mask-rule-form" @submit.prevent="applyRule">
                <label class="mask-field">
                  <span class="mask-field-label">{{ t('dataMask.ruleType') }}</span>
                  <select
                    class="mask-input"
                    :value="form.type"
                    @change="form.type = ($event.target as HTMLSelectElement).value as MaskRuleType"
                  >
                    <option v-for="ty in MASK_RULE_TYPES" :key="ty" :value="ty">
                      {{ typeLabels[ty] }}
                    </option>
                  </select>
                </label>

                <template v-if="form.type === 'maskKeepEnds'">
                  <div class="mask-field-row">
                    <label class="mask-field">
                      <span class="mask-field-label">{{ t('dataMask.paramKeepFirst') }}</span>
                      <input v-model.number="form.keepFirst" type="number" min="0" max="64" class="mask-input" />
                    </label>
                    <label class="mask-field">
                      <span class="mask-field-label">{{ t('dataMask.paramKeepLast') }}</span>
                      <input v-model.number="form.keepLast" type="number" min="0" max="64" class="mask-input" />
                    </label>
                  </div>
                  <label class="mask-field">
                    <span class="mask-field-label">{{ t('dataMask.paramFill') }}</span>
                    <input v-model="form.fillChar" type="text" maxlength="2" class="mask-input mask-input--fill" />
                  </label>
                </template>

                <label v-else-if="form.type === 'fixedValue'" class="mask-field">
                  <span class="mask-field-label">{{ t('dataMask.paramValue') }}</span>
                  <input v-model="form.value" type="text" maxlength="100" class="mask-input" />
                </label>

                <label v-else-if="form.type === 'hashPseudo'" class="mask-field">
                  <span class="mask-field-label">{{ t('dataMask.paramSalt') }}</span>
                  <input v-model="form.salt" type="text" maxlength="40" class="mask-input" />
                </label>

                <label v-else-if="form.type === 'fakeData'" class="mask-field">
                  <span class="mask-field-label">{{ t('dataMask.paramFakeKind') }}</span>
                  <select
                    class="mask-input"
                    :value="form.fakeKind"
                    @change="form.fakeKind = ($event.target as HTMLSelectElement).value as FakeKind"
                  >
                    <option value="name">{{ fakeKindLabels.name }}</option>
                    <option value="phone">{{ fakeKindLabels.phone }}</option>
                    <option value="email">{{ fakeKindLabels.email }}</option>
                    <option value="idcard">{{ fakeKindLabels.idcard }}</option>
                  </select>
                </label>

                <template v-else-if="form.type === 'numeric'">
                  <label class="mask-field">
                    <span class="mask-field-label">{{ t('dataMask.paramNumericMode') }}</span>
                    <select
                      class="mask-input"
                      :value="form.numericMode"
                      @change="form.numericMode = ($event.target as HTMLSelectElement).value as NumericMode"
                    >
                      <option value="bucket">{{ t('dataMask.modeBucket') }}</option>
                      <option value="jitter">{{ t('dataMask.modeJitter') }}</option>
                    </select>
                  </label>
                  <label v-if="form.numericMode === 'bucket'" class="mask-field">
                    <span class="mask-field-label">{{ t('dataMask.paramBucket') }}</span>
                    <input v-model.number="form.bucketSize" type="number" min="0" step="any" class="mask-input" />
                  </label>
                  <label v-else class="mask-field">
                    <span class="mask-field-label">{{ t('dataMask.paramJitter') }}</span>
                    <input v-model.number="form.jitterPct" type="number" min="0" max="100" class="mask-input" />
                  </label>
                </template>

                <label v-else-if="form.type === 'dateGeneralize'" class="mask-field">
                  <span class="mask-field-label">{{ t('dataMask.paramDateTo') }}</span>
                  <select
                    class="mask-input"
                    :value="form.dateTo"
                    @change="form.dateTo = ($event.target as HTMLSelectElement).value as DateGranularity"
                  >
                    <option value="year">{{ dateToLabels.year }}</option>
                    <option value="month">{{ dateToLabels.month }}</option>
                    <option value="day">{{ dateToLabels.day }}</option>
                  </select>
                </label>

                <template v-else-if="form.type === 'regexReplace'">
                  <label class="mask-field">
                    <span class="mask-field-label">{{ t('dataMask.paramPattern') }}</span>
                    <input v-model="form.pattern" type="text" class="mask-input mask-input--mono" placeholder="(\d{4})-(\d{2})" />
                  </label>
                  <div class="mask-field-row">
                    <label class="mask-field">
                      <span class="mask-field-label">{{ t('dataMask.paramFlags') }}</span>
                      <input v-model="form.flags" type="text" maxlength="5" class="mask-input mask-input--mono" />
                    </label>
                    <label class="mask-field">
                      <span class="mask-field-label">{{ t('dataMask.paramReplacement') }}</span>
                      <input v-model="form.replacement" type="text" maxlength="100" class="mask-input mask-input--mono" />
                    </label>
                  </div>
                  <p v-if="!regexValid" class="mask-error" role="alert">{{ t('dataMask.badRegex') }}</p>
                </template>

                <p class="mask-target">{{ targetLine }}</p>
                <p v-if="!selectedCols.length" class="mask-hint-warn">{{ t('dataMask.noCols') }}</p>
                <button type="submit" class="btn mask-apply" :disabled="applyDisabled">
                  {{ t('dataMask.apply') }}
                </button>
              </form>

              <div class="mask-rules-head">
                <h3>{{ t('dataMask.appliedTitle', { n: rules.length }) }}</h3>
                <button v-if="rules.length" type="button" class="mask-mini-btn" @click="resetRules">
                  {{ t('dataMask.reset') }}
                </button>
              </div>
              <p v-if="!rules.length" class="mask-note">{{ t('dataMask.noRules') }}</p>
              <ul v-else class="mask-rules-list">
                <li v-for="r in rules" :key="r.id" class="mask-rule-item">
                  <div class="mask-rule-main">
                    <span class="mask-rule-type">{{ typeLabels[r.type] }}</span>
                    <span class="mask-rule-params">{{ ruleSummary(r) }}</span>
                  </div>
                  <div class="mask-rule-target" :title="r.columns.map(colLabel).join(', ')">
                    {{ ruleTarget(r) }}
                  </div>
                  <button
                    type="button"
                    class="mask-rule-remove"
                    :aria-label="t('dataMask.removeRule')"
                    :title="t('dataMask.removeRule')"
                    @click="removeRule(r.id)"
                  >
                    ×
                  </button>
                </li>
              </ul>
              <p class="mask-note">{{ t('dataMask.emptyNote') }}</p>
            </section>

            <section class="mask-panel mask-export-panel">
              <h2>{{ t('dataMask.exportTitle') }}</h2>
              <div class="mask-export-actions">
                <button type="button" class="btn" :disabled="!sheet" @click="exportFile('xlsx')">
                  {{ t('dataMask.exportXlsx') }}
                </button>
                <button type="button" class="btn" :disabled="!sheet" @click="exportFile('csv')">
                  {{ t('dataMask.exportCsv') }}
                </button>
              </div>
              <p class="mask-note">{{ t('dataMask.exportHint') }}</p>
              <p v-if="exportError" class="mask-error" role="alert">{{ t('dataMask.exportFail') }}</p>
            </section>
          </aside>
        </div>
      </template>
    </div>
  </div>
</template>
