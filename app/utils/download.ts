// 下载单个视频文件并显示进度
export const downloadVideoWithProgress = async (url: string, onProgress: (progress: number) => void): Promise<Blob> => {
  const response = await fetch(url)
  const contentLength = response.headers.get('content-length')
  const total = contentLength ? Number.parseInt(contentLength, 10) : 0

  if (!response.body) {
    throw new Error('Response body is null')
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let receivedLength = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    chunks.push(value)
    receivedLength += value.length
    const videoProgress = total > 0 ? (receivedLength / total) * 100 : 0

    onProgress(videoProgress)
  }

  // 合并所有chunks
  const chunksAll = new Uint8Array(receivedLength)
  let position = 0
  for (const chunk of chunks) {
    chunksAll.set(chunk, position)
    position += chunk.length
  }

  return new Blob([chunksAll])
}

// 下载多个视频文件并显示进度
export const downloadVideosWithProgress = async (
  urls: string[],
  onProgress: (progress: number, currentIndex: number) => void,
): Promise<Blob[]> => {
  const results: Blob[] = []

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]

    if (!url) {
      continue
    }

    const blob = await downloadVideoWithProgress(url, (videoProgress) => {
      const totalProgress = (i / urls.length) * 100 + (videoProgress / urls.length)
      onProgress(totalProgress, i)
    })

    results.push(blob)
  }

  return results
}
