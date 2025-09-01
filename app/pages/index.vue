<script lang="ts" setup>
import type { IClip } from '@webav/av-cliper'
import { Combinator, OffscreenSprite } from '@webav/av-cliper'
import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
} from 'mediabunny'

interface BenchmarkResult {
  name: string
  description: string
  totalFrames: number
  totalTime: number
  fps: number
  success: boolean
  error?: string
  fileSize?: number
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
const encodedVideos = ref<Map<string, { config: VideoEncoderConfig, decoderConfig?: VideoDecoderConfig, blob?: Blob }>>(new Map())

const testConfig = ref<TestConfig>({
  width: 1920,
  height: 1080,
  framerate: 30,
  bitrate: 4000000,
  keyFrameInterval: 3,
  totalFrames: 300,
})

const supportedCodecs = ref<string[]>([])
const userAgent = ref('')
const overlay = useOverlay()

// 分辨率选项
const resolutionOptions = ref(['1920x1080', '3840x2160'])
const selectedResolution = ref('1920x1080')

// 编码器选择选项
const selectedCodec = ref<string>('')

// 更新分辨率的函数
function updateResolution(value: string) {
  if (value === '1920x1080') {
    testConfig.value.width = 1920
    testConfig.value.height = 1080
  }
  else if (value === '3840x2160') {
    testConfig.value.width = 3840
    testConfig.value.height = 2160
  }

  // 重新检查编解码器支持，因为4K分辨率可能不支持某些编解码器
  if (isSupported.value) {
    checkSupportedCodecs()
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

  // 如果当前选择的编解码器不支持新分辨率，选择第一个支持的
  if (!supported.includes(selectedCodec.value)) {
    selectedCodec.value = supported[0] || ''
  }
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

// 通用的测试帧生成工具类
class TestFrameGenerator {
  private reusableCanvas: OffscreenCanvas | null = null
  private reusableCtx: OffscreenCanvasRenderingContext2D | null = null

  /**
   * 生成随机颜色
   */
  private generateRandomColor(): string {
    const r = Math.floor(Math.random() * 256)
    const g = Math.floor(Math.random() * 256)
    const b = Math.floor(Math.random() * 256)
    return `rgb(${r}, ${g}, ${b})`
  }

  /**
   * 获取或创建画布
   */
  private getCanvas(width: number, height: number): { canvas: OffscreenCanvas, ctx: OffscreenCanvasRenderingContext2D } {
    // 重用 canvas，避免频繁创建
    if (!this.reusableCanvas || this.reusableCanvas.width !== width || this.reusableCanvas.height !== height) {
      this.reusableCanvas = new OffscreenCanvas(width, height)
      this.reusableCtx = this.reusableCanvas.getContext('2d', { alpha: false })!
    }
    return { canvas: this.reusableCanvas, ctx: this.reusableCtx! }
  }

  /**
   * 创建用于 WebCodecs 的 VideoFrame
   */
  createVideoFrame(frameNumber: number, width: number, height: number, framerate: number): VideoFrame {
    const { canvas, ctx } = this.getCanvas(width, height)

    this.drawFrameContent(ctx, width, height, frameNumber, framerate)

    return new VideoFrame(canvas, {
      timestamp: frameNumber * (1000000 / framerate), // 微秒
    })
  }

  /**
   * 在已有的画布上绘制随机背景和文本信息（用于 mediabunny）
   */
  drawFrameContent(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number, frameNumber: number, framerate: number): void {
    // 绘制随机背景
    ctx.fillStyle = this.generateRandomColor()
    ctx.fillRect(0, 0, width, height)

    // 添加文本信息
    const time = frameNumber * (1000000 / framerate)
    ctx.fillStyle = 'white'
    ctx.font = '24px Arial'
    ctx.fillText(`Frame: ${frameNumber}`, 50, 50)
    ctx.fillText(`Time: ${(time / 1000000).toFixed(2)}s`, 50, 80)
  }

  /**
   * 创建新的画布并绘制随机背景和文本（用于 WebAV）
   */
  createCanvasWithContent(width: number, height: number, frameNumber: number, time: number): OffscreenCanvas {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { alpha: false })!
    this.drawFrameContent(ctx, width, height, frameNumber, time)

    return canvas
  }

  /**
   * 清理资源
   */
  destroy(): void {
    this.reusableCanvas = null
    this.reusableCtx = null
  }
}

// 创建全局的测试帧生成器实例
const testFrameGenerator = new TestFrameGenerator()

async function runEncodingBenchmark(codec: string, currentTestIndex: number, totalTests: number): Promise<BenchmarkResult> {
  const result: BenchmarkResult = {
    name: 'webcodecs-encoding',
    description: 'WebCodecs 纯编码',
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

          encodedVideos.value.set(result.name, {
            config: encoderConfig,
          })

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

      // 优化：为4K分辨率使用更小的批次，避免内存峰值和主线程阻塞
      const is4K = testConfig.value.width >= 3840 || testConfig.value.height >= 2160
      const batchSize = is4K ? 5 : 10 // 4K使用更小的批次
      let currentBatch = 0

      const encodeBatch = async () => {
        // 检查编码器状态
        if (encoder.state !== 'configured') {
          result.error = `Encoder is in invalid state: ${encoder.state}`
          resolve(result)
          return
        }

        const startIndex = currentBatch * batchSize
        const endIndex = Math.min(startIndex + batchSize, testConfig.value.totalFrames)

        for (let i = startIndex; i < endIndex; i++) {
          // 检查编码器状态和队列大小，避免过度堆积
          while (encoder.state === 'configured' && encoder.encodeQueueSize > (is4K ? 3 : 5)) {
            await new Promise((resolve) => setTimeout(resolve, 1))
          }

          // 再次检查编码器状态
          if (encoder.state !== 'configured') {
            result.error = `Encoder closed unexpectedly during encoding at frame ${i}`
            resolve(result)
            return
          }

          const frame = testFrameGenerator.createVideoFrame(i, testConfig.value.width, testConfig.value.height, testConfig.value.framerate)

          try {
            encoder.encode(frame, {
              keyFrame: i % (testConfig.value.keyFrameInterval * testConfig.value.framerate) === 0,
            })
          }
          catch (encodeError) {
            frame.close()
            result.error = `Encoding failed at frame ${i}: ${(encodeError as Error).message}`
            resolve(result)
            return
          }

          frame.close()
        }

        currentBatch++

        if (endIndex < testConfig.value.totalFrames) {
          // 为4K使用更长的延迟让出主线程控制权
          setTimeout(encodeBatch, is4K ? 5 : 0)
        }
        else {
          // 所有帧都已提交，开始 flush
          if (encoder.state === 'configured') {
            encoder.flush()
          }
          else {
            result.error = `Cannot flush encoder in state: ${encoder.state}`
            resolve(result)
          }
        }
      }

      // 等待配置完成后开始编码
      const startEncodingWhenReady = () => {
        if (encoder.state === 'configured') {
          encodeBatch()
        }
        else if (encoder.state === 'closed') {
          result.error = `Encoder configuration failed for ${codec} at ${testConfig.value.width}x${testConfig.value.height}. This resolution might not be supported.`
          resolve(result)
        }
        else {
          // 继续等待配置完成
          setTimeout(startEncodingWhenReady, 10)
        }
      }

      // 开始编码流程
      startEncodingWhenReady()
    }
    catch (error) {
      result.error = (error as Error).message
      resolve(result)
    }
  })
}

async function runMediaBunnyBenchmark(currentTestIndex: number, totalTests: number, selectedWebCodecsCodec: string): Promise<BenchmarkResult> {
  const result: BenchmarkResult = {
    name: 'mediabunny',
    description: 'MediaBunny 编码+封装',
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

      // 使用统一的测试帧生成器绘制完整内容（背景 + 文本）
      testFrameGenerator.drawFrameContent(renderCtx, renderCanvas.width, renderCanvas.height, currentFrame, frameRate)

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

    // 保存生成的视频文件大小
    if (target.buffer) {
      result.fileSize = target.buffer.byteLength

      // 保存视频数据用于下载
      const videoBlob = new Blob([target.buffer], { type: format.mimeType })
      encodedVideos.value.set('mediabunny', {
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

// 创建自定义的 WebAV Clip 类用于生成测试内容
class TestVideoClip implements IClip {
  #width: number
  #height: number
  #duration: number
  #framerate: number
  #reusableCanvas: OffscreenCanvas | null = null
  #reusableCtx: OffscreenCanvasRenderingContext2D | null = null

  meta: { width: number, height: number, duration: number }
  ready: Promise<{ width: number, height: number, duration: number }>

  constructor(width: number, height: number, duration: number, framerate: number) {
    this.#width = width
    this.#height = height
    this.#duration = duration
    this.#framerate = framerate

    this.meta = { width, height, duration }
    this.ready = Promise.resolve(this.meta)
  }

  /**
   * 获取或创建画布，复用避免频繁创建
   */
  #getCanvas(): { canvas: OffscreenCanvas, ctx: OffscreenCanvasRenderingContext2D } {
    if (!this.#reusableCanvas || this.#reusableCanvas.width !== this.#width || this.#reusableCanvas.height !== this.#height) {
      this.#reusableCanvas = new OffscreenCanvas(this.#width, this.#height)
      this.#reusableCtx = this.#reusableCanvas.getContext('2d', { alpha: false })!
    }
    return { canvas: this.#reusableCanvas, ctx: this.#reusableCtx! }
  }

  async tick(time: number): Promise<{
    video?: VideoFrame
    audio?: Float32Array[]
    state: 'success' | 'done'
  }> {
    if (time >= this.#duration) {
      return { state: 'done' }
    }

    // 使用复用的画布避免频繁创建
    const frameNumber = Math.floor(time / (1000000 / this.#framerate))
    const { canvas, ctx } = this.#getCanvas()

    // 使用统一的测试帧生成器绘制内容
    testFrameGenerator.drawFrameContent(ctx, this.#width, this.#height, frameNumber, this.#framerate)

    // 创建 VideoFrame
    const videoFrame = new VideoFrame(canvas, {
      timestamp: time,
      duration: 1000000 / this.#framerate, // 微秒为单位
    })

    return {
      video: videoFrame,
      state: 'success',
    }
  }

  async split(time: number) {
    const preClip = new TestVideoClip(this.#width, this.#height, time, this.#framerate)
    const postClip = new TestVideoClip(this.#width, this.#height, this.#duration - time, this.#framerate)
    return [preClip, postClip] as [this, this]
  }

  async clone() {
    return new TestVideoClip(this.#width, this.#height, this.#duration, this.#framerate) as this
  }

  destroy(): void {
    // 清理资源
    this.#reusableCanvas = null
    this.#reusableCtx = null
  }
}

async function runWebAVBenchmark(currentTestIndex: number, totalTests: number): Promise<BenchmarkResult> {
  const result: BenchmarkResult = {
    name: 'WebAV',
    description: 'WebAV 编码+封装',
    totalFrames: testConfig.value.totalFrames,
    totalTime: 0,
    fps: 0,
    success: false,
  }

  try {
    const startTime = performance.now()

    // 创建测试 Clip
    const duration = (testConfig.value.totalFrames / testConfig.value.framerate) * 1000000 // 微秒
    const testClip = new TestVideoClip(
      testConfig.value.width,
      testConfig.value.height,
      duration,
      testConfig.value.framerate,
    )

    // 创建 OffscreenSprite
    const sprite = new OffscreenSprite(testClip)
    await sprite.ready

    // 创建 Combinator
    const combinator = new Combinator({
      width: testConfig.value.width,
      height: testConfig.value.height,
      fps: testConfig.value.framerate,
      videoCodec: selectedCodec.value,
      bitrate: testConfig.value.bitrate,
      bgColor: '#000000',
    })

    combinator.on('OutputProgress', (p) => {
      // 更新进度
      progress.value = (currentTestIndex + p) / totalTests * 100
    })

    // 添加 sprite 到 combinator
    await combinator.addSprite(sprite, { main: true })

    // 获取输出流并转换为 blob
    const videoBlob = await new Response(combinator.output()).blob()

    const endTime = performance.now()
    result.totalTime = endTime - startTime
    result.fps = (testConfig.value.totalFrames * 1000) / result.totalTime
    result.success = true
    result.fileSize = videoBlob.size

    // 保存视频数据用于下载
    encodedVideos.value.set('WebAV', {
      config: {} as VideoEncoderConfig,
      blob: videoBlob,
    })

    // 清理资源
    combinator.destroy()
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

  // 计算总的测试数量（WebCodecs 编码测试 + mediabunny 测试 + WebAV 测试）
  const totalTests = 3
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
    currentTestIndex++
  }

  // 运行 mediabunny 测试
  try {
    currentTest.value = 'Testing mediabunny video generation...'
    const mediabunnyResult = await runMediaBunnyBenchmark(currentTestIndex, totalTests, selectedCodec.value)
    results.value.push(mediabunnyResult)
    currentTestIndex++
  }
  catch (error) {
    console.error('MediaBunny benchmark failed:', error)
    currentTestIndex++
  }

  // 运行 WebAV 测试
  try {
    currentTest.value = 'Testing WebAV video generation...'
    const webavResult = await runWebAVBenchmark(currentTestIndex, totalTests)
    results.value.push(webavResult)
  }
  catch (error) {
    console.error('WebAV benchmark failed:', error)
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
    // 如果是 mediabunny 或 WebAV 生成的视频，直接下载 blob
    if ((codec === 'mediabunny' || codec === 'WebAV') && videoData.blob) {
      const url = URL.createObjectURL(videoData.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${codec}-${testConfig.value.width}x${testConfig.value.height}-${Date.now()}.mp4`
      a.click()
      URL.revokeObjectURL(url)
    }
  }
  catch (error) {
    console.error('下载视频失败:', error)
  }
}

async function openVideoPreview(codec: string) {
  const videoData = encodedVideos.value.get(codec)
  if (!videoData || !videoData.blob) {
    console.error('未找到该编解码器的视频数据')
    return
  }

  try {
    // 动态导入组件并使用 overlay 打开模态框
    const { default: VideoPreviewModal } = await import('~/components/VideoPreviewModal.vue')
    const modal = overlay.create(VideoPreviewModal)

    const instance = modal.open({
      codec,
      videoData: videoData as any,
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

// 组件销毁时清理资源
onUnmounted(() => {
  testFrameGenerator.destroy()
})
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
            <label class="text-sm font-medium text-gray-300 whitespace-nowrap">关键帧(秒)</label>
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
              <tr v-for="result in results" :key="`${result.name}`" :class="result.success ? '' : 'bg-red-900/20'">
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                  {{ result.description }}
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
                  <div v-if="result.success && encodedVideos.has(result.name) && encodedVideos.get(result.name)?.blob" class="flex gap-2">
                    <UButton
                      size="xs"
                      color="info"
                      @click="downloadVideo(result.name)"
                    >
                      下载视频
                    </UButton>
                    <UButton
                      size="xs"
                      color="primary"
                      title="播放生成的视频"
                      @click="openVideoPreview(result.name)"
                    >
                      预览
                    </UButton>
                  </div>
                  <span v-else class="text-gray-500 text-xs">
                    {{ result.success ? (result.name !== 'mediabunny' && result.name !== 'WebAV' ? '仅性能测试' : '-') : '-' }}
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
