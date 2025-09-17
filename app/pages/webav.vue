<script lang="ts" setup>
import type { BenchmarkConfig, BenchmarkResult } from '~~/types'
import { Combinator, MP4Clip, OffscreenSprite } from '@webav/av-cliper'
import { GrayscaleClip } from '~/utils/grayscale-clip'
import { GridGrayscaleClip } from '~/utils/grid-grayscale-clip'

const isWebCodecsSupported = ref(false)
const isRunning = ref(false)
const results = ref<BenchmarkResult[]>([])
const progressText = ref('')
const progress = ref(0)

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
const selectedCodec = ref<string>('')
const supportedCodecs = ref<string[]>([])
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

// 检查支持的编码器
async function checkSupportedCodecs() {
  const codecs = [
    'avc1.640028', // 4.0
    'avc1.640029', // 4.1
    'avc1.64002a', // 4.2
    'avc1.640032', // 5.0
    'avc1.640033', // 5.1
    'avc1.640034', // 5.2
    'avc1.64003C', // 6.0
    'avc1.64003D', // 6.1
    'avc1.64003E', // 6.2
    'hev1.1.6.L93.B0',
  ]

  const supported: string[] = []

  for (const codec of codecs) {
    try {
      const encoderSupport = await VideoEncoder.isConfigSupported({
        codec,
        width: benchmarkConfig.value.width,
        height: benchmarkConfig.value.height,
        bitrate: benchmarkConfig.value.bitrate,
        framerate: benchmarkConfig.value.framerate,
      })

      if (encoderSupport.supported) {
        supported.push(codec)
      }
    }
    catch (error) {
      console.warn(`Codec ${codec} check failed:`, error)
    }
  }

  supportedCodecs.value = supported

  // 如果当前选择的编解码器不支持新分辨率，选择第一个支持的
  if (!supported.includes(selectedCodec.value)) {
    selectedCodec.value = supported[0] || ''
  }
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

  // 重新检查编解码器支持，因为不同分辨率可能不支持某些编解码器
  if (isWebCodecsSupported.value) {
    checkSupportedCodecs()
  }
}

// 更新测试模式的函数
function updateTestMode(value: string) {
  if (value === 'grayscale' || value === 'grid-grayscale') {
    benchmarkConfig.value.testMode = value
    selectedTestMode.value = value
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
    suggestedName: 'webav-output.mp4',
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
    // 创建 MP4Clip 实例
    const mp4Clips = await Promise.all(
      uploadedVideos.value.map((video) => {
        const clip = new MP4Clip(video.stream())
        return clip.ready.then(() => clip)
      }),
    )

    const duration = (benchmarkConfig.value.maxFrames / benchmarkConfig.value.framerate) * 1000000

    // 根据测试模式创建相应的 Clip
    let processedClip
    if (benchmarkConfig.value.testMode === 'grid-grayscale') {
      // 四宫格模式需要 4 个视频
      if (mp4Clips.length < 4) {
        throw new Error('四宫格模式需要 4 个视频文件')
      }
      processedClip = new GridGrayscaleClip(
        benchmarkConfig.value.width,
        benchmarkConfig.value.height,
        duration,
        benchmarkConfig.value.framerate,
        mp4Clips[0]!,
        mp4Clips[1]!,
        mp4Clips[2]!,
        mp4Clips[3]!,
      )
    }
    else {
      // 灰度模式只需要 1 个视频
      if (mp4Clips.length < 1) {
        throw new Error('灰度模式需要 1 个视频文件')
      }
      processedClip = new GrayscaleClip(
        benchmarkConfig.value.width,
        benchmarkConfig.value.height,
        duration,
        benchmarkConfig.value.framerate,
        mp4Clips[0]!,
      )
    }

    // 创建 Combinator
    const combinator = new Combinator({
      width: benchmarkConfig.value.width,
      height: benchmarkConfig.value.height,
      fps: benchmarkConfig.value.framerate,
      videoCodec: selectedCodec.value,
      bitrate: benchmarkConfig.value.bitrate,
    })

    combinator.on('OutputProgress', (p) => {
      progress.value = p * 100
      const processedFrames = p * benchmarkConfig.value.maxFrames
      const currentTime = performance.now()
      if (currentTime > startTime && processedFrames > 0) {
        const elapsed = currentTime - startTime
        const fps = (processedFrames * 1000) / elapsed
        progressText.value = `正在处理... FPS: ${fps.toFixed(1)}`
      }
    })

    // 使用处理后的 Clip
    const sprite = new OffscreenSprite(processedClip)
    await sprite.ready
    sprite.time = { offset: 0, duration }

    await combinator.addSprite(sprite)

    // 写入文件
    const writableStream = await handle.createWritable()
    const reader = combinator.output().getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        await writableStream.write(new Uint8Array(value))
      }
    }
    finally {
      await writableStream.close()
    }

    const endTime = performance.now()
    result.totalTime = endTime - startTime
    result.totalFps = (benchmarkConfig.value.maxFrames * 1000) / result.totalTime
    result.success = true

    combinator.destroy()
  }
  catch (error) {
    result.error = (error as Error).message
  }

  return result
}

async function onRunButtonClick() {
  if (!isWebCodecsSupported.value || !selectedCodec.value) {
    return
  }

  const requiredVideoCount = benchmarkConfig.value.testMode === 'grid-grayscale' ? 4 : 1
  if (uploadedVideos.value.length !== requiredVideoCount) {
    uploadError.value = `请先上传 ${requiredVideoCount} 个视频文件`
    return
  }

  isRunning.value = true
  progress.value = 0
  uploadError.value = ''

  try {
    progressText.value = '测试中...'
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
  a.download = `webav-benchmark-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function onClearResultsButtonClick() {
  results.value = []
  progress.value = 0
  progressText.value = ''
}

onMounted(() => {
  if (typeof VideoEncoder !== 'undefined') {
    isWebCodecsSupported.value = true
    checkSupportedCodecs()
  }
  else {
    isWebCodecsSupported.value = false
  }
})
</script>

<template>
  <div class="min-h-screen bg-gray-900 text-white">
    <div class="container mx-auto p-4 max-w-7xl">
      <h1 class="text-4xl font-bold text-center mt-8 text-white">
        WebCodecs 性能测试（WebAV）
      </h1>

      <div class="mt-6">
        <div v-if="!isWebCodecsSupported" class="bg-red-900/50 border border-red-600 text-red-300 p-4 rounded-md">
          <strong>错误:</strong> 您的浏览器不支持 WebCodecs API 的视频编码功能。请使用支持 WebCodecs 的浏览器。
        </div>

        <div v-else-if="supportedCodecs.length === 0" class="bg-yellow-900/50 border border-yellow-600 text-yellow-300 p-4 rounded-md">
          <strong>警告:</strong> 未检测到支持的编码格式。
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
              v-if="supportedCodecs.length > 0"
              v-model="selectedCodec"
              :items="supportedCodecs"
              class="w-38"
              placeholder="选择要测试的编码器"
            />
            <div v-else class="text-gray-500 text-sm">
              正在检测...
            </div>
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
                  {{ result.config.testMode === 'grid-grayscale' ? '四宫格+灰度' : '灰度' }} / {{ result.config.codec }} / {{ result.config.width }}x{{ result.config.height }} / {{ result.config.framerate }}FPS / {{ result.config.bitrate ? `${(result.config.bitrate / 1000000).toFixed(1)} Mbps` : '-' }} / {{ result.config.keyFrameInterval }}秒 / {{ result.config.maxFrames }}帧
                </td>
                <td class="p-3 text-center whitespace-nowrap text-xs text-gray-300">
                  {{ result.totalTime.toFixed(1) }}
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
