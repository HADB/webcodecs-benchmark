import type { IClip, MP4Clip } from '@webav/av-cliper'
import { getWebGLRenderer } from './webgl'

export class GridGrayscaleClip implements IClip {
  #width: number
  #height: number
  #duration: number
  #framerate: number
  #offscreenCanvas: OffscreenCanvas
  #part1Clip: MP4Clip
  #part2Clip: MP4Clip
  #part3Clip: MP4Clip
  #part4Clip: MP4Clip

  meta: { width: number, height: number, duration: number }
  ready: Promise<{ width: number, height: number, duration: number }>

  constructor(width: number, height: number, duration: number, framerate: number, part1Clip: MP4Clip, part2Clip: MP4Clip, part3Clip: MP4Clip, part4Clip: MP4Clip) {
    this.#width = width
    this.#height = height
    this.#duration = duration
    this.#framerate = framerate
    this.#part1Clip = part1Clip
    this.#part2Clip = part2Clip
    this.#part3Clip = part3Clip
    this.#part4Clip = part4Clip
    this.#offscreenCanvas = new OffscreenCanvas(this.#width, this.#height)

    this.meta = { width, height, duration }
    this.ready = Promise.resolve(this.meta)
  }

  /**
   * 绘制帧内容
   */
  private drawFrameContent(frames: VideoFrame[]): void {
    const renderer = getWebGLRenderer()
    renderer.initialize(this.#width, this.#height)

    // 使用新的渲染器 API
    renderer.renderGridGrayscaleFrame(frames, this.#offscreenCanvas)
  }

  async tick(time: number): Promise<{
    video?: VideoFrame
    audio?: Float32Array[]
    state: 'success' | 'done'
  }> {
    if (time >= this.#duration) {
      return { state: 'done' }
    }

    const [
      { state: state1, video: videoFrame1 },
      { state: state2, video: videoFrame2 },
      { state: state3, video: videoFrame3 },
      { state: state4, video: videoFrame4 },
    ] = await Promise.all([
      this.#part1Clip.tick(time),
      this.#part2Clip.tick(time),
      this.#part3Clip.tick(time),
      this.#part4Clip.tick(time),
    ])

    if (state1 === 'done' || state2 === 'done' || state3 === 'done' || state4 === 'done' || !videoFrame1 || !videoFrame2 || !videoFrame3 || !videoFrame4) {
      return { state: 'success' }
    }

    this.drawFrameContent([videoFrame1, videoFrame2, videoFrame3, videoFrame4])

    const videoFrame = new VideoFrame(this.#offscreenCanvas!, {
      timestamp: time,
      duration: 1000000 / this.#framerate, // 微秒为单位
    })
    return {
      video: videoFrame,
      state: 'success',
    }
  }

  async split(time: number) {
    const preClip = new GridGrayscaleClip(this.#width, this.#height, time, this.#framerate, this.#part1Clip, this.#part2Clip, this.#part3Clip, this.#part4Clip)
    const postClip = new GridGrayscaleClip(this.#width, this.#height, this.#duration - time, this.#framerate, this.#part1Clip, this.#part2Clip, this.#part3Clip, this.#part4Clip)
    return [preClip, postClip] as [this, this]
  }

  async clone() {
    return new GridGrayscaleClip(this.#width, this.#height, this.#duration, this.#framerate, this.#part1Clip, this.#part2Clip, this.#part3Clip, this.#part4Clip) as this
  }

  destroy(): void {
    // WebGL 渲染器由全局管理，这里不需要手动清理
  }
}
