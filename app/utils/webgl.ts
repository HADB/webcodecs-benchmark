import type { WebGLContext } from '~~/types'

// WebGL 灰度滤镜相关函数
export function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) {
    return null
  }

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('着色器编译错误:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }

  return shader
}

export function createProgram(gl: WebGLRenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram | null {
  const program = gl.createProgram()
  if (!program) {
    return null
  }

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('程序链接错误:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }

  return program
}

export function setupWebGLGrayscale(canvas: OffscreenCanvas): WebGLContext {
  const gl = canvas.getContext('webgl') as WebGLRenderingContext
  if (!gl) {
    throw new Error('无法获取 WebGL 上下文')
  }

  // 顶点着色器源码
  const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `

  // 片段着色器源码（灰度滤镜）
  const fragmentShaderSource = `
    precision mediump float;
    uniform sampler2D u_texture;
    varying vec2 v_texCoord;
    
    void main() {
      vec4 color = texture2D(u_texture, v_texCoord);
      // 使用标准灰度转换公式
      float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      gl_FragColor = vec4(gray, gray, gray, color.a);
    }
  `

  // 创建着色器
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)

  if (!vertexShader || !fragmentShader) {
    throw new Error('着色器创建失败')
  }

  // 创建程序
  const program = createProgram(gl, vertexShader, fragmentShader)
  if (!program) {
    throw new Error('WebGL 程序创建失败')
  }

  // 获取属性和统一变量位置
  const positionLocation = gl.getAttribLocation(program, 'a_position')
  const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord')
  const textureLocations = [gl.getUniformLocation(program, 'u_texture')]

  // 创建缓冲区
  const positionBuffer = gl.createBuffer()
  const texCoordBuffer = gl.createBuffer()
  const textures = [gl.createTexture()]

  // 设置顶点位置（全屏四边形）
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1,
    -1,
    1,
    -1,
    -1,
    1,
    1,
    1,
  ]), gl.STATIC_DRAW)

  // 设置纹理坐标
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    0,
    1,
    1,
    1,
    0,
    0,
    1,
    0,
  ]), gl.STATIC_DRAW)

  return {
    gl,
    program,
    positionLocation,
    texCoordLocation,
    textureLocations,
    positionBuffer,
    texCoordBuffer,
    textures,
    cleanup: () => {
      // 清理 WebGL 资源
      const loseContext = gl.getExtension('WEBGL_lose_context')
      if (loseContext) {
        loseContext.loseContext()
      }

      // 清理 WebGL 资源
      gl.deleteProgram(program)
      gl.deleteBuffer(positionBuffer)
      gl.deleteBuffer(texCoordBuffer)
      textures.forEach((texture) => {
        gl.deleteTexture(texture)
      })
    },
  }
}

export function renderGrayscaleFrame(
  webglContext: WebGLContext,
  videoFrame: VideoFrame,
  width: number,
  height: number,
  targetCanvas: OffscreenCanvas,
) {
  const { gl, program, positionLocation, texCoordLocation, textureLocations, positionBuffer, texCoordBuffer, textures } = webglContext

  const targetContext = targetCanvas.getContext('2d')

  if (!targetContext) {
    videoFrame.close()
    return
  }

  // 设置视口
  gl.viewport(0, 0, width, height)

  // 使用程序
  gl.useProgram(program)

  const texture = textures[0]
  const textureLocation = textureLocations[0]
  if (texture && textureLocation && videoFrame) {
    // 绑定并上传纹理
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoFrame)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    // 设置顶点属性
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer)
    gl.enableVertexAttribArray(texCoordLocation)
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0)

    // 设置纹理单元
    gl.uniform1i(textureLocation, 0)

    // 清除画布并绘制
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // 将 WebGL 画布内容复制到目标画布
    targetContext.drawImage(webglContext.gl.canvas, 0, 0)
  }

  videoFrame.close()
}

// 四宫格WebGL渲染设置
export function setupWebGLGridGrayscale(canvas: OffscreenCanvas): WebGLContext {
  const gl = canvas.getContext('webgl') as WebGLRenderingContext
  if (!gl) {
    throw new Error('无法获取 WebGL 上下文')
  }

  // 顶点着色器源码
  const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `

  // 片段着色器源码（四宫格灰度滤镜）
  const fragmentShaderSource = `
    precision mediump float;
    uniform sampler2D u_texture1;
    uniform sampler2D u_texture2;
    uniform sampler2D u_texture3;
    uniform sampler2D u_texture4;
    varying vec2 v_texCoord;
    
    void main() {
      vec4 color;
      vec2 gridCoord;
      
      // 确定当前像素属于哪个象限
      if (v_texCoord.x < 0.5 && v_texCoord.y < 0.5) {
        // 左下象限 - texture1
        gridCoord = vec2(v_texCoord.x * 2.0, v_texCoord.y * 2.0);
        color = texture2D(u_texture1, gridCoord);
      } else if (v_texCoord.x >= 0.5 && v_texCoord.y < 0.5) {
        // 右下象限 - texture2
        gridCoord = vec2((v_texCoord.x - 0.5) * 2.0, v_texCoord.y * 2.0);
        color = texture2D(u_texture2, gridCoord);
      } else if (v_texCoord.x < 0.5 && v_texCoord.y >= 0.5) {
        // 左上象限 - texture3
        gridCoord = vec2(v_texCoord.x * 2.0, (v_texCoord.y - 0.5) * 2.0);
        color = texture2D(u_texture3, gridCoord);
      } else {
        // 右上象限 - texture4
        gridCoord = vec2((v_texCoord.x - 0.5) * 2.0, (v_texCoord.y - 0.5) * 2.0);
        color = texture2D(u_texture4, gridCoord);
      }
      
      // 应用灰度转换
      float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      gl_FragColor = vec4(gray, gray, gray, color.a);
    }
  `

  // 创建着色器
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)

  if (!vertexShader || !fragmentShader) {
    throw new Error('着色器创建失败')
  }

  // 创建程序
  const program = createProgram(gl, vertexShader, fragmentShader)
  if (!program) {
    throw new Error('WebGL 程序创建失败')
  }

  // 获取属性和统一变量位置
  const positionLocation = gl.getAttribLocation(program, 'a_position')
  const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord')
  const textureLocations = [gl.getUniformLocation(program, 'u_texture1'), gl.getUniformLocation(program, 'u_texture2'), gl.getUniformLocation(program, 'u_texture3'), gl.getUniformLocation(program, 'u_texture4')]
  // 创建缓冲区和纹理
  const positionBuffer = gl.createBuffer()
  const texCoordBuffer = gl.createBuffer()
  const textures = [gl.createTexture(), gl.createTexture(), gl.createTexture(), gl.createTexture()]

  // 设置顶点位置（全屏四边形）
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1,
    -1,
    1,
    -1,
    -1,
    1,
    1,
    1,
  ]), gl.STATIC_DRAW)

  // 设置纹理坐标
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    0,
    1,
    1,
    1,
    0,
    0,
    1,
    0,
  ]), gl.STATIC_DRAW)

  return {
    gl,
    program,
    positionLocation,
    texCoordLocation,
    textureLocations,
    positionBuffer,
    texCoordBuffer,
    textures,
    cleanup: () => {
      // 清理 WebGL 资源
      const loseContext = gl.getExtension('WEBGL_lose_context')
      if (loseContext) {
        loseContext.loseContext()
      }
    },
  }
}

export function renderGridGrayscaleFrame(
  webglContext: WebGLContext,
  videoFrames: VideoFrame[],
  width: number,
  height: number,
  targetCanvas: OffscreenCanvas,
) {
  const {
    gl,
    program,
    positionLocation,
    texCoordLocation,
    textureLocations,
    positionBuffer,
    texCoordBuffer,
    textures,
  } = webglContext

  const targetContext = targetCanvas.getContext('2d')

  if (!targetContext) {
    return
  }

  // 设置视口
  gl.viewport(0, 0, width, height)

  // 使用程序
  gl.useProgram(program)

  for (let i = 0; i < 4; i++) {
    const texture = textures[i]
    const textureLocation = textureLocations[i]

    const videoFrame = videoFrames[i]
    if (!texture || !textureLocation || !videoFrame) {
      videoFrame?.close()
      continue
    }

    gl.activeTexture(gl.TEXTURE0 + i)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoFrame)
    videoFrame.close()
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.uniform1i(textureLocation, i)
  }

  // 设置顶点属性
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer)
  gl.enableVertexAttribArray(texCoordLocation)
  gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0)

  // 清除画布并绘制
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

  // 将 WebGL 画布内容复制到目标画布
  targetContext.drawImage(webglContext.gl.canvas, 0, 0)
}
