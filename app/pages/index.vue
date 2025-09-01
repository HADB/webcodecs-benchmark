<script lang="ts" setup>
interface BenchmarkResult {
  codec: string
  operation: string
  totalFrames: number
  totalTime: number
  fps: number
  success: boolean
  error?: string
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
const encodedVideos = ref<Map<string, { chunks: EncodedVideoChunk[], config: VideoEncoderConfig, decoderConfig?: VideoDecoderConfig }>>(new Map())

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
  if (typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined') {
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

      const decoderSupport = await VideoDecoder.isConfigSupported({
        codec,
      })

      if (encoderSupport.supported && decoderSupport.supported) {
        supported.push(codec)
      }
    }
    catch (error) {
      console.warn(`Codec ${codec} check failed:`, error)
    }
  }

  supportedCodecs.value = supported
}

function generateTestFrame(frameNumber: number, width: number, height: number): VideoFrame {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  // 生成测试图案
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, `hsl(${(frameNumber * 5) % 360}, 70%, 50%)`)
  gradient.addColorStop(1, `hsl(${(frameNumber * 5 + 180) % 360}, 70%, 50%)`)

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  // 添加移动的图案
  ctx.fillStyle = 'white'
  ctx.font = '48px Arial'
  ctx.fillText(`Frame ${frameNumber}`, 50 + (frameNumber % 200), height / 2)

  // 绘制移动的圆形
  ctx.beginPath()
  ctx.arc(
    (frameNumber * 10) % width,
    (frameNumber * 7) % height,
    30,
    0,
    Math.PI * 2,
  )
  ctx.fillStyle = 'red'
  ctx.fill()

  return new VideoFrame(canvas, {
    timestamp: frameNumber * (1000000 / testConfig.value.framerate), // 微秒
  })
}

async function runEncodingBenchmark(codec: string, currentTestIndex: number, totalTests: number): Promise<BenchmarkResult> {
  return new Promise((resolve) => {
    const result: BenchmarkResult = {
      codec,
      operation: 'encoding',
      totalFrames: testConfig.value.totalFrames,
      totalTime: 0,
      fps: 0,
      success: false,
    }

    let encodedFrames = 0
    const startTime = performance.now()
    const chunks: EncodedVideoChunk[] = []

    const encoderConfig: VideoEncoderConfig = {
      codec,
      width: testConfig.value.width,
      height: testConfig.value.height,
      bitrate: testConfig.value.bitrate,
      framerate: testConfig.value.framerate,
    }

    const encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        // 保存编码的chunk
        chunks.push(chunk)
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

          // 保存编码的视频数据，包括解码器配置
          const videoData: { chunks: EncodedVideoChunk[], config: VideoEncoderConfig, decoderConfig?: VideoDecoderConfig } = {
            chunks: [...chunks],
            config: encoderConfig,
          }

          // 如果有解码器配置，也保存
          if (metadata?.decoderConfig) {
            videoData.decoderConfig = metadata.decoderConfig
          }

          encodedVideos.value.set(codec, videoData)

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

      // 生成并编码帧
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

async function runDecodingBenchmark(codec: string, currentTestIndex: number, totalTests: number): Promise<BenchmarkResult> {
  const result: BenchmarkResult = {
    codec,
    operation: 'decoding',
    totalFrames: testConfig.value.totalFrames,
    totalTime: 0,
    fps: 0,
    success: false,
  }

  try {
    // 首先进行编码以获得要解码的数据
    const encodedChunks: EncodedVideoChunk[] = []
    let decoderConfigFromEncoder: VideoDecoderConfig | null = null

    const encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        encodedChunks.push(chunk)
        // 保存解码器配置信息，特别是对于H.264/H.265
        if (metadata?.decoderConfig) {
          decoderConfigFromEncoder = metadata.decoderConfig
        }
      },
      error: (error) => {
        result.error = `Encoding phase failed: ${error.message}`
      },
    })

    encoder.configure({
      codec,
      width: testConfig.value.width,
      height: testConfig.value.height,
      bitrate: testConfig.value.bitrate,
      framerate: testConfig.value.framerate,
    })

    // 编码阶段
    for (let i = 0; i < testConfig.value.totalFrames; i++) {
      const frame = generateTestFrame(i, testConfig.value.width, testConfig.value.height)
      encoder.encode(frame, {
        keyFrame: i % testConfig.value.keyFrameInterval === 0,
      })
      frame.close()
    }

    await encoder.flush()
    encoder.close()

    // 解码阶段
    return new Promise((resolve) => {
      let decodedFrames = 0
      const startTime = performance.now()

      const decoder = new VideoDecoder({
        output: (frame) => {
          decodedFrames++
          // 计算当前测试在所有测试中的进度
          const testProgress = decodedFrames / testConfig.value.totalFrames
          const overallProgress = (currentTestIndex + testProgress) / totalTests
          progress.value = overallProgress * 100
          frame.close()

          if (decodedFrames === testConfig.value.totalFrames) {
            const endTime = performance.now()
            result.totalTime = endTime - startTime
            result.fps = (testConfig.value.totalFrames * 1000) / result.totalTime
            result.success = true
            resolve(result)
          }
        },
        error: (error) => {
          result.error = `Decoding phase failed: ${error.message}`
          resolve(result)
        },
      }) // 创建解码器配置
      let decoderConfig: VideoDecoderConfig = { codec }

      // 优先使用编码器提供的解码器配置
      if (decoderConfigFromEncoder) {
        decoderConfig = decoderConfigFromEncoder
      }
      // 对于 H.264 和 H.265，如果没有从编码器获取到配置，尝试从关键帧提取
      else if (codec.startsWith('avc1') || codec.startsWith('hev1')) {
        const keyFrameChunk = encodedChunks.find((chunk) => chunk.type === 'key')
        if (keyFrameChunk && keyFrameChunk.byteLength > 0) {
          try {
            // 复制chunk数据作为description
            const buffer = new ArrayBuffer(keyFrameChunk.byteLength)
            keyFrameChunk.copyTo(buffer)
            decoderConfig.description = buffer
          }
          catch (error) {
            console.warn(`Failed to extract description for ${codec}:`, error)
          }
        }
      }

      decoder.configure(decoderConfig)

      // 解码所有chunk
      for (const chunk of encodedChunks) {
        decoder.decode(chunk)
      }

      decoder.flush().then(() => {
        decoder.close()
      }).catch((error) => {
        result.error = `Decoder flush failed: ${error.message}`
        resolve(result)
      })
    })
  }
  catch (error) {
    result.error = (error as Error).message
    return result
  }
}

async function runBenchmarks() {
  if (!isSupported.value || supportedCodecs.value.length === 0) {
    return
  }

  isRunning.value = true
  results.value = []
  progress.value = 0

  // 计算总的测试数量（每个编解码器有编码和解码两个测试）
  const totalTests = supportedCodecs.value.length * 2
  let currentTestIndex = 0

  for (const codec of supportedCodecs.value) {
    try {
      currentTest.value = `Testing ${codec} encoding...`
      const encodingResult = await runEncodingBenchmark(codec, currentTestIndex, totalTests)
      results.value.push(encodingResult)
      currentTestIndex++

      currentTest.value = `Testing ${codec} decoding...`
      const decodingResult = await runDecodingBenchmark(codec, currentTestIndex, totalTests)
      results.value.push(decodingResult)
      currentTestIndex++
    }
    catch (error) {
      console.error(`Benchmark failed for ${codec}:`, error)
      currentTestIndex += 2 // 跳过编码和解码测试
    }
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
  a.download = `webcodecs-benchmark-${Date.now()}.json`
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
        WebCodecs Benchmark
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
          <strong>错误:</strong> 您的浏览器不支持 WebCodecs API。请使用支持 WebCodecs 的浏览器。
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
          :disabled="!isSupported || supportedCodecs.length === 0 || isRunning"
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
          基准测试结果
        </h2>

        <div class="overflow-x-auto">
          <table class="min-w-full">
            <thead class="bg-gray-700">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 tracking-wider">
                  编解码器
                </th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 tracking-wider">
                  操作
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
                  {{ result.codec }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                  {{ result.operation === 'encoding' ? '编码' : '解码' }}
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
                <td class="px-6 py-4 whitespace-nowrap">
                  <span v-if="result.success" class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-900/50 text-green-300 border border-green-600">
                    成功
                  </span>
                  <span v-else class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-900/50 text-red-300 border border-red-600" :title="result.error">
                    失败
                  </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <div v-if="result.operation === 'encoding' && result.success && encodedVideos.has(result.codec)" class="flex gap-2">
                    <UButton
                      size="xs"
                      color="info"
                      @click="downloadVideo(result.codec)"
                    >
                      下载视频
                    </UButton>
                    <UButton
                      size="xs"
                      color="primary"
                      :title="(result.codec.startsWith('avc1') || result.codec.startsWith('hev1')) ? 'H.264/H.265使用重新生成的帧进行预览' : '解码原始视频帧进行预览'"
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
