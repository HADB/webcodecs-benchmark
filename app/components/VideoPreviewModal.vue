<script setup lang="ts">
interface VideoData {
  config: VideoEncoderConfig
  decoderConfig?: VideoDecoderConfig
  blob: Blob
}

interface TestConfig {
  width: number
  height: number
  framerate: number
}

interface Props {
  codec: string
  videoData: VideoData
  testConfig: TestConfig
}

const props = defineProps<Props>()

const previewVideo = ref<HTMLVideoElement | null>(null)
const videoObjectUrl = ref<string | null>(null)

// 当组件挂载时自动开始预览
onMounted(() => {
  nextTick(() => {
    startPreview()
  })
})

// 当组件卸载时停止预览和清理资源
onUnmounted(() => {
  cleanupResources()
})

function cleanupResources() {
  if (videoObjectUrl.value) {
    URL.revokeObjectURL(videoObjectUrl.value)
    videoObjectUrl.value = null
  }
}

async function startPreview() {
  // 清理之前的 URL
  if (videoObjectUrl.value) {
    URL.revokeObjectURL(videoObjectUrl.value)
  }

  // 创建对象 URL
  videoObjectUrl.value = URL.createObjectURL(props.videoData.blob)

  if (!previewVideo.value) {
    return
  }
  previewVideo.value.src = videoObjectUrl.value

  // 设置视频尺寸
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

  previewVideo.value.width = displayWidth
  previewVideo.value.height = displayHeight

  // 开始播放
  await previewVideo.value.play()
}
</script>

<template>
  <UModal :title="`视频预览 - ${props.codec}`">
    <template #body>
      <div class="space-y-4">
        <!-- 预览区域 -->
        <div class="flex justify-center bg-gray-100 dark:bg-gray-800">
          <video
            ref="previewVideo"
            class="max-w-full h-auto"
            controls
            preload="metadata"
          />
        </div>

        <!-- 视频信息 -->
        <div v-if="props.videoData" class="text-sm text-gray-600 dark:text-gray-400 space-y-1">
          <div class="flex justify-between">
            <span>分辨率:</span>
            <span>{{ props.testConfig.width }}x{{ props.testConfig.height }}</span>
          </div>
          <div class="flex justify-between">
            <span>帧率:</span>
            <span>{{ props.testConfig.framerate }} FPS</span>
          </div>
          <div v-if="props.videoData.blob" class="flex justify-between">
            <span>文件大小:</span>
            <span>{{ (props.videoData.blob.size / (1024 * 1024)).toFixed(2) }} MB</span>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
