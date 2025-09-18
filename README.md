# WebCodecs Benchmark

### 测试 1

将 1080p 测试视频转成灰度，导出如下参数的视频，丢弃音轨，比较各自消耗时间。

- **视频分辨率**: 1920x1080
- **帧率**: 30 FPS
- **最高码率**: 8,000,000 bps
- **关键帧间隔**: 3S
- **总帧数**: 18000 帧 (600 秒)

### 性能对比

#### MacBook Pro M4 (macOS 26)

| 测试项        | FPS   |
| ------------- | ----- |
| MediaBunny    | 223.7 |
| WebAV         | 220.3 |
| ffmpeg 命令行 | 228.1 |

#### MacBook Pro M1 (macOS 26)

| 测试项        | FPS   |
| ------------- | ----- |
| MediaBunny    | 196.1 |
| WebAV         | 164.8 |
| ffmpeg 命令行 | 204.4 |

#### NVIDIA RTX 2080Ti (Windows 11)

| 测试项        | FPS   |
| ------------- | ----- |
| MediaBunny    | 282.3 |
| WebAV         | 286.5 |
| ffmpeg 命令行 | 420.6 |

#### NVIDIA RTX 3060 (Windows 10)

| 测试项        | FPS   |
| ------------- | ----- |
| MediaBunny    | 221.0 |
| WebAV         | 242.8 |
| ffmpeg 命令行 | 423.3 |

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
       ffmpeg_test1.mp4 -y -benchmark
```

### 测试 2

将四个 1080p 测试视频片段拼成四宫格，并转成灰度，导出如下参数的视频，丢弃音轨，比较各自消耗时间。

- **视频分辨率**: 3840x2160
- **帧率**: 30 FPS
- **最高码率**: 8,000,000 bps
- **关键帧间隔**: 3S
- **总帧数**: 3600 帧 (120 秒)

### 性能对比

#### MacBook Pro M4 (macOS 26)

| 测试项        | FPS  |
| ------------- | ---- |
| MediaBunny    | 60.3 |
| WebAV         | 58.9 |
| ffmpeg 命令行 | 60.6 |

#### MacBook Pro M1 (macOS 26)

| 测试项        | FPS  |
| ------------- | ---- |
| MediaBunny    | 55.4 |
| WebAV         | 48.9 |
| ffmpeg 命令行 | 56.0 |

#### NVIDIA RTX 2080Ti (Windows 11)

| 测试项        | FPS   |
| ------------- | ----- |
| MediaBunny    | 90.8  |
| WebAV         | 120.5 |
| ffmpeg 命令行 | 110.2 |

### NVIDIA RTX 3060 (Windows 10)

| 测试项        | FPS  |
| ------------- | ---- |
| MediaBunny    | 69.9 |
| WebAV         | 88.2 |
| ffmpeg 命令行 | 97.4 |

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
       ffmpeg_test2.mp4 -y -benchmark
```

准备四个测试视频片段：

```
# 第1段：0:00 - 2:00 (0-120秒)
ffmpeg -i bbb_sunflower_1080p_30fps.mp4 -ss 0 -t 120 -an -b:v 4000k -c:v h264_videotoolbox -g 90 -profile:v high -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv bbb_sunflower_1080p_30fps_part1.mp4 -y

# 第2段：2:00 - 4:00 (120-240秒)
ffmpeg -i bbb_sunflower_1080p_30fps.mp4 -ss 120 -t 120 -an -b:v 4000k -c:v h264_videotoolbox -g 90 -profile:v high -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv bbb_sunflower_1080p_30fps_part2.mp4 -y

# 第3段：4:00 - 6:00 (240-360秒)
ffmpeg -i bbb_sunflower_1080p_30fps.mp4 -ss 240 -t 120 -an -b:v 4000k -c:v h264_videotoolbox -g 90 -profile:v high -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv bbb_sunflower_1080p_30fps_part3.mp4 -y

# 第4段：6:00 - 8:00 (360-480秒)
ffmpeg -i bbb_sunflower_1080p_30fps.mp4 -ss 360 -t 120 -an -b:v 4000k -c:v h264_videotoolbox -g 90 -profile:v high -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv bbb_sunflower_1080p_30fps_part4.mp4 -y
```

```
ffmpeg -i  bbb_sunflower_1080p_30fps_part1.mp4 -c copy \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -bsf:v h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1 \
  bbb_sunflower_1080p_30fps_part1_new.mp4 -y
```
