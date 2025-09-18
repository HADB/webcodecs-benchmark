declare global {
  interface Window {
    showSaveFilePicker: (options: any) => Promise<FileSystemFileHandle>
  }
}

export interface BenchmarkConfig {
  width: number
  height: number
  codec: string
  framerate: number
  bitrate: number
  keyFrameInterval: number
  maxFrames: number
  testMode?: 'grayscale' | 'grid-grayscale'
}

export interface BenchmarkResult {
  startTime: string
  totalFrames: number
  totalTime: number
  demuxTime?: number
  remuxTime?: number
  decodeTime?: number
  renderTime?: number
  encodeTime?: number
  totalFps: number
  success: boolean
  error?: string
  config: BenchmarkConfig
}

export interface WebGLContext {
  gl: WebGLRenderingContext
  program: WebGLProgram
  positionLocation: number
  texCoordLocation: number
  textureLocations: (WebGLUniformLocation | null)[]
  positionBuffer: WebGLBuffer | null
  texCoordBuffer: WebGLBuffer | null
  textures: WebGLTexture[]
  cleanup: () => void
}
