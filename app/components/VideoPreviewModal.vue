<script setup lang="ts">
interface VideoData {
  chunks: EncodedVideoChunk[]
  config: VideoEncoderConfig
  decoderConfig?: VideoDecoderConfig
}

interface TestConfig {
  width: number
  height: number
  framerate: number
}

interface Props {
  codec: string
  videoData: VideoData | null
  testConfig: TestConfig
}

const props = defineProps<Props>()

const previewCanvas = ref<HTMLCanvasElement | null>(null)
const isPreviewPlaying = ref(false)
const previewProgress = ref(0)
const previewError = ref('')

// 当组件挂载时自动开始预览
onMounted(() => {
  nextTick(() => {
    startPreview()
  })
})

// 当组件卸载时停止预览
onUnmounted(() => {
  stopPreview()
})

async function startPreview() {
  if (!props.videoData || !previewCanvas.value) {
    previewError.value = '未找到视频数据或预览画布'
    return
  }

  try {
    isPreviewPlaying.value = true
    previewError.value = ''

    const canvas = previewCanvas.value
    const ctx = canvas.getContext('2d')!

    // 设置画布尺寸，限制最大显示尺寸
    const maxDisplayWidth = 640
    const maxDisplayHeight = 480
    const aspectRatio = props.testConfig.width / props.testConfig.height

    let displayWidth = props.testConfig.width
    let displayHeight = props.testConfig.height

    if (displayWidth > maxDisplayWidth) {
      displayWidth = maxDisplayWidth
      displayHeight = displayWidth / aspectRatio
    }

    if (displayHeight > maxDisplayHeight) {
      displayHeight = maxDisplayHeight
      displayWidth = displayHeight * aspectRatio
    }

    canvas.width = displayWidth
    canvas.height = displayHeight

    const chunks = props.videoData.chunks
    const decodedFrames: VideoFrame[] = []

    // 创建解码器配置
    let decoderConfig: VideoDecoderConfig = { codec: props.codec }

    // 优先使用编码时保存的解码器配置
    if (props.videoData.decoderConfig) {
      decoderConfig = props.videoData.decoderConfig
      console.log(`Using saved decoder config for ${props.codec}`)
    }

    let decoder: VideoDecoder | null = null
    let decoderClosed = false

    // 首先解码所有帧
    await new Promise<void>((resolve, reject) => {
      let processedFrames = 0

      decoder = new VideoDecoder({
        output: (frame) => {
          decodedFrames.push(frame)
          processedFrames++

          if (processedFrames >= chunks.length) {
            resolve()
          }
        },
        error: (error) => {
          console.error(`Decoder error for ${props.codec}:`, error)
          if (!decoderClosed) {
            decoder?.close()
            decoderClosed = true
          }
          reject(error)
        },
      })

      try {
        decoder.configure(decoderConfig)

        for (const chunk of chunks) {
          decoder.decode(chunk)
        }

        decoder.flush().then(() => {
          if (!decoderClosed) {
            decoder?.close()
            decoderClosed = true
          }
          resolve()
        }).catch((flushError) => {
          console.error(`Decoder flush error for ${props.codec}:`, flushError)
          if (!decoderClosed) {
            decoder?.close()
            decoderClosed = true
          }
          reject(flushError)
        })
      }
      catch (configError) {
        console.error(`Decoder configuration error for ${props.codec}:`, configError)
        if (!decoderClosed) {
          decoder?.close()
          decoderClosed = true
        }
        reject(configError)
      }
    })

    // 播放解码的帧
    const frameDelay = 1000 / props.testConfig.framerate
    for (let i = 0; i < decodedFrames.length && isPreviewPlaying.value; i++) {
      const frame = decodedFrames[i]
      if (frame) {
        ctx.drawImage(frame, 0, 0, canvas.width, canvas.height)
      }

      // 更新进度
      previewProgress.value = ((i + 1) / decodedFrames.length) * 100

      if (i < decodedFrames.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, frameDelay))
      }
    }

    // 清理帧
    decodedFrames.forEach((frame) => frame.close())

    if (isPreviewPlaying.value) {
      isPreviewPlaying.value = false
      previewProgress.value = 100
    }
  }
  catch (error) {
    console.error('预览视频失败:', error)
    previewError.value = `预览失败: ${error instanceof Error ? error.message : '未知错误'}`
    isPreviewPlaying.value = false
    previewProgress.value = 0
  }
}

function stopPreview() {
  isPreviewPlaying.value = false
  previewProgress.value = 0
  previewError.value = ''
  if (previewCanvas.value) {
    const ctx = previewCanvas.value.getContext('2d')!
    ctx.clearRect(0, 0, previewCanvas.value.width, previewCanvas.value.height)
  }
}
</script>

<template>
  <UModal :title="`视频预览 - ${props.codec}`">
    <template #body>
      <div class="space-y-4">
        <!-- 预览画布 -->
        <div class="flex justify-center bg-gray-100 dark:bg-gray-800 rounded-lg p-4">
          <canvas
            ref="previewCanvas"
            class="max-w-full h-auto border border-gray-300 dark:border-gray-600 rounded shadow-sm"
            :class="{ 'opacity-50': !isPreviewPlaying }"
          />
        </div>

        <!-- 进度条 -->
        <div v-if="isPreviewPlaying || previewProgress > 0" class="space-y-2">
          <UProgress v-model="previewProgress" :max="100" />
        </div>

        <!-- 控制按钮 -->
        <div class="flex justify-center gap-3">
          <UButton
            v-if="!isPreviewPlaying && previewProgress === 0"
            color="primary"
            icon="i-heroicons-play"
            @click="startPreview"
          >
            重新预览
          </UButton>
          <UButton
            v-else-if="isPreviewPlaying"
            color="error"
            icon="i-heroicons-stop"
            @click="stopPreview"
          >
            停止预览
          </UButton>
          <UButton
            v-else
            color="primary"
            icon="i-heroicons-arrow-path"
            @click="startPreview"
          >
            重新预览
          </UButton>
        </div>

        <!-- 错误信息 -->
        <div v-if="previewError" class="space-y-2">
          <UAlert
            icon="i-heroicons-exclamation-triangle"
            color="error"
            variant="soft"
            title="预览错误"
            :description="previewError"
          />
          <div class="flex justify-center">
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              @click="previewError = ''"
            >
              关闭错误信息
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
