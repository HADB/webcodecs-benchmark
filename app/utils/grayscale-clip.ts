import type { IClip, MP4Clip } from '@webav/av-cliper'
import type { WebGLRenderer } from './webgl'
import { getWebGLRenderer } from './webgl'

export class GrayscaleClip implements IClip {
  #width: number
  #height: number
  #duration: number
  #framerate: number
  #offscreenCanvas: OffscreenCanvas
  #clips: MP4Clip[]
  #renderer: WebGLRenderer

  meta: { width: number, height: number, duration: number }
  ready: Promise<{ width: number, height: number, duration: number }>

  constructor(width: number, height: number, duration: number, framerate: number, clips: MP4Clip[]) {
    this.#width = width
    this.#height = height
    this.#duration = duration
    this.#framerate = framerate
    this.#clips = clips

    this.#offscreenCanvas = new OffscreenCanvas(this.#width, this.#height)

    // 在构造函数中获取并初始化渲染器，避免每次tick时重复操作
    this.#renderer = getWebGLRenderer()
    this.#renderer.initialize(this.#width, this.#height)

    this.meta = { width, height, duration }
    this.ready = Promise.resolve(this.meta)
  }

  async tick(time: number): Promise<{
    video?: VideoFrame
    audio?: Float32Array[]
    state: 'success' | 'done'
  }> {
    if (time >= this.#duration) {
      return { state: 'done' }
    }

    // 统一获取所有clips的结果
    const results = await Promise.all(
      this.#clips.map((clip) => clip.tick(time)),
    )

    if (results.some((result) => result.state === 'done') || results.some((result) => !result.video)) {
      results.forEach((result) => result.video?.close())
      return { state: 'success' }
    }

    const videoFrames = results.map((result) => result.video!)

    if (this.#clips.length === 1) {
      this.#renderer.renderGrayscaleFrame(videoFrames[0]!, this.#offscreenCanvas)
    }
    else {
      this.#renderer.renderGridGrayscaleFrame(videoFrames, this.#offscreenCanvas)
    }

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
    const preClip = new GrayscaleClip(this.#width, this.#height, time, this.#framerate, this.#clips)
    const postClip = new GrayscaleClip(this.#width, this.#height, this.#duration - time, this.#framerate, this.#clips)
    return [preClip, postClip] as [this, this]
  }

  async clone() {
    return new GrayscaleClip(this.#width, this.#height, this.#duration, this.#framerate, this.#clips) as this
  }

  destroy(): void {
    // WebGL 渲染器由全局管理，这里不需要手动清理
  }
}
