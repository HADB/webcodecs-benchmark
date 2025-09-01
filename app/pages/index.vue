<script lang="ts" setup>
import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
} from 'mediabunny'

interface BenchmarkResult {
  codec: string
  operation: string
  totalFrames: number
  totalTime: number
  fps: number
  success: boolean
  error?: string
  fileSize?: number // 添加文件大小字段（用于 mediabunny）
  actualCodec?: string // 添加实际使用的编码器字段（用于 mediabunny）
}

interface TestConfig {
  width: number
  height: number
  framerate: number
  bitrate: number
  keyFrameInterval: number
  totalFrames: number
}

const isSupported = ref(false)
const isRunning = ref(false)
const results = ref<BenchmarkResult[]>([])
const currentTest = ref('')
const progress = ref(0)
const encodedVideos = ref<Map<string, { chunks: EncodedVideoChunk[], config: VideoEncoderConfig, decoderConfig?: VideoDecoderConfig, blob?: Blob }>>(new Map())

const testConfig = ref<TestConfig>({
  width: 1920,
  height: 1080,
  framerate: 30,
  bitrate: 8000000,
  keyFrameInterval: 30,
  totalFrames: 300,
})

const supportedCodecs = ref<string[]>([])
const userAgent = ref('')
const overlay = useOverlay()

// 分辨率选项
const resolutionOptions = ref(['1920x1080', '1280x720'])
const selectedResolution = ref('1920x1080')

// 编码器选择选项
const selectedCodec = ref<string>('')

// 更新分辨率的函数
function updateResolution(value: string) {
  if (value === '1920x1080') {
    testConfig.value.width = 1920
    testConfig.value.height = 1080
  }
  else if (value === '1280x720') {
    testConfig.value.width = 1280
    testConfig.value.height = 720
  }
}

// 检查 WebCodecs 支持
onMounted(() => {
  checkWebCodecsSupport()
  userAgent.value = window.navigator.userAgent
})

function checkWebCodecsSupport() {
  if (typeof VideoEncoder !== 'undefined') {
    isSupported.value = true
    checkSupportedCodecs()
  }
  else {
    isSupported.value = false
  }
}

async function checkSupportedCodecs() {
  const codecs = [
    'avc1.42E01E',
    'avc1.4D401E',
    'avc1.64001E',
    'avc1.640028',
    'hev1.1.6.L93.B0',
    'vp8',
    'vp09.00.10.08',
    'av01.0.04M.08',
  ]

  const supported: string[] = []

  for (const codec of codecs) {
    try {
      const encoderSupport = await VideoEncoder.isConfigSupported({
        codec,
        width: testConfig.value.width,
        height: testConfig.value.height,
        bitrate: testConfig.value.bitrate,
        framerate: testConfig.value.framerate,
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
  // 默认选择第一个支持的编码器
  selectedCodec.value = supported[0] || ''
}

// 将 WebCodecs 编码器名称映射到 mediabunny 支持的编码器名称
function mapToMediabunnyCodec(webCodecsCodec: string): 'avc' | 'hevc' | 'vp8' | 'vp9' | 'av1' | null {
  if (webCodecsCodec.startsWith('avc1.')) {
    return 'avc'
  }
  else if (webCodecsCodec.startsWith('hev1.')) {
    return 'hevc'
  }
  else if (webCodecsCodec === 'vp8') {
    return 'vp8'
  }
  else if (webCodecsCodec.startsWith('vp09.')) {
    return 'vp9'
  }
  else if (webCodecsCodec.startsWith('av01.')) {
    return 'av1'
  }
  return null
}

// 优化：创建可重用的 canvas
let reusableCanvas: OffscreenCanvas | null = null
let reusableCtx: OffscreenCanvasRenderingContext2D | null = null

function generateTestFrame(frameNumber: number, width: number, height: number): VideoFrame {
  // 重用 canvas，避免频繁创建
  if (!reusableCanvas || reusableCanvas.width !== width || reusableCanvas.height !== height) {
    reusableCanvas = new OffscreenCanvas(width, height)
    reusableCtx = reusableCanvas.getContext('2d', { alpha: false })!
  }

  // 直接生成随机颜色
  const r = Math.floor(Math.random() * 256)
  const g = Math.floor(Math.random() * 256)
  const b = Math.floor(Math.random() * 256)
  const color = `rgb(${r}, ${g}, ${b})`

  // 填充整个画布为随机纯色
  reusableCtx!.fillStyle = color
  reusableCtx!.fillRect(0, 0, width, height)

  return new VideoFrame(reusableCanvas, {
    timestamp: frameNumber * (1000000 / testConfig.value.framerate), // 微秒
  })
}

async function runEncodingBenchmark(codec: string, currentTestIndex: number, totalTests: number): Promise<BenchmarkResult> {
  const result: BenchmarkResult = {
    codec,
    operation: 'encoding',
    totalFrames: testConfig.value.totalFrames,
    totalTime: 0,
    fps: 0,
    success: false,
  }

  return new Promise((resolve) => {
    let encodedFrames = 0
    const startTime = performance.now()

    const encoderConfig: VideoEncoderConfig = {
      codec,
      width: testConfig.value.width,
      height: testConfig.value.height,
      bitrate: testConfig.value.bitrate,
      framerate: testConfig.value.framerate,
    }

    const encoder = new VideoEncoder({
      output: () => {
        encodedFrames++
        // 计算当前测试在所有测试中的进度
        const testProgress = encodedFrames / testConfig.value.totalFrames
        const overallProgress = (currentTestIndex + testProgress) / totalTests
        progress.value = overallProgress * 100

        if (encodedFrames === testConfig.value.totalFrames) {
          const endTime = performance.now()
          result.totalTime = endTime - startTime
          result.fps = (testConfig.value.totalFrames * 1000) / result.totalTime
          result.success = true

          resolve(result)
        }
      },
      error: (error) => {
        result.error = error.message
        resolve(result)
      },
    })

    try {
      encoder.configure(encoderConfig)

      // 直接编码所有帧，让编码器自己处理队列
      for (let i = 0; i < testConfig.value.totalFrames; i++) {
        const frame = generateTestFrame(i, testConfig.value.width, testConfig.value.height)

        encoder.encode(frame, {
          keyFrame: i % testConfig.value.keyFrameInterval === 0,
        })

        frame.close()
      }

      encoder.flush()
    }
    catch (error) {
      result.error = (error as Error).message
      resolve(result)
    }
  })
}

async function runMediaBunnyBenchmark(currentTestIndex: number, totalTests: number, selectedWebCodecsCodec: string): Promise<BenchmarkResult> {
  const result: BenchmarkResult = {
    codec: 'mediabunny',
    operation: 'mediabunny-generation',
    totalFrames: testConfig.value.totalFrames,
    totalTime: 0,
    fps: 0,
    success: false,
  }

  try {
    const startTime = performance.now()

    // 创建离屏 Canvas 用于渲染
    const renderCanvas = new OffscreenCanvas(testConfig.value.width, testConfig.value.height)
    const renderCtx = renderCanvas.getContext('2d', { alpha: false })!

    // 创建输出对象
    const target = new BufferTarget()
    const format = new Mp4OutputFormat()
    const output = new Output({ target, format })

    // 尝试使用对应的 mediabunny 编码器
    const preferredCodec = mapToMediabunnyCodec(selectedWebCodecsCodec)
    let videoCodec = null

    if (preferredCodec) {
      // 检查 mediabunny 是否支持对应的编码器
      const supportedCodecs = output.format.getSupportedVideoCodecs()
      if (supportedCodecs.includes(preferredCodec)) {
        try {
          // 尝试验证编码器是否可用
          const testConfig = {
            width: renderCanvas.width,
            height: renderCanvas.height,
          }
          videoCodec = await getFirstEncodableVideoCodec([preferredCodec], testConfig)
        }
        catch (error) {
          console.warn(`Preferred codec ${preferredCodec} failed validation:`, error)
          videoCodec = null
        }
      }
    }

    // 如果首选编码器不可用，则使用第一个可用的编码器
    if (!videoCodec) {
      videoCodec = await getFirstEncodableVideoCodec(output.format.getSupportedVideoCodecs(), {
        width: renderCanvas.width,
        height: renderCanvas.height,
      })
    }

    console.log('Selected mediabunny codec:', videoCodec, 'for WebCodecs codec:', selectedWebCodecsCodec)

    if (!videoCodec) {
      throw new Error('Your browser doesn\'t support video encoding with mediabunny.')
    }

    // 创建 Canvas 源
    const canvasSource = new CanvasSource(renderCanvas, {
      codec: videoCodec,
      bitrate: testConfig.value.bitrate,
      keyFrameInterval: testConfig.value.keyFrameInterval,
    })

    const frameRate = testConfig.value.framerate
    output.addVideoTrack(canvasSource, { frameRate })

    await output.start()

    let currentFrame = 0
    const totalFrames = testConfig.value.totalFrames

    // 渲染所有帧
    for (currentFrame = 0; currentFrame < totalFrames; currentFrame++) {
      const currentTime = currentFrame / frameRate

      // 清除画布
      renderCtx.clearRect(0, 0, renderCanvas.width, renderCanvas.height)

      // 生成随机纯色背景（参考 baseline/main.py 的方式）
      const r = Math.floor(Math.random() * 256)
      const g = Math.floor(Math.random() * 256)
      const b = Math.floor(Math.random() * 256)

      renderCtx.fillStyle = `rgb(${r}, ${g}, ${b})`
      renderCtx.fillRect(0, 0, renderCanvas.width, renderCanvas.height)

      // 更新进度
      const testProgress = currentFrame / totalFrames
      const overallProgress = (currentTestIndex + testProgress) / totalTests
      progress.value = overallProgress * 100

      // 添加当前帧到视频
      await canvasSource.add(currentTime, 1 / frameRate)
    }

    // 关闭 canvas 源
    canvasSource.close()

    // 完成输出
    await output.finalize()

    const endTime = performance.now()
    result.totalTime = endTime - startTime
    result.fps = (totalFrames * 1000) / result.totalTime
    result.success = true
    result.actualCodec = videoCodec // 保存实际使用的编码器

    // 保存生成的视频文件大小
    if (target.buffer) {
      result.fileSize = target.buffer.byteLength

      // 保存视频数据用于下载
      const videoBlob = new Blob([target.buffer], { type: format.mimeType })
      encodedVideos.value.set('mediabunny', {
        chunks: [], // mediabunny 不使用 chunks
        config: {} as VideoEncoderConfig,
        blob: videoBlob, // 直接保存 blob
      })
    }
  }
  catch (error) {
    result.error = (error as Error).message
  }

  return result
}

async function runBenchmarks() {
  if (!isSupported.value || !selectedCodec.value) {
    return
  }

  isRunning.value = true
  results.value = []
  progress.value = 0

  // 计算总的测试数量（选中的编解码器的编码测试 + mediabunny 测试）
  const totalTests = 2 // 1个编码器 + mediabunny
  let currentTestIndex = 0

  // 测试选中的编码器
  try {
    currentTest.value = `Testing ${selectedCodec.value} encoding...`
    const encodingResult = await runEncodingBenchmark(selectedCodec.value, currentTestIndex, totalTests)
    results.value.push(encodingResult)
    currentTestIndex++
  }
  catch (error) {
    console.error(`Benchmark failed for ${selectedCodec.value}:`, error)
    currentTestIndex++ // 跳过当前编码测试
  }

  // 运行 mediabunny 测试
  try {
    currentTest.value = 'Testing mediabunny video generation...'
    const mediabunnyResult = await runMediaBunnyBenchmark(currentTestIndex, totalTests, selectedCodec.value)
    results.value.push(mediabunnyResult)
  }
  catch (error) {
    console.error('MediaBunny benchmark failed:', error)
  }

  currentTest.value = 'Benchmark completed!'
  isRunning.value = false
  progress.value = 100
}

function exportResults() {
  const data = {
    timestamp: new Date().toISOString(),
    testConfig: testConfig.value,
    results: results.value,
    userAgent: userAgent.value,
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `webcodecs-encoding-benchmark-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

async function downloadVideo(codec: string) {
  const videoData = encodedVideos.value.get(codec)
  if (!videoData) {
    console.error('未找到该编解码器的视频数据')
    return
  }

  try {
    // 如果是 mediabunny 生成的视频，直接下载 blob
    if (codec === 'mediabunny' && videoData.blob) {
      const url = URL.createObjectURL(videoData.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mediabunny-${testConfig.value.width}x${testConfig.value.height}-${Date.now()}.mp4`
      a.click()
      URL.revokeObjectURL(url)
      return
    }

    // 创建 MP4 容器（简化版本，实际生产中可能需要更复杂的 MP4 muxer）
    const chunks = videoData.chunks
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)

    // 创建一个简单的字节数组来存储所有编码数据
    const buffer = new ArrayBuffer(totalSize)
    let offset = 0

    for (const chunk of chunks) {
      chunk.copyTo(buffer.slice(offset, offset + chunk.byteLength))
      offset += chunk.byteLength
    }

    // 获取文件扩展名
    let extension = 'mp4'
    if (codec.startsWith('vp8') || codec.startsWith('vp9')) {
      extension = 'webm'
    }
    else if (codec.startsWith('av01')) {
      extension = 'mp4' // AV1 也可以用 mp4 容器
    }

    const blob = new Blob([buffer], { type: `video/${extension}` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${codec}-${testConfig.value.width}x${testConfig.value.height}-${Date.now()}.${extension}`
    a.click()
    URL.revokeObjectURL(url)
  }
  catch (error) {
    console.error('下载视频失败:', error)
  }
}

async function openVideoPreview(codec: string) {
  const videoData = encodedVideos.value.get(codec)
  if (!videoData) {
    console.error('未找到该编解码器的视频数据')
    return
  }

  try {
    // 动态导入组件并使用 overlay 打开模态框
    const { default: VideoPreviewModal } = await import('~/components/VideoPreviewModal.vue')
    const modal = overlay.create(VideoPreviewModal)

    const instance = modal.open({
      codec,
      videoData,
      testConfig: testConfig.value,
    })

    // 等待模态框关闭
    await instance.result
  }
  catch (error) {
    console.error('打开视频预览失败:', error)
  }
}

function clearResults() {
  results.value = []
  progress.value = 0
  currentTest.value = ''
  encodedVideos.value.clear()
}
</script>

<template>
  <div class="min-h-screen bg-gray-900 text-white">
    <div class="container mx-auto p-6 max-w-6xl">
      <h1 class="text-4xl font-bold text-center mb-8 text-white">
        WebCodecs 编码性能测试
      </h1>
      <!-- 系统信息 -->
      <div class="mt-6 bg-gray-800 p-4 rounded-lg border border-gray-700">
        <h3 class="text-lg font-semibold mb-2 text-white">
          系统信息
        </h3>
        <p class="text-sm text-gray-400">
          {{ userAgent }}
        </p>
      </div>
      <!-- 支持状态检查 -->
      <div class="mt-6">
        <div v-if="!isSupported" class="bg-red-900/50 border border-red-600 text-red-300 px-4 py-3 rounded-lg">
          <strong>错误:</strong> 您的浏览器不支持 WebCodecs API 的视频编码功能。请使用支持 WebCodecs 的浏览器。
        </div>

        <div v-else-if="supportedCodecs.length === 0" class="bg-yellow-900/50 border border-yellow-600 text-yellow-300 px-4 py-3 rounded-lg">
          <strong>警告:</strong> 未检测到支持的编解码器。
        </div>

        <div v-else class="bg-green-900/50 border border-green-600 text-green-300 px-4 py-3 rounded-lg">
          <strong>支持的编解码器: </strong>
          <span v-for="(codec, index) in supportedCodecs" :key="codec">
            {{ codec }}{{ index < supportedCodecs.length - 1 ? ', ' : '' }}
          </span>
        </div>
      </div>

      <!-- 测试配置 -->
      <div class="bg-gray-800 p-6 rounded-lg mt-6 border border-gray-700">
        <h2 class="text-lg font-semibold mb-4 text-white">
          测试配置
        </h2>

        <!-- 编码器选择 -->
        <div class="mb-4">
          <div class="flex items-center gap-2">
            <label class="text-sm font-medium text-gray-300 whitespace-nowrap">选择编码器</label>
            <USelect
              v-if="supportedCodecs.length > 0"
              v-model="selectedCodec"
              :items="supportedCodecs"
              class="w-48"
              placeholder="选择要测试的编码器"
            />
            <div v-else class="text-gray-500 text-sm">
              正在检测支持的编码器...
            </div>
          </div>
        </div>

        <div class="grid grid-cols-5 gap-4">
          <div class="flex items-center gap-2">
            <label class="text-sm font-medium text-gray-300 whitespace-nowrap">分辨率</label>
            <USelect
              v-model="selectedResolution"
              :items="resolutionOptions"
              class="w-32"
              @update:model-value="updateResolution"
            />
          </div>
          <div class="flex items-center gap-2">
            <label class="text-sm font-medium text-gray-300 whitespace-nowrap">帧率</label>
            <UInput v-model.number="testConfig.framerate" type="number" :min="1" :max="120" class="w-32" />
          </div>
          <div class="flex items-center gap-2">
            <label class="text-sm font-medium text-gray-300 whitespace-nowrap">比特率</label>
            <UInput v-model.number="testConfig.bitrate" type="number" :min="100000" :max="50000000" class="w-32" />
          </div>
          <div class="flex items-center gap-2">
            <label class="text-sm font-medium text-gray-300 whitespace-nowrap">关键帧</label>
            <UInput v-model.number="testConfig.keyFrameInterval" type="number" :min="1" :max="120" class="w-32" />
          </div>
          <div class="flex items-center gap-2">
            <label class="text-sm font-medium text-gray-300 whitespace-nowrap">总帧数</label>
            <UInput v-model.number="testConfig.totalFrames" type="number" :min="30" :max="1800" class="w-32" />
          </div>
        </div>
      </div>

      <!-- 控制按钮 -->
      <div class="flex gap-4 mt-6">
        <UButton
          :disabled="!isSupported || !selectedCodec || isRunning"
          color="primary"
          size="lg"
          @click="runBenchmarks"
        >
          {{ isRunning ? '运行中...' : '开始测试' }}
        </UButton>

        <UButton
          :disabled="isRunning || results.length === 0"
          color="neutral"
          size="lg"
          @click="clearResults"
        >
          清除结果
        </UButton>

        <UButton
          :disabled="results.length === 0"
          color="success"
          size="lg"
          @click="exportResults"
        >
          导出结果
        </UButton>
      </div>

      <!-- 进度显示 -->
      <div v-if="isRunning" class="mb-6">
        <div class="text-center mb-2 text-gray-300">
          {{ currentTest }}
        </div>
        <div class="w-full bg-gray-700 rounded-full h-3">
          <div class="bg-blue-600 h-3 rounded-full transition-all duration-300" :style="{ width: `${progress}%` }" />
        </div>
        <div class="text-center text-sm text-gray-400 mt-1">
          {{ Math.round(progress) }}%
        </div>
      </div>

      <!-- 结果显示 -->
      <div v-if="results.length > 0" class="mt-6 bg-gray-800 rounded-lg shadow-lg overflow-hidden border border-gray-700">
        <h2 class="text-2xl font-semibold p-6 bg-gray-700 border-b border-gray-600 text-white">
          编码性能测试结果
        </h2>

        <div class="overflow-x-auto">
          <table class="min-w-full">
            <thead class="bg-gray-700">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 tracking-wider">
                  编解码器
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 tracking-wider">
                  操作类型
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 tracking-wider">
                  帧数
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 tracking-wider">
                  耗时 (ms)
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 tracking-wider">
                  FPS
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 tracking-wider">
                  文件大小
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 tracking-wider">
                  状态
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody class="bg-gray-800 divide-y divide-gray-700">
              <tr v-for="result in results" :key="`${result.codec}-${result.operation}`" :class="result.success ? '' : 'bg-red-900/20'">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                  <div v-if="result.codec === 'mediabunny'" class="flex flex-col">
                    <span>{{ result.codec }}</span>
                    <span v-if="result.actualCodec" class="text-xs text-gray-400">(使用: {{ result.actualCodec }})</span>
                  </div>
                  <span v-else>{{ result.codec }}</span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                  {{ result.operation === 'mediabunny-generation' ? 'MediaBunny 视频生成' : 'WebCodecs 编码' }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                  {{ result.totalFrames }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                  {{ result.totalTime.toFixed(2) }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                  {{ result.fps.toFixed(2) }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                  {{ result.fileSize ? `${(result.fileSize / (1024 * 1024)).toFixed(2)} MB` : '-' }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <span v-if="result.success" class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-900/50 text-green-300 border border-green-600">
                    成功
                  </span>
                  <span v-else class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-900/50 text-red-300 border border-red-600" :title="result.error">
                    失败
                  </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <div v-if="result.success && (encodedVideos.has(result.codec) || result.codec === 'mediabunny')" class="flex gap-2">
                    <UButton
                      size="xs"
                      color="info"
                      @click="downloadVideo(result.codec)"
                    >
                      下载视频
                    </UButton>
                    <UButton
                      v-if="result.codec !== 'mediabunny'"
                      size="xs"
                      color="primary"
                      title="自动播放编码后的视频帧"
                      @click="openVideoPreview(result.codec)"
                    >
                      预览
                    </UButton>
                  </div>
                  <span v-else class="text-gray-500 text-xs">
                    -
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
