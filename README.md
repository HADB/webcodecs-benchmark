# WebCodecs Benchmark

### 测试 1

将 1080p 测试视频转成灰度，导出如下参数的视频，比较消耗时间（丢弃音轨）。

- **视频分辨率**: 1920x1080
- **帧率**: 30 FPS
- **最高码率**: 8,000,000 bps
- **关键帧间隔**: 3S
- **总帧数**: 3600 帧 (120 秒)

### 性能对比

#### MacBook Pro M4

| 测试项        | 总耗时 (ms) | FPS   |
| ------------- | ----------- | ----- |
| WebCodecs     | 15861.5     | 227.0 |
| ffmpeg 命令行 | 15626.0     | 230.4 |

#### MacBook Pro M1

| 测试项        | 总耗时 (ms) | FPS   |
| ------------- | ----------- | ----- |
| WebCodecs     | 17954.5     | 200.4 |
| ffmpeg 命令行 | 17415.0     | 206.7 |

#### 12th Gen Intel(R) Core(TM) i7-12700 + NVIDIA GeForce RTX 2080 Ti

| 测试项        | 总耗时 (ms) | FPS   |
| ------------- | ----------- | ----- |
| WebCodecs     | 12516.1     | 287.5 |
| ffmpeg 命令行 | 8670.0      | 415.2 |

> 注： 该设备在执行 WebCodecs 测试时，GPU Encoder 占用只有 52% 左右，ffmpeg 测试时，GPU Encoder 占用 100%。

### 前端启动命令

```
corepack enable # 启用 corepack
pnpm i  # 安装依赖
pnpm dev # 启动
```

访问 `http://localhost:8888/` 进行测试。

### ffmpeg 命令

```
ffmpeg -i bbb_sunflower_1080p_30fps_part1.mp4 \
       -vf "lutyuv='u=128:v=128'" \
       -t 120 \
       -c:v h264_videotoolbox -b:v 8000k -level 4.0 -g 90 \
       -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv -pix_fmt yuv420p \
       .output/ffmpeg_test1_1080p.mp4 -y -benchmark
```

> 注：NVIDIA GPU 使用 `-c:v h264_nvenc`

### 测试 2

将四个 1080p 测试视频片段拼成四宫格，并转成灰度，导出如下参数的视频，比较消耗时间（丢弃音轨）。

- **视频分辨率**: 3840x2160
- **帧率**: 30 FPS
- **最高码率**: 8,000,000 bps
- **关键帧间隔**: 3S
- **总帧数**: 3600 帧 (120 秒)

### 性能对比

#### MacBook Pro M4

| 测试项        | 总耗时 (ms) | FPS  |
| ------------- | ----------- | ---- |
| WebCodecs     | 59789.1     | 60.2 |
| ffmpeg 命令行 | 59392.0     | 60.6 |

#### MacBook Pro M1

| 测试项        | 总耗时 (ms) | FPS  |
| ------------- | ----------- | ---- |
| WebCodecs     | 64947.0     | 55.4 |
| ffmpeg 命令行 | 64080.0     | 56.2 |

#### 12th Gen Intel(R) Core(TM) i7-12700 + NVIDIA GeForce RTX 2080 Ti

| 测试项        | 总耗时 (ms) | FPS   |
| ------------- | ----------- | ----- |
| WebCodecs     | 40128.0     | 89.7  |
| ffmpeg 命令行 | 31952.0     | 112.7 |

> 注： 与测试 1 类似，该设备在执行 WebCodecs 测试时，GPU Encoder 利用率未打满。

### 前端启动命令

```
corepack enable # 启用 corepack
pnpm i  # 安装依赖
pnpm dev # 启动
```

### ffmpeg 命令

```
ffmpeg -i bbb_sunflower_1080p_30fps_part1.mp4 \
       -i bbb_sunflower_1080p_30fps_part2.mp4 \
       -i bbb_sunflower_1080p_30fps_part3.mp4 \
       -i bbb_sunflower_1080p_30fps_part4.mp4 \
       -filter_complex \
       "[0:v]setpts=PTS-STARTPTS[v0]; \
        [1:v]setpts=PTS-STARTPTS[v1]; \
        [2:v]setpts=PTS-STARTPTS[v2]; \
        [3:v]setpts=PTS-STARTPTS[v3]; \
        [v0][v1][v2][v3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[v_merged]; \
        [v_merged]lutyuv='u=128:v=128'[v]" \
       -map "[v]" \
       -t 120 \
       -c:v h264_videotoolbox -b:v 8000k -level 5.1 -g 90 \
       -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv -pix_fmt yuv420p \
       .output/ffmpeg_test2_4k.mp4 -y -benchmark
```

> 注：NVIDIA GPU 使用 `-c:v h264_nvenc`

### 附：测试视频

https://github.com/user-attachments/assets/6151fc00-4e1c-43dc-8cd6-fcba36b5b8bf

https://github.com/user-attachments/assets/f3ea28d6-6ee7-4c5b-8827-091fbe1ab7f3

https://github.com/user-attachments/assets/81a0dfa1-c122-47ca-a451-6a3b558e3082

https://github.com/user-attachments/assets/0f0852ae-45c3-4b99-93fd-4fa3ade34aa9
