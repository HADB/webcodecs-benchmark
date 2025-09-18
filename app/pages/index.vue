<script lang="ts" setup>
import type { BenchmarkConfig, BenchmarkResult } from '~~/types'
import { ALL_FORMATS, BlobSource, Input, Mp4OutputFormat, Output, StreamTarget, VideoSample, VideoSampleSink, VideoSampleSource } from 'mediabunny'
import { cleanupGlobalRenderer, getWebGLRenderer } from '~/utils/webgl'

const frameQueueSize = 10

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

const canStartTest = computed(() => {
  const requiredVideoCount = benchmarkConfig.value.testMode === 'grid-grayscale' ? 4 : 1
  return isWebCodecsSupported.value
    && selectedCodec.value
    && !isRunning.value
    && uploadedVideos.value.length === requiredVideoCount
})

function cleanupWebGLRenderer() {
  // 清理全局 WebGL 渲染器
  cleanupGlobalRenderer()
}

function initializeWebGLRenderer() {
  // 初始化全局 WebGL 渲染器
  const renderer = getWebGLRenderer()
  renderer.initialize(benchmarkConfig.value.width, benchmarkConfig.value.height)
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

function onVideoUpload() {
  uploadError.value = ''

  const requiredVideoCount = benchmarkConfig.value.testMode === 'grid-grayscale' ? 4 : 1

  if (uploadedVideos.value.length !== requiredVideoCount) {
    uploadError.value = `${benchmarkConfig.value.testMode === 'grid-grayscale' ? '四宫格' : '灰度'}模式需要上传 ${requiredVideoCount} 个视频文件`
  }
}

async function runBenchmark(): Promise<BenchmarkResult> {
  const handle = await window.showSaveFilePicker({
    suggestedName: 'webcodecs-output.mp4',
  })

  const startTime = performance.now()
  const startTimeStr = new Date().toLocaleString('zh-CN')

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
    const inputs = uploadedVideos.value.map((video) => new Input({ source: new BlobSource(video), formats: ALL_FORMATS }))

    // 获取视频轨道和采样器
    const videoTracks = await Promise.all(inputs.map((input) => input.getPrimaryVideoTrack()))
    const videoSampleSinks = videoTracks.map((track) => new VideoSampleSink(track!))

    const writableStream = await handle.createWritable()
    const output = new Output({
      target: new StreamTarget(writableStream, { chunked: true }),
      format: new Mp4OutputFormat(),
    })

    // 初始化 WebGL 渲染器
    initializeWebGLRenderer()

    const videoSampleSource = new VideoSampleSource({
      codec: selectedCodec.value,
      bitrate: benchmarkConfig.value.bitrate,
      keyFrameInterval: benchmarkConfig.value.keyFrameInterval,
    })

    output.addVideoTrack(videoSampleSource, {
      frameRate: benchmarkConfig.value.framerate,
    })

    await output.start()

    const frameQueue: VideoSample[] = []
    let encodePromise: Promise<void> | null = null

    // 队列空间可用的通知
    let queueSpaceAvailable: (() => void) | null = null
    const waitForQueueSpace = () => new Promise<void>((resolve) => {
      if (frameQueue.length < frameQueueSize) {
        resolve()
      }
      else {
        queueSpaceAvailable = resolve
      }
    })

    // 编码器消费者函数
    const encodeConsumer = async () => {
      while (encodedFrames.value < result.totalFrames || frameQueue.length > 0) {
        if (frameQueue.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1))
          continue
        }

        const encodeStartTime = performance.now()

        const videoSample = frameQueue.shift()!

        await videoSampleSource.add(videoSample)

        videoSample.close()

        // 通知队列空间可用
        if (queueSpaceAvailable && frameQueue.length < frameQueueSize) {
          queueSpaceAvailable()
          queueSpaceAvailable = null
        }

        encodeTotalTime.value += performance.now() - encodeStartTime
        encodedFrames.value++
      }
    }

    // 启动编码消费者
    encodePromise = encodeConsumer()

    // 根据测试模式初始化样本迭代器
    const isGridMode = benchmarkConfig.value.testMode === 'grid-grayscale'
    const requiredIteratorCount = isGridMode ? 4 : 1

    if (isGridMode && videoSampleSinks.length < 4) {
      throw new Error('四宫格模式需要至少4个视频流')
    }

    if (!isGridMode && videoSampleSinks.length < 1) {
      throw new Error('无法获取视频采样器')
    }

    // 统一创建迭代器数组
    const sampleIterators = videoSampleSinks
      .slice(0, requiredIteratorCount)
      .map((sink) => sink.samples(0, benchmarkConfig.value.maxFrames / benchmarkConfig.value.framerate)[Symbol.asyncIterator]())

    while (decodedFrames.value < benchmarkConfig.value.maxFrames) {
      // 等待队列有空间 - 使用事件驱动
      await waitForQueueSpace()

      // 解码
      const decodeStartTime = performance.now()
      const sampleResults = await Promise.all(sampleIterators.map((iterator) => iterator.next()))
      decodeTotalTime.value += performance.now() - decodeStartTime

      // 首次获取样本后记录解封装时间
      if (demuxTime.value === 0) {
        demuxTime.value = performance.now() - decodeStartTime
      }

      // 检查是否有流结束
      if (sampleResults.some((result) => result.done)) {
        sampleResults.forEach((result) => {
          if (!result.done) {
            result.value.close()
          }
        })
        break
      }

      const videoSamples = sampleResults.map((result) => result.value as VideoSample)
      const videoFrames = videoSamples.map((sample) => sample.toVideoFrame())

      // 根据模式选择不同的渲染方式
      const renderStartTime = performance.now()
      const renderer = getWebGLRenderer()

      let renderedCanvas: OffscreenCanvas
      if (isGridMode) {
        // 四宫格+灰度 WebGL 渲染
        renderedCanvas = renderer.renderGridGrayscaleFrame(videoFrames)
      }
      else {
        // 灰度 WebGL 渲染
        renderedCanvas = renderer.renderGrayscaleFrame(videoFrames[0]!)
      }

      renderTotalTime.value += performance.now() - renderStartTime
      videoSamples.forEach((sample) => sample.close())

      // 将处理好的帧信息加入队列
      frameQueue.push(new VideoSample(renderedCanvas, {
        timestamp: decodedFrames.value * (1 / benchmarkConfig.value.framerate),
        duration: 1 / benchmarkConfig.value.framerate,
      }))

      totalTime.value = performance.now() - startTime
      decodedFrames.value++
      progress.value = (decodedFrames.value / benchmarkConfig.value.maxFrames) * 100
    }

    if (decodedFrames.value < benchmarkConfig.value.maxFrames) {
      result.totalFrames = decodedFrames.value
    }

    // 等待编码器处理完所有帧
    if (encodePromise) {
      await encodePromise
    }

    videoSampleSource.close()

    const remuxStartTime = performance.now()
    await output.finalize()

    const endTime = performance.now()
    result.totalTime = endTime - startTime
    result.demuxTime = demuxTime.value
    result.remuxTime = endTime - remuxStartTime
    result.decodeTime = decodeTotalTime.value
    result.renderTime = renderTotalTime.value
    result.encodeTime = encodeTotalTime.value
    result.totalFps = (encodedFrames.value * 1000) / result.totalTime
    result.success = true
  }
  catch (error) {
    result.error = (error as Error).message
  }
  finally {
    cleanupWebGLRenderer()
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
  cleanupWebGLRenderer()
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

      <div class="p-4 rounded-md mt-6 border border-gray-700">
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
      <div class="p-4 rounded-md mt-6 border border-gray-700">
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
          <UFileUpload
            v-model="uploadedVideos"
            multiple
            accept="video/*"
            class="w-full"
            label="选择视频文件"
            description="支持 MP4、WebM 等视频格式"
            layout="list"
            @change="onVideoUpload()"
          />

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

      <div v-if="results.length > 0" class="mt-6 rounded-md shadow-lg overflow-hidden border border-gray-700">
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
                  解码 (ms)
                </th>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  渲染 (ms)
                </th>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  编码 (ms)
                </th>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  封装 (ms)
                </th>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  整体FPS
                </th>
                <th class="p-2 min-w-25 text-center text-xs font-medium text-gray-300 tracking-wider">
                  状态
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-700">
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
                  Sum: {{ (result.demuxTime || 0).toFixed(1) }}
                </td>
                <td class="p-3 text-center whitespace-nowrap text-xs text-gray-300">
                  <div class="flex flex-col items-center">
                    <span>Sum: {{ (result.decodeTime || 0).toFixed(1) }}</span>
                    <span>Avg: {{ ((result.decodeTime || 0) / result.totalFrames).toFixed(1) }}</span>
                  </div>
                </td>
                <td class="p-3 text-center whitespace-nowrap text-xs text-gray-300">
                  <div class="flex flex-col items-center">
                    <span>Sum: {{ (result.renderTime || 0).toFixed(1) }}</span>
                    <span>Avg: {{ ((result.renderTime || 0) / result.totalFrames).toFixed(1) }}</span>
                  </div>
                </td>
                <td class="p-3 text-center whitespace-nowrap text-xs text-gray-300">
                  <div class="flex flex-col items-center">
                    <span>Sum: {{ (result.encodeTime || 0).toFixed(1) }}</span>
                    <span>Avg: {{ ((result.encodeTime || 0) / result.totalFrames).toFixed(1) }}</span>
                  </div>
                </td>
                <td class="p-3 text-center whitespace-nowrap text-xs text-gray-300">
                  Sum: {{ (result.remuxTime || 0).toFixed(1) }}
                </td>
                <td class="p-3 text-center whitespace-nowrap text-xs text-gray-300">
                  {{ result.totalFps.toFixed(1) }}
                </td>
                <td class="p-3 text-center whitespace-nowrap">
                  <span v-if="result.success" class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-900/50 text-green-300 border border-green-600">
                    成功
                  </span>
                  <span v-else class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-900/50 text-red-300 border border-red-600" :title="result.error">
                    失败
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
