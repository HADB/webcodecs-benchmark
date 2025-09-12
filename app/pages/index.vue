<script lang="ts" setup>
import type { BenchmarkConfig, BenchmarkResult, FrameCache, WebGLContext } from '~~/types'

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
} from 'mediabunny'
import { renderGrayscaleFrame, renderGridGrayscaleFrame, setupWebGLGrayscale, setupWebGLGridGrayscale } from '~/utils/webgl'

const frameCacheSize = 8

const isWebCodecsSupported = ref(false)
const isRunning = ref(false)
const results = ref<BenchmarkResult[]>([])
const progressText = ref('')
const progress = ref(0)
const totalTime = ref(0)
const decodeTotalTime = ref(0)
const renderTotalTime = ref(0)
const encodeTotalTime = ref(0)
const demuxTime = ref(0)
const decodedFrames = ref(0)
const encodedFrames = ref(0)
const resultVideos = ref<Map<string, { blob?: Blob }>>(new Map())

const benchmarkConfig = ref<BenchmarkConfig>({
  width: 1920,
  height: 1080,
  codec: 'avc',
  framerate: 30,
  bitrate: 8000000,
  keyFrameInterval: 3,
  maxFrames: 3600,
  testMode: 'grayscale',
})

const overlay = useOverlay()
const resolutionOptions = ref(['360P', '720P', '1080p', '4K'])
const selectedResolution = ref('1080p')
const selectedCodec = ref<'avc' | 'hevc' | 'vp9' | 'av1' | 'vp8'>('avc')
const testModeOptions = ref([
  { label: '灰度', value: 'grayscale' },
  { label: '四宫格+灰度', value: 'grid-grayscale' },
])
const selectedTestMode = ref<'grayscale' | 'grid-grayscale'>('grayscale')
const uploadedVideos = ref<File[]>([])
const uploadError = ref('')
const fileInput = ref<HTMLInputElement>()

let inputVideos: Blob[] = []
let frameCachePool: FrameCache[] = []
let grayscaleWebGLContext: WebGLContext | null = null
let gridGrayscaleWebGLContext: WebGLContext | null = null

function cleanupFrameCache() {
  // 清理帧缓存
  frameCachePool = []

  // 清理全局 WebGL 上下文
  if (grayscaleWebGLContext) {
    grayscaleWebGLContext.cleanup()
    grayscaleWebGLContext = null
  }

  if (gridGrayscaleWebGLContext) {
    gridGrayscaleWebGLContext.cleanup()
    gridGrayscaleWebGLContext = null
  }
}

function initializeFrameCache() {
  const currentWidth = benchmarkConfig.value.width
  const currentHeight = benchmarkConfig.value.height

  // 检查是否需要重新创建帧缓存（分辨率变化）
  const needRecreate = frameCachePool.length === 0
    || frameCachePool[0]?.canvas.width !== currentWidth
    || frameCachePool[0]?.canvas.height !== currentHeight

  if (!needRecreate) {
    return
  }

  // 先清理现有的缓存
  cleanupFrameCache()

  // 创建全局 WebGL 上下文
  const tempCanvas = new OffscreenCanvas(currentWidth, currentHeight)
  grayscaleWebGLContext = setupWebGLGrayscale(tempCanvas)

  const tempGridCanvas = new OffscreenCanvas(currentWidth, currentHeight)
  gridGrayscaleWebGLContext = setupWebGLGridGrayscale(tempGridCanvas)

  // 创建帧缓存池
  for (let i = 0; i < frameCacheSize; i++) {
    const canvas = new OffscreenCanvas(currentWidth, currentHeight)
    frameCachePool.push({
      canvas,
      timestamp: 0,
      duration: 0,
      inUse: false,
    })
  }
}

function getAvailableFrameCache(): FrameCache | null {
  return frameCachePool.find((cache) => !cache.inUse) || null
}

// 更新分辨率的函数
function updateResolution(value: string) {
  if (value === '360P') {
    benchmarkConfig.value.width = 640
    benchmarkConfig.value.height = 360
  }
  else if (value === '720P') {
    benchmarkConfig.value.width = 1280
    benchmarkConfig.value.height = 720
  }
  else if (value === '1080p') {
    benchmarkConfig.value.width = 1920
    benchmarkConfig.value.height = 1080
  }
  else if (value === '4K') {
    benchmarkConfig.value.width = 3840
    benchmarkConfig.value.height = 2160
  }
}

// 更新测试模式的函数
function updateTestMode(value: string) {
  if (value === 'grayscale' || value === 'grid-grayscale') {
    benchmarkConfig.value.testMode = value
    selectedTestMode.value = value
    // 清空已上传的视频，因为不同模式需要不同数量的视频
    uploadedVideos.value = []
    uploadError.value = ''
  }
}

function handleVideoUpload(files: File[]) {
  uploadError.value = ''

  const requiredVideoCount = benchmarkConfig.value.testMode === 'grid-grayscale' ? 4 : 1

  if (files.length !== requiredVideoCount) {
    uploadError.value = `${benchmarkConfig.value.testMode === 'grid-grayscale' ? '四宫格' : '灰度'}模式需要上传 ${requiredVideoCount} 个视频文件`
    return
  }

  // 验证文件类型
  const invalidFiles = files.filter((file) => !file.type.startsWith('video/'))
  if (invalidFiles.length > 0) {
    uploadError.value = '请上传有效的视频文件'
    return
  }

  uploadedVideos.value = files
}

function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files) {
    handleVideoUpload(Array.from(target.files))
  }
}

const canStartTest = computed(() => {
  const requiredVideoCount = benchmarkConfig.value.testMode === 'grid-grayscale' ? 4 : 1
  return isWebCodecsSupported.value
    && selectedCodec.value
    && !isRunning.value
    && uploadedVideos.value.length === requiredVideoCount
})

// 统一的基准测试函数
async function runBenchmark(): Promise<BenchmarkResult> {
  const startTime = performance.now()
  const startTimeStr = new Date().toLocaleString('zh-CN')
  const isGridMode = benchmarkConfig.value.testMode === 'grid-grayscale'

  const result: BenchmarkResult = {
    totalFrames: benchmarkConfig.value.maxFrames,
    totalTime: 0,
    demuxTime: 0,
    remuxTime: 0,
    decodeTime: 0,
    renderTime: 0,
    encodeTime: 0,
    totalFps: 0,
    success: false,
    startTime: startTimeStr,
    config: { ...benchmarkConfig.value },
  }

  try {
    // 根据模式创建输入源
    const inputs = inputVideos.map((video) => new Input({ source: new BlobSource(video), formats: ALL_FORMATS }))

    // 获取视频轨道和采样器
    const videoTracks = await Promise.all(inputs.map((input) => input.getPrimaryVideoTrack()))
    const videoSampleSinks = videoTracks.map((track) => new VideoSampleSink(track!))

    const output = new Output({
      target: new BufferTarget(),
      format: new Mp4OutputFormat(),
    })

    // 初始化帧缓存池
    initializeFrameCache()

    // 创建 CanvasSource 专用的 canvas
    const canvasSourceCanvas = new OffscreenCanvas(benchmarkConfig.value.width, benchmarkConfig.value.height)
    const canvasSourceCtx = canvasSourceCanvas.getContext('2d')!
    const canvasSource = new CanvasSource(canvasSourceCanvas, {
      codec: selectedCodec.value,
      bitrate: benchmarkConfig.value.bitrate,
      keyFrameInterval: benchmarkConfig.value.keyFrameInterval,
    })

    output.addVideoTrack(canvasSource, {
      frameRate: benchmarkConfig.value.framerate,
    })

    await output.start()

    // 帧队列配置
    const maxQueueSize = 10
    const frameQueue: FrameCache[] = []
    let encodePromise: Promise<void> | null = null

    // 编码器消费者函数
    const encodeConsumer = async () => {
      while (encodedFrames.value < result.totalFrames || frameQueue.length > 0) {
        if (frameQueue.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1))
          continue
        }

        const frameCache = frameQueue.shift()!
        const encodeStartTime = performance.now()

        // 将缓存的帧数据绘制到 CanvasSource 的 canvas 上
        canvasSourceCtx.drawImage(frameCache.canvas, 0, 0)
        await canvasSource.add(frameCache.timestamp, frameCache.duration)

        // 释放帧缓存
        frameCache.inUse = false
        encodeTotalTime.value += performance.now() - encodeStartTime
        encodedFrames.value++
      }
    }

    // 启动编码消费者
    encodePromise = encodeConsumer()

    const demuxStartTime = performance.now()
    let lastFrameDecodeDoneTime = performance.now()

    if (isGridMode) {
      // 四宫格模式：同时处理四个视频流
      const sampleIterators = videoSampleSinks.map((sink) => sink.samples()[Symbol.asyncIterator]())

      while (decodedFrames.value < benchmarkConfig.value.maxFrames) {
        if (demuxTime.value === 0) {
          demuxTime.value = performance.now() - demuxStartTime
        }

        // 等待队列有空间
        while (frameQueue.length >= maxQueueSize) {
          await new Promise((resolve) => setTimeout(resolve, 1))
        }

        // 获取可用的四宫格帧缓存
        let frameCache = getAvailableFrameCache()
        while (!frameCache) {
          await new Promise((resolve) => setTimeout(resolve, 1))
          frameCache = getAvailableFrameCache()
        }

        // 从四个视频流中各取一帧
        const samplePromises = sampleIterators.map((iterator) => iterator.next())
        const sampleResults = await Promise.all(samplePromises)

        // 检查是否所有流都还有数据
        if (sampleResults.some((result) => result.done)) {
          break
        }

        const samples = sampleResults.map((result) => result.value) as [any, any, any, any]

        // 解码时间统计
        decodeTotalTime.value += performance.now() - lastFrameDecodeDoneTime

        frameCache.inUse = true
        frameCache.timestamp = samples[0].timestamp
        frameCache.duration = 1 / benchmarkConfig.value.framerate

        // 使用全局的四宫格 WebGL 上下文进行渲染
        const renderStartTime = performance.now()
        if (gridGrayscaleWebGLContext) {
          renderGridGrayscaleFrame(gridGrayscaleWebGLContext, samples, benchmarkConfig.value.width, benchmarkConfig.value.height, frameCache.canvas)
        }
        renderTotalTime.value += performance.now() - renderStartTime

        // 关闭样本
        samples.forEach((sample) => sample.close())

        // 将处理好的帧信息加入队列
        frameQueue.push(frameCache)

        totalTime.value = performance.now() - startTime
        decodedFrames.value++
        progress.value = (decodedFrames.value / benchmarkConfig.value.maxFrames) * 100
        lastFrameDecodeDoneTime = performance.now()
      }
    }
    else {
      // 单视频灰度模式：处理单个视频流
      const sampleSink = videoSampleSinks[0]
      if (!sampleSink) {
        throw new Error('无法获取视频采样器')
      }

      for await (const sample of sampleSink.samples()) {
        if (demuxTime.value === 0) {
          demuxTime.value = performance.now() - demuxStartTime
        }

        // 超出总帧数则停止
        if (decodedFrames.value >= benchmarkConfig.value.maxFrames) {
          sample.close()
          break
        }

        // 解码时间统计
        decodeTotalTime.value += performance.now() - lastFrameDecodeDoneTime

        // 等待队列有空间
        while (frameQueue.length >= maxQueueSize) {
          await new Promise((resolve) => setTimeout(resolve, 1))
        }

        // 获取可用的帧缓存
        let frameCache = getAvailableFrameCache()
        while (!frameCache) {
          await new Promise((resolve) => setTimeout(resolve, 1))
          frameCache = getAvailableFrameCache()
        }

        frameCache.inUse = true
        frameCache.timestamp = sample.timestamp
        frameCache.duration = 1 / benchmarkConfig.value.framerate

        // 使用全局的灰度 WebGL 上下文渲染灰度滤镜
        const renderStartTime = performance.now()
        if (grayscaleWebGLContext) {
          renderGrayscaleFrame(grayscaleWebGLContext, sample, benchmarkConfig.value.width, benchmarkConfig.value.height, frameCache.canvas)
        }
        renderTotalTime.value += performance.now() - renderStartTime

        // 将处理好的帧信息加入队列
        frameQueue.push(frameCache)

        sample.close()

        totalTime.value = performance.now() - startTime
        decodedFrames.value++
        progress.value = (decodedFrames.value / benchmarkConfig.value.maxFrames) * 100
        lastFrameDecodeDoneTime = performance.now()
      }
    }

    if (decodedFrames.value < benchmarkConfig.value.maxFrames) {
      result.totalFrames = decodedFrames.value
    }

    // 等待编码器处理完所有帧
    if (encodePromise) {
      await encodePromise
    }

    canvasSource.close()

    const remuxStartTime = performance.now()
    await output.finalize()

    const endTime = performance.now()
    const videoBlob = new Blob([output.target.buffer!], { type: output.format.mimeType })
    result.totalTime = endTime - startTime
    result.demuxTime = demuxTime.value
    result.remuxTime = endTime - remuxStartTime
    result.decodeTime = decodeTotalTime.value
    result.renderTime = renderTotalTime.value
    result.encodeTime = encodeTotalTime.value
    result.totalFps = (encodedFrames.value * 1000) / result.totalTime
    result.success = true
    result.fileSize = videoBlob.size

    // 保存视频数据用于下载
    resultVideos.value.set(startTimeStr, {
      blob: videoBlob,
    })
  }
  catch (error) {
    result.error = (error as Error).message
  }
  finally {
    cleanupFrameCache()
  }

  return result
}

async function onRunButtonClick() {
  if (!isWebCodecsSupported.value || !selectedCodec.value) {
    return
  }

  // 检查是否已上传视频
  const requiredVideoCount = benchmarkConfig.value.testMode === 'grid-grayscale' ? 4 : 1
  if (uploadedVideos.value.length !== requiredVideoCount) {
    uploadError.value = `请先上传 ${requiredVideoCount} 个视频文件`
    return
  }

  isRunning.value = true
  progress.value = 0
  totalTime.value = 0
  demuxTime.value = 0
  decodedFrames.value = 0
  encodedFrames.value = 0
  decodeTotalTime.value = 0
  renderTotalTime.value = 0
  encodeTotalTime.value = 0
  uploadError.value = ''

  try {
    progressText.value = '正在准备测试视频...'

    // 将上传的文件转换为 Blob
    inputVideos = uploadedVideos.value.map((file) => new Blob([file], { type: file.type }))

    progressText.value = '测试中...'
    progress.value = 0
    const benchmarkResult = await runBenchmark()
    results.value.push(benchmarkResult)
  }
  catch (error) {
    console.error('测试失败:', error)
    uploadError.value = '测试过程中发生错误，请检查上传的视频文件'
    isRunning.value = false
    return
  }

  progressText.value = 'Benchmark completed!'
  isRunning.value = false
  progress.value = 100
}

function onExportResultsButtonClick() {
  const data = {
    timestamp: new Date().toISOString(),
    testConfig: benchmarkConfig.value,
    results: results.value,
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `webcodecs-benchmark-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

async function onDownloadButtonClick(codec: string) {
  const videoData = resultVideos.value.get(codec)
  if (!videoData) {
    console.error('未找到该编解码器的视频数据')
    return
  }

  try {
    if (videoData.blob) {
      const url = URL.createObjectURL(videoData.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${codec}-${benchmarkConfig.value.width}x${benchmarkConfig.value.height}-${Date.now()}.mp4`
      a.click()
      URL.revokeObjectURL(url)
    }
  }
  catch (error) {
    console.error('下载视频失败:', error)
  }
}

async function onPreviewButtonClick(testTime: string) {
  const videoData = resultVideos.value.get(testTime)
  if (!videoData || !videoData.blob) {
    console.error('未找到该编解码器的视频数据')
    return
  }

  try {
    // 动态导入组件并使用 overlay 打开模态框
    const { default: VideoPreviewModal } = await import('~/components/video-preview-modal.vue')
    const modal = overlay.create(VideoPreviewModal)

    const instance = modal.open({
      result: results.value.find((r) => r.startTime === testTime)!,
      blob: videoData.blob,
    })

    // 等待模态框关闭
    await instance.result
  }
  catch (error) {
    console.error('打开视频预览失败:', error)
  }
}

function onClearResultsButtonClick() {
  results.value = []
  progress.value = 0
  totalTime.value = 0
  decodedFrames.value = 0
  encodedFrames.value = 0
  decodeTotalTime.value = 0
  renderTotalTime.value = 0
  encodeTotalTime.value = 0
  demuxTime.value = 0
  progressText.value = ''
  resultVideos.value.clear()
}

onMounted(() => {
  if (typeof VideoEncoder !== 'undefined') {
    isWebCodecsSupported.value = true
  }
  else {
    isWebCodecsSupported.value = false
  }
})

onUnmounted(() => {
  cleanupFrameCache()
})
</script>

<template>
  <div class="min-h-screen bg-gray-900 text-white">
    <div class="container mx-auto p-4 max-w-7xl">
      <h1 class="text-4xl font-bold text-center mt-8 text-white">
        WebCodecs 性能测试（MediaBunny）
      </h1>

      <div class="mt-6">
        <div v-if="!isWebCodecsSupported" class="bg-red-900/50 border border-red-600 text-red-300 p-4 rounded-md">
          <strong>错误:</strong> 您的浏览器不支持 WebCodecs API 的视频编码功能。请使用支持 WebCodecs 的浏览器。
        </div>
      </div>

      <div class="bg-gray-800 p-4 rounded-md mt-6 border border-gray-700">
        <h2 class="text-lg font-semibold mb-4 text-white">
          测试选项
        </h2>

        <div class="flex flex-wrap gap-4">
          <div class="flex items-center gap-2">
            <label class="text-sm font-medium text-gray-300 whitespace-nowrap">测试项</label>
            <USelect
              v-model="selectedTestMode"
              :items="testModeOptions"
              class="w-32"
              placeholder="选择测试模式"
              @update:model-value="updateTestMode"
            />
          </div>
          <div class="flex items-center gap-2">
            <label class="text-sm font-medium text-gray-300 whitespace-nowrap">编码</label>
            <USelect
              v-model="selectedCodec"
              :items="['avc', 'hevc', 'vp9', 'av1', 'vp8']"
              class="w-20"
              placeholder="选择要测试的编码器"
            />
          </div>
          <div class="flex items-center gap-2">
            <label class="text-sm font-medium text-gray-300 whitespace-nowrap">分辨率</label>
            <USelect
              v-model="selectedResolution"
              :items="resolutionOptions"
              class="w-22"
              @update:model-value="updateResolution"
            />
          </div>
          <div class="flex items-center gap-2">
            <label class="text-sm font-medium text-gray-300 whitespace-nowrap">帧率</label>
            <USelect
              v-model="benchmarkConfig.framerate"
              :items="[30, 60]"
              class="w-16"
            />
          </div>
          <div class="flex items-center gap-2">
            <label class="text-sm font-medium text-gray-300 whitespace-nowrap">比特率</label>
            <UInput v-model.number="benchmarkConfig.bitrate" type="number" :min="100000" :max="50000000" class="w-25" />
          </div>
          <div class="flex items-center gap-2">
            <label class="text-sm font-medium text-gray-300 whitespace-nowrap">关键帧(秒)</label>
            <UInput v-model.number="benchmarkConfig.keyFrameInterval" type="number" :min="1" :max="120" class="w-16" />
          </div>
          <div class="flex items-center gap-2">
            <label class="text-sm font-medium text-gray-300 whitespace-nowrap">总帧数</label>
            <UInput v-model.number="benchmarkConfig.maxFrames" type="number" :min="30" :max="1800" class="w-20" />
          </div>
        </div>
      </div>

      <!-- 视频上传区域 -->
      <div class="bg-gray-800 p-4 rounded-md mt-6 border border-gray-700">
        <h2 class="text-lg font-semibold mb-4 text-white">
          上传测试视频
        </h2>

        <div class="space-y-4">
          <div class="text-sm text-gray-400">
            <p v-if="benchmarkConfig.testMode === 'grid-grayscale'">
              四宫格模式需要上传 4 个视频文件，将会在四个象限中同时播放
            </p>
            <p v-else>
              灰度模式需要上传 1 个视频文件
            </p>
          </div>

          <div class="border-2 border-dashed border-gray-600 rounded-lg p-6 text-center hover:border-gray-500 transition-colors">
            <input
              ref="fileInput"
              type="file"
              :multiple="benchmarkConfig.testMode === 'grid-grayscale'"
              accept="video/*"
              class="hidden"
              @change="onFileChange"
            >
            <div class="space-y-2">
              <div class="text-gray-400">
                <svg class="mx-auto h-12 w-12" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                  <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </div>
              <div>
                <UButton
                  color="primary"
                  variant="outline"
                  @click="fileInput?.click()"
                >
                  选择视频文件
                </UButton>
              </div>
              <p class="text-xs text-gray-500">
                支持 MP4、WebM 等视频格式
              </p>
            </div>
          </div>

          <!-- 上传的文件列表 -->
          <div v-if="uploadedVideos.length > 0" class="space-y-2">
            <h3 class="text-sm font-medium text-gray-300">
              已上传的视频：
            </h3>
            <div class="space-y-1">
              <div
                v-for="(file, index) in uploadedVideos"
                :key="index"
                class="flex items-center justify-between bg-gray-700 p-2 rounded text-sm"
              >
                <span class="text-gray-300">{{ file.name }}</span>
                <span class="text-gray-500">{{ (file.size / (1024 * 1024)).toFixed(1) }} MB</span>
              </div>
            </div>
          </div>

          <!-- 错误信息 -->
          <div v-if="uploadError" class="bg-red-900/50 border border-red-600 text-red-300 p-3 rounded-md text-sm">
            {{ uploadError }}
          </div>
        </div>
      </div>

      <!-- 控制按钮 -->
      <div class="flex gap-10 mt-6">
        <div class="flex gap-4">
          <UButton
            :disabled="!canStartTest"
            color="primary"
            size="lg"
            @click="onRunButtonClick"
          >
            {{ isRunning ? '运行中...' : '开始测试' }}
          </UButton>

          <UButton
            :disabled="isRunning || results.length === 0"
            color="neutral"
            size="lg"
            @click="onClearResultsButtonClick"
          >
            清除结果
          </UButton>

          <UButton
            :disabled="results.length === 0"
            color="success"
            size="lg"
            @click="onExportResultsButtonClick"
          >
            导出结果
          </UButton>
        </div>
        <div v-if="isRunning" class="flex-1 flex flex-col justify-end">
          <div class="w-full">
            <UProgress v-model="progress" />
          </div>
          <div class="flex items-center justify-between text-xs text-gray-400 mt-1">
            <span>{{ progressText }}</span>
            <span>解码FPS: {{ decodeTotalTime > 0 ? `${(decodedFrames / decodeTotalTime * 1000).toFixed(1)}` : '' }}</span>
            <span>渲染FPS: {{ renderTotalTime > 0 ? `${(decodedFrames / renderTotalTime * 1000).toFixed(1)}` : '' }}</span>
            <span>编码FPS: {{ encodeTotalTime > 0 ? `${(encodedFrames / encodeTotalTime * 1000).toFixed(1)}` : '' }}</span>
            <span>整体FPS: {{ totalTime > 0 ? `${(encodedFrames / totalTime * 1000).toFixed(1)}` : '' }}</span>
            <span>{{ progress.toFixed(1) }}%</span>
          </div>
        </div>
      </div>

      <div v-if="results.length > 0" class="mt-6 bg-gray-800 rounded-md shadow-lg overflow-hidden border border-gray-700">
        <h2 class="text-lg font-semibold p-4 border-b border-gray-600 text-white">
          测试结果
        </h2>

        <div class="overflow-x-auto">
          <table class="min-w-full">
            <thead class="bg-gray-700">
              <tr>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  测试时间
                </th>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  测试选项
                </th>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  耗时 (ms)
                </th>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  解封装 (ms)
                </th>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  封装 (ms)
                </th>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  解码 (ms)
                </th>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  渲染 (ms)
                </th>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  编码 (ms)
                </th>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  整体FPS
                </th>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  文件大小
                </th>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  状态
                </th>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody class="bg-gray-800 divide-y divide-gray-700">
              <tr v-for="result in results" :key="`${result.startTime}`" :class="result.success ? '' : 'bg-red-900/20'">
                <td class="p-3 text-center whitespace-nowrap text-xs text-gray-300">
                  {{ result.startTime || '-' }}
                </td>
                <td class="p-3 text-center whitespace-nowrap text-xs text-gray-300">
                  {{ result.config.testMode === 'grid-grayscale' ? '四宫格+灰度' : '灰度' }} / {{ result.config.codec }} / {{ result.config.width }}x{{ result.config.height }} / {{ result.config.framerate }}FPS /   {{ result.config.bitrate ? `${(result.config.bitrate / 1000000).toFixed(1)} Mbps` : '-' }} / {{ result.config.keyFrameInterval }}秒 / {{ result.config.maxFrames }}帧
                </td>
                <td class="p-3 text-center whitespace-nowrap text-xs text-gray-300">
                  {{ result.totalTime.toFixed(1) }}
                </td>
                <td class="p-3 text-center whitespace-nowrap text-xs text-gray-300">
                  Sum: {{ (result.demuxTime).toFixed(1) }}
                </td>
                <td class="p-3 text-center whitespace-nowrap text-xs text-gray-300">
                  Sum: {{ (result.remuxTime).toFixed(1) }}
                </td>
                <td class="p-3 text-center whitespace-nowrap text-xs text-gray-300">
                  <div class="flex flex-col items-center">
                    <span>Sum: {{ (result.decodeTime).toFixed(1) }}</span>
                    <span>Avg: {{ (result.decodeTime / result.totalFrames).toFixed(1) }}</span>
                  </div>
                </td>
                <td class="p-3 text-center whitespace-nowrap text-xs text-gray-300">
                  <div class="flex flex-col items-center">
                    <span>Sum: {{ (result.renderTime).toFixed(1) }}</span>
                    <span>Avg: {{ (result.renderTime / result.totalFrames).toFixed(1) }}</span>
                  </div>
                </td>
                <td class="p-3 text-center whitespace-nowrap text-xs text-gray-300">
                  <div class="flex flex-col items-center">
                    <span>Sum: {{ (result.encodeTime).toFixed(1) }}</span>
                    <span>Avg: {{ (result.encodeTime / result.totalFrames).toFixed(1) }}</span>
                  </div>
                </td>
                <td class="p-3 text-center whitespace-nowrap text-xs text-gray-300">
                  {{ result.totalFps.toFixed(1) }}
                </td>
                <td class="p-3 text-center whitespace-nowrap text-xs text-gray-300">
                  {{ result.fileSize ? `${(result.fileSize / (1024 * 1024)).toFixed(1)} MB` : '-' }}
                </td>
                <td class="p-3 text-center whitespace-nowrap">
                  <span v-if="result.success" class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-900/50 text-green-300 border border-green-600">
                    成功
                  </span>
                  <span v-else class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-900/50 text-red-300 border border-red-600" :title="result.error">
                    失败
                  </span>
                </td>
                <td class="p-3 text-center whitespace-nowrap">
                  <div v-if="result.success && resultVideos.get(result.startTime)?.blob" class="flex items-center justify-center gap-2">
                    <UButton
                      size="xs"
                      color="info"
                      @click="onDownloadButtonClick(result.startTime)"
                    >
                      下载
                    </UButton>
                    <UButton
                      size="xs"
                      color="primary"
                      title="播放生成的视频"
                      @click="onPreviewButtonClick(result.startTime)"
                    >
                      预览
                    </UButton>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
