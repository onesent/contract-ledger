<template>
  <div class="page">
    <div class="page-head">
      <div class="page-head-text">
        <h2 class="page-title">字典配置</h2>
        <p class="page-subtitle">
          合同类型、合同状态、付款方式、部门均可维护，也支持新增自定义分类。
          内置状态项不可删除但可改名改色；已被引用的字典项只能停用，停用后不再出现在新增表单，历史记录仍正常显示名称。
        </p>
      </div>
      <div class="page-actions">
        <el-tooltip :disabled="writable" content="当前为只读模式，仅可浏览与导出" placement="top">
          <span>
            <el-button type="primary" :disabled="!writable" @click="openCreateItem">
              <el-icon><Plus /></el-icon>
              新增字典项
            </el-button>
          </span>
        </el-tooltip>
        <el-tooltip :disabled="writable" content="当前为只读模式，仅可浏览与导出" placement="top">
          <span>
            <el-button :disabled="!writable" @click="openCreateCategory">
              <el-icon><FolderAdd /></el-icon>
              新增分类
            </el-button>
          </span>
        </el-tooltip>
      </div>
    </div>

    <el-alert
      type="info"
      show-icon
      :closable="false"
      title="引用保护"
    >
      被合同、收款记录或人员引用时，删除会被拦截并提示引用数量，请改用「停用」。
      内置状态项（草稿 / 执行中 / 已完结 / 已终止 / 逾期）的编码不可修改。
    </el-alert>

    <el-card shadow="never">
      <el-tabs v-model="activeCategory" type="card" @tab-remove="removeCategory">
        <el-tab-pane
          v-for="category in categories"
          :key="category.code"
          :name="category.code"
          :closable="!category.builtin"
        >
          <template #label>
            <span>
              {{ category.name }}
              <el-tag size="small" type="info" effect="plain" style="margin-left: 4px">
                {{ countOfCategory(category.code) }}
              </el-tag>
            </span>
          </template>
        </el-tab-pane>
      </el-tabs>

      <el-table v-if="!isNarrow" :data="rows" v-loading="!ledger.status.ready" row-key="id" border stripe>
        <el-table-column prop="sort" label="排序" width="80" align="center" />
        <el-table-column prop="code" label="编码" width="150" />
        <el-table-column label="名称" width="170">
          <template #default="{ row }">
            <el-tag effect="plain" :style="tagStyle(row.color)">{{ row.name }}</el-tag>
            <el-tag v-if="row.builtin" type="warning" effect="plain" size="small" style="margin-left: 6px">内置</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="启用" width="90" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="row.enabled"
              :disabled="!writable"
              @change="(value) => changeEnabled(row, value)"
            />
          </template>
        </el-table-column>
        <el-table-column label="引用数量" width="120" align="center">
          <template #default="{ row }">
            <el-tooltip :content="`${row.refCount} ${row.refLabel}`" placement="top">
              <el-tag :type="row.refCount > 0 ? 'warning' : 'info'" effect="plain" size="small">
                {{ row.refCount }}
              </el-tag>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="颜色" width="100" align="center">
          <template #default="{ row }">
            <span class="storage-dot" :style="{ background: row.color, width: '16px', height: '16px' }" />
            <span class="small muted" style="margin-left: 4px">{{ row.color }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="140" show-overflow-tooltip />
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">
            <span class="muted">{{ formatDateTime(row.createdAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="更新时间" width="170">
          <template #default="{ row }">
            <span class="muted">{{ formatDateTime(row.updatedAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <div class="cell-actions">
              <el-tooltip :disabled="writable" content="当前为只读模式" placement="top">
                <span><el-button link type="primary" :disabled="!writable" @click="openEditItem(row)">编辑</el-button></span>
              </el-tooltip>
              <el-tooltip :disabled="!row.builtin" content="内置状态项不可删除，只能改名 / 改色 / 停用" placement="top">
                <span>
                  <el-button link type="danger" :disabled="row.builtin || !writable" @click="removeItem(row)">
                    删除
                  </el-button>
                </span>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="该分类下暂无字典项" :image-size="80">
            <el-button type="primary" :disabled="!writable" @click="openCreateItem">新增字典项</el-button>
          </el-empty>
        </template>
      </el-table>

      <div v-else class="mobile-card-list">
        <el-card v-for="row in rows" :key="row.id" class="mobile-card" shadow="never">
          <div class="mobile-card-head">
            <el-tag effect="plain" :style="tagStyle(row.color)">{{ row.name }}</el-tag>
            <span class="small muted">{{ row.code }}</span>
            <el-tag v-if="row.builtin" type="warning" effect="plain" size="small">内置</el-tag>
            <div class="card-header-spacer" />
            <el-switch
              :model-value="row.enabled"
              :disabled="!writable"
              @change="(value) => changeEnabled(row, value)"
            />
          </div>
          <el-descriptions :column="2" size="small" border>
            <el-descriptions-item label="排序">{{ row.sort }}</el-descriptions-item>
            <el-descriptions-item label="引用">{{ row.refCount }} {{ row.refLabel }}</el-descriptions-item>
            <el-descriptions-item label="创建时间">{{ formatDateTime(row.createdAt) }}</el-descriptions-item>
            <el-descriptions-item label="更新时间">{{ formatDateTime(row.updatedAt) }}</el-descriptions-item>
            <el-descriptions-item label="备注" :span="2">{{ row.note || '—' }}</el-descriptions-item>
          </el-descriptions>
          <div class="mobile-card-actions">
            <el-button size="small" type="primary" :disabled="!writable" @click="openEditItem(row)">编辑</el-button>
            <el-button size="small" type="danger" plain :disabled="row.builtin || !writable" @click="removeItem(row)">
              删除
            </el-button>
          </div>
        </el-card>
        <el-empty v-if="!rows.length" description="该分类下暂无字典项">
          <el-button type="primary" :disabled="!writable" @click="openCreateItem">新增字典项</el-button>
        </el-empty>
      </div>
    </el-card>

    <!-- 字典项表单 -->
    <el-dialog
      v-model="formVisible"
      :title="form.id ? `编辑字典项 · ${form.name}` : '新增字典项'"
      :width="isNarrow ? '96%' : '520px'"
      append-to-body
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="所属分类">
          <el-input :model-value="activeCategoryName" disabled />
        </el-form-item>
        <el-form-item label="编码" prop="code">
          <el-input v-model="form.code" :disabled="form.builtin" maxlength="40" placeholder="字母 / 数字 / 下划线 / 短横线" />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" maxlength="40" placeholder="展示名称" />
        </el-form-item>
        <el-form-item label="排序" prop="sort">
          <el-input-number v-model="form.sort" :min="0" :max="99999" :step="10" controls-position="right" />
          <span class="small muted" style="margin-left: 8px">数值越小越靠前</span>
        </el-form-item>
        <el-form-item label="启用" prop="enabled">
          <el-switch v-model="form.enabled" inline-prompt active-text="启用" inactive-text="停用" />
          <span class="small muted" style="margin-left: 8px">停用后不再出现在新增表单，历史记录仍显示名称</span>
        </el-form-item>
        <el-form-item label="颜色标签" prop="color">
          <el-color-picker v-model="form.color" />
          <span class="dict-color-preview" style="margin-left: 10px">
            预览：
            <el-tag effect="plain" :style="tagStyle(form.color)">{{ form.name || '字典项名称' }}</el-tag>
          </span>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>

    <!-- 新增分类 -->
    <el-dialog v-model="categoryVisible" title="新增字典分类" :width="isNarrow ? '96%' : '440px'" append-to-body>
      <el-form ref="categoryFormRef" :model="categoryForm" :rules="categoryRules" label-width="90px">
        <el-form-item label="分类编码" prop="code">
          <el-input v-model="categoryForm.code" maxlength="40" placeholder="例如 projectStage" />
        </el-form-item>
        <el-form-item label="分类名称" prop="name">
          <el-input v-model="categoryForm.name" maxlength="30" placeholder="例如 项目阶段" />
        </el-form-item>
      </el-form>
      <p class="form-tip">
        新增分类后会出现在上方页签中，可继续添加字典项；分类中仍有字典项时不能删除该分类。
      </p>
      <template #footer>
        <el-button @click="categoryVisible = false">取消</el-button>
        <el-button type="primary" :loading="categorySaving" @click="submitCategory">创建分类</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { FolderAdd, Plus } from '@element-plus/icons-vue'
import { useLedger } from '../composables/useLedger'
import { useMediaQuery } from '../composables/useMediaQuery'
import { dictRules } from '../utils/validate'
import { formatDateTime } from '../utils/format'

const ledger = useLedger()
const isNarrow = useMediaQuery('(max-width: 1023px)')
const writable = computed(() => ledger.storageInfo.value.writable)

const categories = computed(() => ledger.dictCategories.value)
const activeCategory = ref(categories.value[0]?.code || '')
const activeCategoryName = computed(
  () => categories.value.find((item) => item.code === activeCategory.value)?.name || activeCategory.value,
)

watch(
  () => categories.value.map((item) => item.code).join(','),
  () => {
    if (!categories.value.some((item) => item.code === activeCategory.value)) {
      activeCategory.value = categories.value[0]?.code || ''
    }
  },
)

const rows = computed(() => {
  const list = (ledger.dictsByCategory.value[activeCategory.value] || []).slice()
  return list
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
    .map((dict) => {
      const refs = ledger.actions.referenceCountForDict(dict)
      return { ...dict, refCount: refs.count, refLabel: refs.label }
    })
})

function countOfCategory(code) {
  return (ledger.dictsByCategory.value[code] || []).length
}

function tagStyle(color) {
  return {
    '--el-tag-text-color': color || '#409EFF',
    '--el-tag-border-color': color || '#409EFF',
    '--el-tag-bg-color': 'transparent',
  }
}

// ---------- 字典项表单 ----------
const formVisible = ref(false)
const saving = ref(false)
const formRef = ref(null)
const form = reactive({
  id: '',
  code: '',
  name: '',
  sort: 10,
  enabled: true,
  color: '#409EFF',
  note: '',
  builtin: false,
})

const rules = computed(() =>
  dictRules({
    dicts: ledger.data.dicts,
    category: activeCategory.value,
    currentId: form.id,
  }),
)

function openCreateItem() {
  if (!writable.value) {
    ElMessage.warning('当前为只读模式，无法新增字典项')
    return
  }
  const maxSort = rows.value.reduce((max, item) => Math.max(max, Number(item.sort || 0)), 0)
  Object.assign(form, {
    id: '',
    code: '',
    name: '',
    sort: maxSort + 10,
    enabled: true,
    color: '#409EFF',
    note: '',
    builtin: false,
  })
  formVisible.value = true
  nextTick(() => formRef.value?.clearValidate())
}

function openEditItem(row) {
  Object.assign(form, {
    id: row.id,
    code: row.code,
    name: row.name,
    sort: row.sort,
    enabled: row.enabled !== false,
    color: row.color || '#409EFF',
    note: row.note || '',
    builtin: row.builtin === true,
  })
  formVisible.value = true
  nextTick(() => formRef.value?.clearValidate())
}

async function submitForm() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    ElMessage.warning('请检查字典项的编码、名称、排序与颜色')
    return
  }
  saving.value = true
  try {
    const result = await ledger.actions.saveDict({
      ...form,
      category: activeCategory.value,
    })
    if (result.ok) {
      ElMessage.success(result.created ? '字典项已创建' : '字典项已保存')
      formVisible.value = false
    } else {
      ElMessage.error(result.message || '保存失败')
    }
  } finally {
    saving.value = false
  }
}

async function changeEnabled(row, value) {
  const result = await ledger.actions.toggleDict(row, value)
  if (result.ok) {
    ElMessage.success(value ? `已启用「${row.name}」` : `已停用「${row.name}」，新增表单将不再显示`)
  } else {
    ElMessage.error(result.message || '操作失败')
  }
}

async function removeItem(row) {
  if (row.builtin) {
    ElMessage.warning('内置状态项不可删除，只能改名、改色或停用')
    return
  }
  const refs = ledger.actions.referenceCountForDict(row)
  if (refs.count > 0) {
    ElMessage.warning(`「${row.name}」已被 ${refs.count} ${refs.label}引用，不能删除，只能停用`)
    return
  }
  try {
    await ElMessageBox.confirm(`确认删除字典项「${row.name}（${row.code}）」？`, '删除字典项', {
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  const result = await ledger.actions.deleteDict(row)
  if (result.ok) ElMessage.success('字典项已删除')
  else ElMessage.warning(result.message || '删除失败')
}

// ---------- 新增分类 ----------
const categoryVisible = ref(false)
const categorySaving = ref(false)
const categoryFormRef = ref(null)
const categoryForm = reactive({ code: '', name: '' })
const categoryRules = {
  code: [
    { required: true, message: '分类编码不能为空', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (!value) return callback()
        if (!/^[A-Za-z0-9_-]{2,40}$/.test(String(value))) {
          return callback(new Error('仅支持 2-40 位字母、数字、下划线或短横线'))
        }
        if (categories.value.some((item) => item.code.toLowerCase() === String(value).toLowerCase())) {
          return callback(new Error('分类编码已存在'))
        }
        callback()
      },
      trigger: 'blur',
    },
  ],
  name: [
    { required: true, message: '分类名称不能为空', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value && categories.value.some((item) => item.name === String(value).trim())) {
          return callback(new Error('分类名称已存在'))
        }
        callback()
      },
      trigger: 'blur',
    },
  ],
}

function openCreateCategory() {
  categoryForm.code = ''
  categoryForm.name = ''
  categoryVisible.value = true
  nextTick(() => categoryFormRef.value?.clearValidate())
}

async function submitCategory() {
  if (!categoryFormRef.value) return
  try {
    await categoryFormRef.value.validate()
  } catch {
    ElMessage.warning('请检查分类编码与名称')
    return
  }
  categorySaving.value = true
  try {
    const result = await ledger.actions.addDictCategory({ ...categoryForm })
    if (result.ok) {
      ElMessage.success(`已创建分类「${result.category.name}」`)
      categoryVisible.value = false
      activeCategory.value = result.category.code
    } else {
      ElMessage.error(result.message || '创建分类失败')
    }
  } finally {
    categorySaving.value = false
  }
}

async function removeCategory(code) {
  const category = categories.value.find((item) => item.code === code)
  if (!category) return
  const count = countOfCategory(code)
  if (count > 0) {
    ElMessage.warning(`分类「${category.name}」下还有 ${count} 个字典项，请先删除或迁移后再删除分类`)
    return
  }
  try {
    await ElMessageBox.confirm(`确认删除分类「${category.name}」？`, '删除分类', {
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  const result = await ledger.actions.removeDictCategory(code)
  if (result.ok) ElMessage.success('分类已删除')
  else ElMessage.warning(result.message || '删除分类失败')
}
</script>
