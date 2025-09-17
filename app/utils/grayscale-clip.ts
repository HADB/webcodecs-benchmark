import type { IClip, MP4Clip } from '@webav/av-cliper'
import { getWebGLRenderer } from './webgl'

export class GrayscaleClip implements IClip {
  #width: number
  #height: number
  #duration: number
  #framerate: number
  #offscreenCanvas: OffscreenCanvas
  #sourceClip: MP4Clip

  meta: { width: number, height: number, duration: number }
  ready: Promise<{ width: number, height: number, duration: number }>

  constructor(width: number, height: number, duration: number, framerate: number, sourceClip: MP4Clip) {
    this.#width = width
    this.#height = height
    this.#duration = duration
    this.#framerate = framerate
    this.#sourceClip = sourceClip
    this.#offscreenCanvas = new OffscreenCanvas(this.#width, this.#height)

    this.meta = { width, height, duration }
    this.ready = Promise.resolve(this.meta)
  }

  /**
   * 绘制帧内容
   */
  private drawFrameContent(videoFrame: VideoFrame): void {
    const renderer = getWebGLRenderer()
    renderer.initialize(this.#width, this.#height)

    // 使用新的渲染器 API
    renderer.renderGrayscaleFrame(videoFrame, this.#offscreenCanvas)
  }

  async tick(time: number): Promise<{
    video?: VideoFrame
    audio?: Float32Array[]
    state: 'success' | 'done'
  }> {
    if (time >= this.#duration) {
      return { state: 'done' }
    }

    const { state, video: videoFrame } = await this.#sourceClip.tick(time)

    if (state === 'done' || !videoFrame) {
      return { state: 'success' }
    }

    this.drawFrameContent(videoFrame)

    const outputVideoFrame = new VideoFrame(this.#offscreenCanvas!, {
      timestamp: time,
      duration: 1000000 / this.#framerate, // 微秒为单位
    })
    return {
      video: outputVideoFrame,
      state: 'success',
    }
  }

  async split(time: number) {
    const preClip = new GrayscaleClip(this.#width, this.#height, time, this.#framerate, this.#sourceClip)
    const postClip = new GrayscaleClip(this.#width, this.#height, this.#duration - time, this.#framerate, this.#sourceClip)
    return [preClip, postClip] as [this, this]
  }

  async clone() {
    return new GrayscaleClip(this.#width, this.#height, this.#duration, this.#framerate, this.#sourceClip) as this
  }

  destroy(): void {
    // WebGL 渲染器由全局管理，这里不需要手动清理
  }
}
