# WebCodecs Benchmark

### 测试方式

每帧背景色为黑色，并绘制当前帧数，最终生成如下参数的视频，比较各种方式的消耗时间。

- **视频分辨率**: 1920x1080
- **帧率**: 30 FPS
- **最高码率**: 4,000,000 bps
- **关键帧间隔**: 3
- **总帧数**: 18000 帧 (600 秒)

### 性能对比

#### MacBook Pro M4

| 测试项                       | 总耗时 (ms) | FPS    | 文件大小 (MB) |
| ---------------------------- | ----------- | ------ | ------------- |
| MediaBunny                   | 77246.60    | 233.02 | 14.21         |
| WebAV                        | 77995.10    | 230.78 | 19.21         |
| Python + ffmpeg              | 76747.93    | 234.53 | 12.95         |
| ffmpeg 命令行                | 76930.00    | 233.98 | 12.42         |
| [基准] ffmpeg 命令行生成纯黑 | 73590.00    | 244.60 | 1.64          |

#### MacBook Pro M1

| 测试项                       | 总耗时 (ms) | FPS    | 文件大小 (MB) |
| ---------------------------- | ----------- | ------ | ------------- |
| MediaBunny                   | 86119.30    | 209.01 | 14.06         |
| WebAV                        | 87076.30    | 206.72 | 19.05         |
| Python + ffmpeg              | 108512.33   | 165.88 | 12.57         |
| ffmpeg 命令行                | 86101.00    | 209.06 | 12.20         |
| [基准] ffmpeg 命令行生成纯黑 | 85753.00    | 209.91 | 1.64          |

#### 12th Gen Intel(R) Core(TM) i7-12700 + NVIDIA GeForce RTX 2080 Ti

| 测试项                                  | GPU Encoder 利用率 | 总耗时 (ms) | FPS    | 文件大小 (MB) |
| -------------------------------------- | ------------------ | ----------- | ------ | ------------- |
| MediaBunny                             | 59%                | 57644.40    | 312.26 | 22.55         |
| WebAV                                  | 81%                | 37854.50    | 475.50 | 36.63         |
| Python + ffmpeg (WSL2 Ubuntu)          | 58%                | 98929.38    | 181.95 | 17.70         |
| Python + ffmpeg (Windows) TBD.         | -                  | -           | -      | -             |
| ffmpeg 命令行 (WSL2 Ubuntu)             | 100%               | 40053.00    | 449.40 | 16.60         |
| ffmpeg 命令行 (Windows)                 | 100%               | 39859.00    | 451.59 | 17.10         |
| ffmpeg 命令行生成纯黑 (WSL2 Ubuntu)      | 100%               | 40004.00    | 449.96 | 1.67          |
| [基准] ffmpeg 命令行生成纯黑 (Windows)    | 100%               | 39792.00    | 452.35 | 1.67          |

- 备注：看了下 WebAV 源码，初步分析了其性能在该设备上性能领先的原因：
  - WebAV 起了两个 encoder，在这个场景下提高了 GPU Encoder 的利用率，性能比 MediaBunny 单个 encoder 更好
  - 帧生成方面，WebAV 上采用了并行生成，性能高于 ffmpeg drawtext 逐帧生成，ffmpeg drawtext 输出帧的效率可能跟不上 encoder 处理的效率

TODO: 这个场景下还得看看怎么再控制变量尽可能公平测试。

### 前端启动命令

```
corepack enable # 启用 corepack
pnpm i  # 安装依赖
pnpm dev # 启动
```

### Python 启动命令

```
brew install pyenv # 安装 pyenv，如有可跳过
pyenv install 3.13 # 安装 python 3.13，如有可跳过
brew install pipx # 安装 pipx，如有可跳过
pipx install poetry # 安装 poetry，如有可跳过
poetry config virtualenvs.in-project true  # 配置 poetry
poetry config virtualenvs.prompt "venv_{python_version}"  # 配置 poetry
cd baseline
eval $(poetry env activate) # 激活当前虚拟环境
poetry install # 安装依赖
python main.py # 启动
```

### ffmpeg 命令

#### 生成测试视频：

##### macOS

```
ffmpeg -f lavfi -i color=c=black:s=1920x1080:r=30:d=600 \
-vf "drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf: \
text='Frame\: %{n}': x=700: y=500: fontsize=100: fontcolor=white: box=0" \
-c:v h264_videotoolbox -b:v 4000000 -g 90 -keyint_min 90 -pix_fmt yuv420p \
ffmpeg.mp4 -y -benchmark
```

##### Windows Nvidia

```
./ffmpeg.exe -f lavfi -i color=c=black:s=1920x1080:r=30:d=600 \
-vf "drawtext=fontfile='C\:/Windows/Fonts/arial.ttf': \
text='Frame\: %{n}': x=700: y=500: fontsize=100: fontcolor=white: box=0" \
-c:v h264_nvenc -b:v 4000000 -g 90 -keyint_min 90 -pix_fmt yuv420p \
ffmpeg.mp4 -y -benchmark

```

##### WSL2 Nvidia

```
ffmpeg -f lavfi -i color=c=black:s=1920x1080:r=30:d=600 \
-vf "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf: \
text='Frame\: %{n}': x=700: y=500: fontsize=100: fontcolor=white: box=0" \
-c:v h264_nvenc -b:v 4000k -g 90 -keyint_min 90 -pix_fmt yuv420p \
ffmpeg.mp4 -y -benchmark

```

#### 生成纯黑基准视频：

##### macOS

```
ffmpeg -f lavfi -i color=c=black:s=1920x1080:r=30:d=600 -c:v h264_videotoolbox -b:v 4000000 -g 90 -keyint_min 9 -pix_fmt yuv420p ffmpeg_baseline.mp4 -y -benchmark
```

##### Windows Nvidia

```
./ffmpeg.exe -f lavfi -i color=c=black:s=1920x1080:r=30:d=600 -c:v h264_nvenc -b:v 4000000 -g 90 -keyint_min 9 -pix_fmt yuv420p ffmpeg_baseline.mp4 -y -benchmark
```

##### WSL2 Ubuntu Nvidia

```
ffmpeg -f lavfi -i color=c=black:s=1920x1080:r=30:d=600 -c:v h264_nvenc -b:v 4000000 -g 90 -keyint_min 9 -pix_fmt yuv420p ffmpeg_baseline.mp4 -y -benchmark
```
