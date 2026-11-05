<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useLocale } from '../stores/locale'
import { useAuth } from '../stores/auth'
import { useTheme } from '../stores/theme'
import {
  useTracking, fmtValue, OKABE_ITO, TRACKING_POINT_CAP,
} from '../composables/useTracking'
import {
  IMPORT_ACCEPT, IMPORT_MAX_MB, IMPORT_PREVIEW_LIMIT,
  buildImportTemplateCsv, colLabel, detectMapping, mapSheet, parseImportFile, validateImportFile,
} from '../composables/useTrackingImport'
import type { ImportMapping, ParsedImportFile } from '../composables/useTrackingImport'
import InkLineChart from '../components/tracking/InkLineChart.vue'
import ScienceLineChart from '../components/tracking/ScienceLineChart.vue'

/**
 * 数值追踪页（/tracking）：左侧项目管理 + 数据点录入，右侧统计摘要卡、
 * 双风格图表（墨线 lieflat / 科研期刊风，随 config.style 切换）与客制化面板。
 * 登录用户数据存服务端；游客可载入确定性演示数据体验（数据管理只读）。
 */

const { t, apiError } = useLocale()
const router = useRouter()
const { username } = useAuth()
const { isDark } = useTheme()

const {
  projects, pointsMap, loaded, loading, loadError, demoMode,
  selectedProjectId, config, frame,
  loadAll, enterDemo, exitDemo,
  createProject, updateProject, deleteProject,
  addPoint, updatePoint, deletePoint,
  importPoints,
  exportFrameCsv, exportSvgPng,
} = useTracking()

// ---------- 初始化 ----------

if (username.value) void loadAll()
watch(username, (u) => {
  if (u) {
    exitDemo()
    void loadAll()
  }
})

// ---------- 派生 ----------

const visibleProjects = computed(() => projects.value.filter((p) => config.visible[String(p.id)] !== false))
const selectedProject = computed(() => projects.value.find((p) => p.id === selectedProjectId.value) || null)
const selectedPoints = computed(() => {
  const id = selectedProjectId.value
  if (id === null) return []
  return [...(pointsMap.value[id] || [])].reverse() // 新的在前
})

// 图表空态分流：无项目 / 无勾选 / 范围内无点
const chartEmptyKey = computed<'tracking.chartEmptyNoProject' | 'tracking.chartEmptyNoVisible' | 'tracking.chartEmptyNoPoint' | null>(() => {
  if (frame.value.series.length) return null
  if (!projects.value.length) return 'tracking.chartEmptyNoProject'
  if (!visibleProjects.value.length) return 'tracking.chartEmptyNoVisible'
  return 'tracking.chartEmptyNoPoint'
})

// 自动结论式标题（用户留空时）：单系列带方向与幅度，多系列报数量
const autoTitle = computed(() => {
  const fs = frame.value.series
  if (!fs.length) return ''
  if (fs.length === 1) {
    const s = fs[0]
    const d = s.stats.delta
    if (d === null || d === 0) return s.name
    const arrow = d > 0 ? '↑' : '↓'
    const pct = s.stats.deltaPct !== null ? `（${(s.stats.deltaPct * 100).toFixed(1)}%）` : ''
    return `${s.name} ${arrow} ${fmtValue(Math.abs(d))}${s.unit ? ' ' + s.unit : ''}${pct}`
  }
  return t('tracking.autoMulti', { n: fs.length })
})
const chartTitle = computed(() => config.title.trim() || autoTitle.value)
const sourceLabel = computed(() => t(demoMode.value ? 'tracking.srcDemo' : 'tracking.srcMine'))

const workbenchOn = computed(() => !!username.value || demoMode.value)

// ---------- 项目表单 ----------

const COLOR_PRESETS = [...OKABE_ITO]

const projForm = reactive({
  open: false,
  editId: null as number | null,
  name: '',
  unit: '',
  description: '',
  color: '', // '' = 自动（科研风格按序取色）
})
const projBusy = ref(false)
const projError = ref('')

function openCreate() {
  projForm.open = true
  projForm.editId = null
  projForm.name = ''
  projForm.unit = ''
  projForm.description = ''
  projForm.color = ''
  projError.value = ''
}
function openEdit(id: number) {
  const p = projects.value.find((x) => x.id === id)
  if (!p) return
  projForm.open = true
  projForm.editId = id
  projForm.name = p.name
  projForm.unit = p.unit
  projForm.description = p.description
  projForm.color = p.color || ''
  projError.value = ''
  selectedProjectId.value = id
}
function closeProjForm() {
  projForm.open = false
}

async function submitProject() {
  if (projBusy.value) return
  projBusy.value = true
  projError.value = ''
  const data = {
    name: projForm.name.trim(),
    unit: projForm.unit.trim(),
    description: projForm.description.trim(),
    color: projForm.color || null,
  }
  const r = projForm.editId === null
    ? await createProject(data)
    : await updateProject(projForm.editId, data)
  projBusy.value = false
  if (!r.ok) {
    projError.value = r.error === 'NETWORK' ? t('tracking.errNetwork') : apiError({ error: r.error }, 'api.SERVER_ERROR')
    return
  }
  projForm.open = false
}

async function removeProject(id: number) {
  const p = projects.value.find((x) => x.id === id)
  if (!p) return
  if (!window.confirm(t('tracking.delProjectConfirm', { name: p.name, n: p.pointCount }))) return
  const r = await deleteProject(id)
  if (!r.ok) window.alert(r.error === 'NETWORK' ? t('tracking.errNetwork') : apiError({ error: r.error }, 'api.SERVER_ERROR'))
}

// ---------- 数据点录入 / 编辑 ----------

function localNowForInput(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const pointForm = reactive({ recordedAt: localNowForInput(), value: '', note: '' })
const pointBusy = ref(false)
const pointError = ref('')

async function submitPoint() {
  const pid = selectedProjectId.value
  if (pid === null || pointBusy.value) return
  // v-model 对 number 输入自动转 number：空输入可能是 ''（未输入）或 null
  const v = Number(pointForm.value)
  if (pointForm.value === '' || pointForm.value === null || !Number.isFinite(v)) {
    pointError.value = t('tracking.pointValueInvalid')
    return
  }
  pointBusy.value = true
  pointError.value = ''
  const r = await addPoint(pid, {
    value: v,
    recordedAt: pointForm.recordedAt ? pointForm.recordedAt.replace('T', ' ') : undefined,
    note: pointForm.note.trim(),
  })
  pointBusy.value = false
  if (!r.ok) {
    pointError.value = r.error === 'NETWORK' ? t('tracking.errNetwork') : apiError({ error: r.error }, 'api.SERVER_ERROR')
    return
  }
  pointForm.value = ''
  pointForm.note = ''
  pointForm.recordedAt = localNowForInput()
}

// 行内编辑
const editing = reactive({ id: null as number | null, recordedAt: '', value: '', note: '' })
function startEdit(pid: number) {
  const pt = (pointsMap.value[selectedProjectId.value!] || []).find((x) => x.id === pid)
  if (!pt) return
  editing.id = pid
  // datetime-local 需要 'YYYY-MM-DDTHH:mm'（截掉秒）
  editing.recordedAt = pt.recordedAt.slice(0, 16)
  editing.value = String(pt.value)
  editing.note = pt.note
}
async function saveEdit() {
  if (editing.id === null || selectedProjectId.value === null) return
  const v = Number(editing.value)
  if (!Number.isFinite(v)) return
  const r = await updatePoint(editing.id, selectedProjectId.value, {
    value: v,
    recordedAt: editing.recordedAt ? editing.recordedAt.replace('T', ' ') : undefined,
    note: editing.note.trim(),
  })
  if (r.ok) editing.id = null
}
async function removePoint(pid: number) {
  if (selectedProjectId.value === null) return
  if (!window.confirm(t('tracking.delPointConfirm'))) return
  await deletePoint(pid, selectedProjectId.value)
}

// ---------- Excel 批量导入（目标 = 当前选中项目） ----------

const importOpen = ref(false)
const importBusy = ref(false)
const importError = ref('')
const importProgress = ref<{ done: number; total: number } | null>(null)
const importParsed = ref<ParsedImportFile | null>(null)
const importSheetIdx = ref(0)
const importMapping = ref<ImportMapping>({ dateCol: 0, valueCol: 1, noteCol: 2 })
const importResult = ref<{ ok: boolean; imported: number; error: string } | null>(null)
const importDragOver = ref(false)
const importFileInput = ref<HTMLInputElement | null>(null)

const importSheet = computed(() => importParsed.value?.sheets[importSheetIdx.value] ?? null)

// 该项目已有数据点的时刻集合（'YYYY-MM-DD HH:mm:ss'），预览重复提示用（仅提示不阻止）
const existingTimes = computed(() => {
  const id = selectedProjectId.value
  const set = new Set<string>()
  if (id !== null) for (const p of pointsMap.value[id] || []) set.add(p.recordedAt.replace('T', ' '))
  return set
})

const importRows = computed(() =>
  importSheet.value ? mapSheet(importSheet.value, importMapping.value, existingTimes.value) : []
)
const importValidRows = computed(() => importRows.value.filter((r) => !r.error))
const importInvalidCount = computed(() => importRows.value.length - importValidRows.value.length)
const importDupCount = computed(() => importValidRows.value.filter((r) => r.dup).length)
const importPreviewRows = computed(() => importRows.value.slice(0, IMPORT_PREVIEW_LIMIT))

// 映射完整性：日期/数值列不同且都在网格内
const importMappingBad = computed(() => {
  const s = importSheet.value
  const m = importMapping.value
  if (!s) return false
  return m.dateCol === m.valueCol || m.dateCol >= s.width || m.valueCol >= s.width
})

// 服务端单项目 10000 点上限的剩余额度
const importRemaining = computed(() => {
  const p = selectedProject.value
  return Math.max(0, TRACKING_POINT_CAP - (p?.pointCount ?? 0))
})

// 导入按钮禁用原因（null = 可导入）
const importBlockedKey = computed<
  'tracking.importBlockedMapping' | 'tracking.importBlockedNone' | 'tracking.importBlockedCap' | null
>(() => {
  if (importMappingBad.value) return 'tracking.importBlockedMapping'
  if (!importValidRows.value.length) return 'tracking.importBlockedNone'
  if (importValidRows.value.length > importRemaining.value) return 'tracking.importBlockedCap'
  return null
})

function resetImportState() {
  importParsed.value = null
  importResult.value = null
  importError.value = ''
  importProgress.value = null
  importSheetIdx.value = 0
}

function closeImport() {
  importOpen.value = false
  resetImportState()
}

function onImportSheetChange() {
  const s = importSheet.value
  if (s) importMapping.value = detectMapping(s)
}

async function onImportFile(file: File | null | undefined) {
  if (!file) return
  importError.value = ''
  importResult.value = null
  const bad = validateImportFile(file)
  if (bad) {
    importError.value = t(bad === 'type' ? 'tracking.importErrType' : 'tracking.importErrSize', { mb: IMPORT_MAX_MB })
    return
  }
  importBusy.value = true
  try {
    const parsed = await parseImportFile(file)
    if (!parsed.sheets.length) {
      importError.value = t('tracking.importErrEmpty')
    } else {
      importParsed.value = parsed
      importSheetIdx.value = 0
      importMapping.value = detectMapping(parsed.sheets[0])
    }
  } catch {
    importError.value = t('tracking.importErrParse')
  }
  importBusy.value = false
}

function onImportPick(e: Event) {
  const input = e.target as HTMLInputElement
  void onImportFile(input.files?.[0])
  input.value = '' // 允许重复选择同名文件
}
function onImportDrop(e: DragEvent) {
  importDragOver.value = false
  void onImportFile(e.dataTransfer?.files?.[0])
}

async function submitImport() {
  const pid = selectedProjectId.value
  if (pid === null || importBusy.value || importBlockedKey.value) return
  importBusy.value = true
  importResult.value = null
  importProgress.value = { done: 0, total: importValidRows.value.length }
  const rows = importValidRows.value.map((x) => ({
    value: x.value as number,
    recordedAt: x.dateStr as string,
    note: x.note,
  }))
  const r = await importPoints(pid, rows, (done, total) => {
    importProgress.value = { done, total }
  })
  importBusy.value = false
  importProgress.value = null
  importResult.value = r.ok
    ? { ok: true, imported: r.imported, error: '' }
    : {
        ok: false,
        imported: r.imported,
        error: r.error === 'NETWORK' ? t('tracking.errNetwork') : apiError({ error: r.error }, 'api.SERVER_ERROR'),
      }
}

// 切换项目即切换导入目标：清空已解析文件与结果，避免误导入到别的项目
watch(selectedProjectId, () => {
  if (importOpen.value) resetImportState()
})

// ---------- 导出 ----------

const chartBox = ref<HTMLElement | null>(null)

function doExportCsv() {
  if (frame.value.series.length) exportFrameCsv(frame.value)
}
function doExportPng() {
  const svg = chartBox.value?.querySelector('svg')
  if (svg) exportSvgPng(svg as SVGSVGElement)
}

// ---------- 配置面板小组件辅助（数字输入的空值回退 null） ----------
// 注意：v-model 绑定 <input type="number"> 时 Vue 自动把值转为 number，setter 须兼容两种类型

const yMinModel = computed({
  get: () => (config.yMin === null ? '' : String(config.yMin)),
  set: (raw: string | number) => {
    const s = String(raw).trim()
    const v = Number(s)
    config.yMin = s !== '' && Number.isFinite(v) ? v : null
  },
})
const yMaxModel = computed({
  get: () => (config.yMax === null ? '' : String(config.yMax)),
  set: (raw: string | number) => {
    const s = String(raw).trim()
    const v = Number(s)
    config.yMax = s !== '' && Number.isFinite(v) ? v : null
  },
})
const smoothModel = computed({
  get: () => (config.smooth === 0 ? '' : String(config.smooth)),
  set: (raw: string | number) => {
    const s = String(raw).trim()
    const v = Math.round(Number(s))
    config.smooth = s !== '' && Number.isFinite(v) && v >= 2 && v <= 30 ? v : 0
  },
})

function toggleVisible(id: number, on: boolean) {
  config.visible[String(id)] = on
}

// 项目删除后若正是选中项，watch 兜底换选第一个
watch(projects, (list) => {
  if (selectedProjectId.value !== null && !list.some((p) => p.id === selectedProjectId.value)) {
    selectedProjectId.value = list[0]?.id ?? null
  }
  if (selectedProjectId.value === null && list.length) selectedProjectId.value = list[0].id
})
</script>

<template>
  <div class="page-tracking">
    <div class="tracking-container">
      <header class="tracking-header">
        <h1>{{ t('tracking.title') }}</h1>
        <p class="tracking-desc">{{ t('tracking.intro') }}</p>
        <p class="tracking-privacy">{{ t('tracking.privacy') }}</p>
      </header>

      <!-- 游客：登录引导 + 演示入口 -->
      <section v-if="!username && !demoMode" class="tracking-guest">
        <p class="guest-hint">{{ t('tracking.guestHint') }}</p>
        <div class="guest-actions">
          <button type="button" class="btn-primary" @click="router.push('/login')">{{ t('tracking.guestLogin') }}</button>
          <button type="button" class="btn-ghost" @click="enterDemo()">{{ t('tracking.guestDemo') }}</button>
        </div>
      </section>

      <!-- 演示模式横幅 -->
      <div v-if="demoMode" class="tracking-demo-bar">
        <span class="demo-badge">{{ t('tracking.demoBadge') }}</span>
        <span class="demo-hint">{{ t('tracking.demoReadOnly') }}</span>
        <button type="button" class="btn-ghost btn-mini" @click="exitDemo()">{{ t('tracking.demoExit') }}</button>
      </div>

      <!-- 登录态加载失败 -->
      <section v-if="username && loadError" class="tracking-loadfail">
        <p>{{ t('tracking.loadFail') }}</p>
        <button type="button" class="btn-primary" @click="loadAll()">{{ t('tracking.retry') }}</button>
      </section>

      <!-- 工作台 -->
      <div v-if="workbenchOn" class="tracking-workbench" :class="{ 'is-loading': loading }">
        <!-- ===== 左：项目与数据 ===== -->
        <aside class="tracking-side">
          <div class="side-head">
            <h2>{{ t('tracking.sideTitle') }}</h2>
            <button v-if="username && !projForm.open" type="button" class="btn-primary btn-mini" @click="openCreate()">{{ t('tracking.newProject') }}</button>
          </div>

          <p v-if="loading && !loaded" class="side-note">{{ t('tracking.loading') }}</p>

          <!-- 新建 / 编辑表单 -->
          <form v-if="projForm.open" class="proj-form" @submit.prevent="submitProject">
            <h3>{{ projForm.editId === null ? t('tracking.newProject') : t('tracking.editProject') }}</h3>
            <label class="field">
              <span>{{ t('tracking.fieldName') }}</span>
              <input v-model="projForm.name" type="text" maxlength="40" required :placeholder="t('tracking.fieldNamePh')" />
            </label>
            <label class="field">
              <span>{{ t('tracking.fieldUnit') }}</span>
              <input v-model="projForm.unit" type="text" maxlength="20" :placeholder="t('tracking.fieldUnitPh')" />
            </label>
            <label class="field">
              <span>{{ t('tracking.fieldDesc') }}</span>
              <input v-model="projForm.description" type="text" maxlength="200" />
            </label>
            <fieldset v-if="username" class="field">
              <span>{{ t('tracking.fieldColor') }}</span>
              <div class="color-row">
                <button
                  type="button"
                  class="color-dot auto"
                  :class="{ 'is-active': projForm.color === '' }"
                  :title="t('tracking.colorAuto')"
                  @click="projForm.color = ''"
                >A</button>
                <button
                  v-for="c in COLOR_PRESETS"
                  :key="c"
                  type="button"
                  class="color-dot"
                  :class="{ 'is-active': projForm.color === c }"
                  :style="{ background: c }"
                  :title="c"
                  @click="projForm.color = c"
                ></button>
                <input
                  v-model="projForm.color"
                  type="text"
                  class="color-hex"
                  maxlength="7"
                  placeholder="#rrggbb"
                  spellcheck="false"
                />
              </div>
              <p class="field-hint">{{ t('tracking.colorHint') }}</p>
            </fieldset>
            <p v-if="projError" class="form-error" role="alert">{{ projError }}</p>
            <div class="form-actions">
              <button type="submit" class="btn-primary" :disabled="projBusy">{{ t('tracking.save') }}</button>
              <button type="button" class="btn-ghost" @click="closeProjForm()">{{ t('tracking.cancel') }}</button>
            </div>
          </form>

          <!-- 项目列表 -->
          <ul v-if="projects.length" class="proj-list">
            <li
              v-for="p in projects"
              :key="p.id"
              class="proj-item"
              :class="{ 'is-selected': p.id === selectedProjectId }"
            >
              <label class="proj-check" :title="t('tracking.visibleTip')">
                <input
                  type="checkbox"
                  :checked="config.visible[String(p.id)] !== false"
                  @change="toggleVisible(p.id, ($event.target as HTMLInputElement).checked)"
                />
              </label>
              <button type="button" class="proj-main" @click="selectedProjectId = p.id">
                <span class="proj-name">
                  <span v-if="p.color" class="proj-color-dot" :style="{ background: p.color }"></span>
                  {{ p.name }}<template v-if="p.unit"> · {{ p.unit }}</template>
                </span>
                <span class="proj-meta">
                  {{ p.pointCount }} {{ t('tracking.points') }}
                  <template v-if="p.latestValue !== null"> · {{ t('tracking.latest') }} {{ fmtValue(p.latestValue) }}</template>
                </span>
              </button>
              <span v-if="username" class="proj-actions">
                <button type="button" class="icon-btn" :title="t('tracking.edit')" @click="openEdit(p.id)">✎</button>
                <button type="button" class="icon-btn danger" :title="t('tracking.del')" @click="removeProject(p.id)">✕</button>
              </span>
            </li>
          </ul>
          <p v-else-if="!projForm.open && !loading" class="side-note">{{ t('tracking.emptyProjects') }}</p>

          <!-- 数据点面板（选中项目；演示模式只读） -->
          <section v-if="selectedProject" class="point-panel">
            <div class="point-panel-head">
              <h3>{{ t('tracking.pointPanelOf', { name: selectedProject.name, n: selectedProject.pointCount }) }}</h3>
              <button
                v-if="username"
                type="button"
                class="btn-ghost btn-mini"
                :class="{ 'is-active': importOpen }"
                @click="importOpen ? closeImport() : (importOpen = true)"
              >{{ t('tracking.importBtn') }}</button>
            </div>
            <p v-if="demoMode" class="side-note">{{ t('tracking.demoReadOnly') }}</p>

            <!-- 批量导入面板（登录；导入目标 = 当前选中项目） -->
            <div v-if="importOpen && username" class="import-panel">
              <h4>{{ t('tracking.importTitle') }}</h4>

              <!-- 结果态 -->
              <template v-if="importResult">
                <p class="import-result" :class="importResult.ok ? 'is-ok' : 'is-fail'" role="status">
                  <template v-if="importResult.ok">{{ t('tracking.importDone', { n: importResult.imported }) }}</template>
                  <template v-else>{{ t('tracking.importPartial', { n: importResult.imported }) }}{{ importResult.error ? '：' + importResult.error : '' }}</template>
                </p>
                <div class="import-actions">
                  <button type="button" class="btn-primary btn-mini" @click="resetImportState()">{{ t('tracking.importAgain') }}</button>
                  <button type="button" class="btn-ghost btn-mini" @click="closeImport()">{{ t('tracking.importClose') }}</button>
                </div>
              </template>

              <!-- 未选文件：拖拽/点击上传 + 模板 -->
              <template v-else-if="!importParsed">
                <div
                  class="import-drop"
                  :class="{ 'is-over': importDragOver, 'is-busy': importBusy }"
                  role="button"
                  tabindex="0"
                  @click="!importBusy && importFileInput?.click()"
                  @keydown.enter.prevent="!importBusy && importFileInput?.click()"
                  @dragover.prevent="importDragOver = true"
                  @dragleave.prevent="importDragOver = false"
                  @drop.prevent="onImportDrop"
                >
                  <p class="import-drop-main">{{ importBusy ? t('tracking.importBusy') : t('tracking.importDrop') }}</p>
                  <p class="import-drop-sub">{{ t('tracking.importHint') }}</p>
                </div>
                <input ref="importFileInput" type="file" :accept="IMPORT_ACCEPT" hidden @change="onImportPick" />
                <p v-if="importError" class="form-error" role="alert">{{ importError }}</p>
                <div class="import-actions">
                  <button type="button" class="btn-ghost btn-mini" @click="buildImportTemplateCsv()">{{ t('tracking.importTemplate') }}</button>
                  <button type="button" class="btn-ghost btn-mini" @click="closeImport()">{{ t('tracking.importCancel') }}</button>
                </div>
              </template>

              <!-- 已解析：工作表/列映射 + 逐行预览校验 -->
              <template v-else-if="importSheet">
                <p class="import-file">
                  <span class="mono">{{ importParsed.fileName }}</span>
                  <label v-if="importParsed.sheets.length > 1" class="import-sheet-pick">
                    {{ t('tracking.importSheet') }}
                    <select v-model.number="importSheetIdx" @change="onImportSheetChange">
                      <option v-for="(s, i) in importParsed.sheets" :key="s.name" :value="i">{{ s.name }}</option>
                    </select>
                  </label>
                </p>

                <div class="import-mapping">
                  <label class="field">
                    <span>{{ t('tracking.importColDate') }}</span>
                    <select v-model="importMapping.dateCol">
                      <option v-for="c in importSheet.width" :key="'d' + c" :value="c - 1">{{ colLabel(importSheet, c - 1) }}</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>{{ t('tracking.importColValue') }}</span>
                    <select v-model="importMapping.valueCol">
                      <option v-for="c in importSheet.width" :key="'v' + c" :value="c - 1">{{ colLabel(importSheet, c - 1) }}</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>{{ t('tracking.importColNote') }}</span>
                    <select v-model="importMapping.noteCol">
                      <option :value="-1">{{ t('tracking.importColNone') }}</option>
                      <option v-for="c in importSheet.width" :key="'n' + c" :value="c - 1">{{ colLabel(importSheet, c - 1) }}</option>
                    </select>
                  </label>
                </div>

                <p class="import-stats">{{ t('tracking.importStats', { total: importRows.length, ok: importValidRows.length, bad: importInvalidCount, dup: importDupCount }) }}</p>

                <div v-if="importRows.length" class="table-scroll import-preview">
                  <table class="point-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>{{ t('tracking.colTime') }}</th>
                        <th>{{ t('tracking.colValue') }}</th>
                        <th>{{ t('tracking.colNote') }}</th>
                        <th>{{ t('tracking.importColStatus') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="r in importPreviewRows" :key="r.rowNo" :class="r.error ? 'is-err' : 'is-ok'">
                        <td class="mono">{{ r.rowNo }}</td>
                        <td class="mono">{{ r.dateStr ?? '—' }}</td>
                        <td class="mono">{{ r.value !== null ? fmtValue(r.value) : '—' }}</td>
                        <td class="note-cell">{{ r.note }}</td>
                        <td>
                          <span v-if="r.error" class="status-chip is-err">{{ t(r.error) }}</span>
                          <span v-else-if="r.dup" class="status-chip is-dup">{{ t('tracking.importDup') }}</span>
                          <span v-else class="status-chip is-ok">{{ t('tracking.importOk') }}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p v-if="importRows.length > IMPORT_PREVIEW_LIMIT" class="import-more">
                  {{ t('tracking.importPreviewNote', { n: IMPORT_PREVIEW_LIMIT, total: importRows.length }) }}
                </p>

                <p v-if="importError" class="form-error" role="alert">{{ importError }}</p>
                <p v-if="importBlockedKey" class="import-blocked" role="alert">
                  {{ t(importBlockedKey, { n: importValidRows.length, left: importRemaining, cap: TRACKING_POINT_CAP }) }}
                </p>

                <div class="import-actions">
                  <button
                    type="button"
                    class="btn-primary btn-mini"
                    :disabled="importBusy || !!importBlockedKey"
                    @click="submitImport()"
                  >{{
                    importBusy && importProgress
                      ? t('tracking.importProgress', { done: importProgress.done, total: importProgress.total })
                      : t('tracking.importSubmit', { n: importValidRows.length })
                  }}</button>
                  <button type="button" class="btn-ghost btn-mini" :disabled="importBusy" @click="resetImportState()">{{ t('tracking.importChange') }}</button>
                  <button type="button" class="btn-ghost btn-mini" :disabled="importBusy" @click="closeImport()">{{ t('tracking.importCancel') }}</button>
                </div>
              </template>
            </div>

            <form v-if="username" class="point-form" @submit.prevent="submitPoint">
              <div class="point-grid">
                <label class="field">
                  <span>{{ t('tracking.pointDate') }}</span>
                  <input v-model="pointForm.recordedAt" type="datetime-local" required />
                </label>
                <label class="field">
                  <span>{{ t('tracking.pointValue') }}</span>
                  <input v-model="pointForm.value" type="number" step="any" required />
                </label>
              </div>
              <label class="field">
                <span>{{ t('tracking.pointNote') }}</span>
                <input v-model="pointForm.note" type="text" maxlength="200" />
              </label>
              <p v-if="pointError" class="form-error" role="alert">{{ pointError }}</p>
              <button type="submit" class="btn-primary btn-mini" :disabled="pointBusy">{{ t('tracking.add') }}</button>
            </form>
            <div v-if="selectedPoints.length" class="table-scroll">
              <table class="point-table">
                <thead>
                  <tr>
                    <th>{{ t('tracking.colTime') }}</th>
                    <th>{{ t('tracking.colValue') }}</th>
                    <th>{{ t('tracking.colNote') }}</th>
                    <th v-if="username"></th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="pt in selectedPoints" :key="pt.id">
                    <tr v-if="editing.id !== pt.id">
                      <td class="mono">{{ pt.recordedAt.replace('T', ' ') }}</td>
                      <td class="mono">{{ fmtValue(pt.value) }}</td>
                      <td class="note-cell">{{ pt.note }}</td>
                      <td v-if="username" class="row-actions">
                        <button type="button" class="icon-btn" :title="t('tracking.edit')" @click="startEdit(pt.id)">✎</button>
                        <button type="button" class="icon-btn danger" :title="t('tracking.del')" @click="removePoint(pt.id)">✕</button>
                      </td>
                    </tr>
                    <tr v-else class="is-editing">
                      <td><input v-model="editing.recordedAt" type="datetime-local" class="cell-input" /></td>
                      <td><input v-model="editing.value" type="number" step="any" class="cell-input" /></td>
                      <td><input v-model="editing.note" type="text" maxlength="200" class="cell-input" /></td>
                      <td class="row-actions">
                        <button type="button" class="icon-btn ok" :title="t('tracking.savePoint')" @click="saveEdit()">✓</button>
                        <button type="button" class="icon-btn" :title="t('tracking.cancel')" @click="editing.id = null">✕</button>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
            <p v-else class="side-note">{{ t('tracking.emptyPoints') }}</p>
          </section>
        </aside>

        <!-- ===== 右：图表工作区 ===== -->
        <main class="tracking-main">
          <div class="chart-toolbar">
            <div class="style-switch" role="group" :aria-label="t('tracking.styleSwitchLabel')">
              <button
                type="button"
                :class="{ 'is-active': config.style === 'ink' }"
                @click="config.style = 'ink'"
              >{{ t('tracking.styleInk') }}</button>
              <button
                type="button"
                :class="{ 'is-active': config.style === 'science' }"
                @click="config.style = 'science'"
              >{{ t('tracking.styleScience') }}</button>
            </div>
            <div class="export-row">
              <button type="button" class="btn-ghost btn-mini" :disabled="!frame.series.length" @click="doExportCsv()">{{ t('tracking.exportCsv') }}</button>
              <button type="button" class="btn-ghost btn-mini" :disabled="!frame.series.length" @click="doExportPng()">{{ t('tracking.exportPng') }}</button>
            </div>
          </div>

          <p v-if="frame.mixedUnits && config.normalize === 'none'" class="unit-mix-hint">{{ t('tracking.unitMixHint') }}</p>
          <p v-if="config.style === 'ink' && frame.series.length > 6" class="unit-mix-hint">{{ t('tracking.inkOverflow') }}</p>

          <!-- 统计摘要卡 -->
          <div v-if="frame.series.length" class="stats-row">
            <div v-for="s in frame.series" :key="s.key" class="stat-card">
              <p class="stat-name">
                <span class="proj-color-dot" :style="{ background: s.color || (config.style === 'science' ? OKABE_ITO[frame.series.indexOf(s) % OKABE_ITO.length] : '#1C1C1A') }"></span>
                {{ s.name }}<template v-if="s.unit && !frame.normalized">（{{ s.unit }}）</template>
              </p>
              <dl class="stat-grid">
                <div><dt>{{ t('tracking.statLatest') }}</dt><dd class="mono">{{ s.stats.last === null ? '—' : fmtValue(s.stats.last) }}</dd></div>
                <div><dt>{{ t('tracking.statMean') }}</dt><dd class="mono">{{ fmtValue(s.stats.mean) }}</dd></div>
                <div><dt>{{ t('tracking.statRange') }}</dt><dd class="mono">{{ fmtValue(s.stats.min) }}~{{ fmtValue(s.stats.max) }}</dd></div>
                <div>
                  <dt>{{ t('tracking.statDelta') }}</dt>
                  <dd class="mono" :class="{ 'is-up': (s.stats.delta ?? 0) > 0, 'is-down': (s.stats.delta ?? 0) < 0 }">
                    {{ s.stats.delta === null ? '—' : (s.stats.delta > 0 ? '↑' : s.stats.delta < 0 ? '↓' : '→') + fmtValue(Math.abs(s.stats.delta)) }}
                  </dd>
                </div>
                <div>
                  <dt>{{ t('tracking.statTrend') }}</dt>
                  <dd class="mono">{{ s.stats.r2 === null ? '—' : `R²=${s.stats.r2.toFixed(2)}` }}</dd>
                </div>
              </dl>
            </div>
          </div>

          <!-- 图表（空态分流文案） -->
          <div ref="chartBox" class="chart-card">
            <InkLineChart
              v-if="config.style === 'ink' && !chartEmptyKey"
              :key="'ink'"
              :frame="frame"
              :config="config"
              :title="chartTitle"
              :source-label="sourceLabel"
            />
            <ScienceLineChart
              v-else-if="config.style === 'science' && !chartEmptyKey"
              :key="'sci'"
              :frame="frame"
              :config="config"
              :title="chartTitle"
              :is-dark="isDark"
            />
            <div v-else class="chart-empty">
              <p>{{ chartEmptyKey ? t(chartEmptyKey) : '' }}</p>
            </div>          </div>

          <!-- 客制化面板 -->
          <details class="cfg-panel" open>
            <summary>{{ t('tracking.cfgTitle') }}</summary>
            <div class="cfg-body">
              <fieldset class="cfg-group">
                <legend>{{ t('tracking.cfgDataSection') }}</legend>
                <label class="cfg-field">
                  <span>{{ t('tracking.cfgRange') }}</span>
                  <select v-model="config.rangePreset">
                    <option value="all">{{ t('tracking.rangeAll') }}</option>
                    <option value="d7">{{ t('tracking.range7') }}</option>
                    <option value="d30">{{ t('tracking.range30') }}</option>
                    <option value="d90">{{ t('tracking.range90') }}</option>
                    <option value="year">{{ t('tracking.rangeYear') }}</option>
                    <option value="custom">{{ t('tracking.rangeCustom') }}</option>
                  </select>
                </label>
                <template v-if="config.rangePreset === 'custom'">
                  <label class="cfg-field">
                    <span>{{ t('tracking.rangeFrom') }}</span>
                    <input v-model="config.rangeFrom" type="date" />
                  </label>
                  <label class="cfg-field">
                    <span>{{ t('tracking.rangeTo') }}</span>
                    <input v-model="config.rangeTo" type="date" />
                  </label>
                </template>
                <label class="cfg-field">
                  <span>{{ t('tracking.cfgAgg') }}</span>
                  <select v-model="config.agg">
                    <option value="raw">{{ t('tracking.aggRaw') }}</option>
                    <option value="day">{{ t('tracking.aggDay') }}</option>
                    <option value="week">{{ t('tracking.aggWeek') }}</option>
                    <option value="month">{{ t('tracking.aggMonth') }}</option>
                  </select>
                </label>
                <label v-if="config.agg !== 'raw'" class="cfg-field">
                  <span>{{ t('tracking.cfgAggBy') }}</span>
                  <select v-model="config.aggBy">
                    <option value="avg">{{ t('tracking.aggByAvg') }}</option>
                    <option value="min">{{ t('tracking.aggByMin') }}</option>
                    <option value="max">{{ t('tracking.aggByMax') }}</option>
                    <option value="last">{{ t('tracking.aggByLast') }}</option>
                  </select>
                </label>
                <label class="cfg-field">
                  <span>{{ t('tracking.cfgSmooth') }}</span>
                  <input v-model="smoothModel" type="number" min="0" max="30" step="1" :placeholder="t('tracking.smoothOff')" />
                </label>
                <label class="cfg-field">
                  <span>{{ t('tracking.cfgNormalize') }}</span>
                  <select v-model="config.normalize">
                    <option value="none">{{ t('tracking.normNone') }}</option>
                    <option value="minmax">{{ t('tracking.normMinmax') }}</option>
                    <option value="zscore">{{ t('tracking.normZ') }}</option>
                  </select>
                </label>
              </fieldset>

              <fieldset class="cfg-group">
                <legend>{{ t('tracking.cfgChartSection') }}</legend>
                <label class="cfg-field cfg-wide">
                  <span>{{ t('tracking.cfgChartTitle') }}</span>
                  <input v-model="config.title" type="text" maxlength="60" :placeholder="autoTitle || t('tracking.cfgChartTitlePh')" />
                </label>
                <label class="cfg-field">
                  <span>{{ t('tracking.cfgShowPoints') }}</span>
                  <select v-model="config.showPoints">
                    <option value="auto">{{ t('tracking.showPointsAuto') }}</option>
                    <option value="on">{{ t('tracking.showPointsOn') }}</option>
                    <option value="off">{{ t('tracking.showPointsOff') }}</option>
                  </select>
                </label>
                <label class="cfg-field">
                  <span>{{ t('tracking.cfgY') }}</span>
                  <select :value="config.yManualOn ? 'manual' : 'auto'" @change="config.yManualOn = ($event.target as HTMLSelectElement).value === 'manual'">
                    <option value="auto">{{ t('tracking.yAuto') }}</option>
                    <option value="manual">{{ t('tracking.yManual') }}</option>
                  </select>
                </label>
                <template v-if="config.yManualOn">
                  <label class="cfg-field">
                    <span>{{ t('tracking.yMin') }}</span>
                    <input v-model="yMinModel" type="number" step="any" :placeholder="t('tracking.yAuto')" />
                  </label>
                  <label class="cfg-field">
                    <span>{{ t('tracking.yMax') }}</span>
                    <input v-model="yMaxModel" type="number" step="any" :placeholder="t('tracking.yAuto')" />
                  </label>
                </template>

                <!-- 风格专属项：随当前风格显隐 -->
                <template v-if="config.style === 'ink'">
                  <label class="cfg-field cfg-check">
                    <input v-model="config.peakLabels" type="checkbox" />
                    <span>{{ t('tracking.cfgPeak') }}</span>
                  </label>
                </template>
                <template v-else>
                  <label class="cfg-field cfg-check">
                    <input v-model="config.legendInside" type="checkbox" />
                    <span>{{ t('tracking.cfgLegend') }}</span>
                  </label>
                  <label class="cfg-field cfg-check">
                    <input v-model="config.minorGrid" type="checkbox" />
                    <span>{{ t('tracking.cfgMinorGrid') }}</span>
                  </label>
                  <label class="cfg-field cfg-check">
                    <input v-model="config.trendline" type="checkbox" />
                    <span>{{ t('tracking.cfgTrend') }}</span>
                  </label>
                  <label class="cfg-field cfg-check" :class="{ 'is-disabled': config.smooth < 2 }">
                    <input v-model="config.sigmaBand" type="checkbox" :disabled="config.smooth < 2" />
                    <span>{{ t('tracking.cfgSigma') }}</span>
                  </label>
                </template>
              </fieldset>
            </div>
          </details>
        </main>
      </div>
    </div>
  </div>
</template>
