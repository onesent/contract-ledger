<template>
  <el-card class="chart-panel" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="card-header-title">{{ title }}</span>
        <div class="card-header-spacer" />
        <slot name="extra" />
      </div>
    </template>

    <el-empty v-if="empty" class="chart-empty" :description="emptyText" :image-size="90" />
    <div
      v-show="!empty"
      ref="chartRef"
      v-loading="loading"
      class="chart-canvas"
      :style="{ height }"
      role="img"
      :aria-label="title"
    />
  </el-card>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import echarts from '../utils/echarts'

const props = defineProps({
  title: { type: String, default: '图表' },
  option: { type: Object, default: () => ({}) },
  height: { type: String, default: '280px' },
  empty: { type: Boolean, default: false },
  emptyText: { type: String, default: '暂无图表数据' },
  loading: { type: Boolean, default: false },
})

const chartRef = ref(null)
/** @type {import('echarts/core').ECharts|null} */
let chart = null
/** @type {ResizeObserver|null} */
let observer = null

function resize() {
  if (chart) {
    try {
      chart.resize()
    } catch {
      /* ignore */
    }
  }
}

function attachObserver() {
  if (observer || !chartRef.value) return
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', resize)
    return
  }
  observer = new ResizeObserver(() => resize())
  observer.observe(chartRef.value)
}

function disposeChart() {
  if (chart) {
    chart.dispose()
    chart = null
  }
}

function render() {
  if (props.empty) {
    disposeChart()
    return
  }
  const el = chartRef.value
  if (!el) return
  if (!chart) {
    chart = echarts.init(el, null, { renderer: 'svg' })
    attachObserver()
  }
  chart.setOption(props.option || {}, true)
  chart.resize()
}

onMounted(() => {
  nextTick(render)
})

watch(
  () => props.option,
  () => nextTick(render),
  { deep: true },
)

watch(
  () => props.empty,
  () => nextTick(render),
)

onBeforeUnmount(() => {
  if (observer) {
    observer.disconnect()
    observer = null
  } else {
    window.removeEventListener('resize', resize)
  }
  disposeChart()
})
</script>
