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

| 测试项                       | 总耗时 (ms)       | FPS    | 文件大小 (KB) |
| ---------------------------- | ----------------- | ------ | ------------- |
| MediaBunny                   | 77246.60 (+4.97%) | 233.02 | 14549         |
| WebAV                        | 77995.10 (+5.99%) | 230.78 | 19666         |
| Python + ffmpeg              | 76747.93 (+4.29%) | 234.53 | 13264         |
| ffmpeg 命令行                | 76930.0 (+4.54%)  | 233.98 | 12717         |
| [基准] ffmpeg 命令行生成纯黑 | 73590.0 (+0.00%)  | 244.60 | 1684          |

#### MacBook Pro M1 (TBD)

| 测试项                       | 总耗时 (ms) | FPS | 文件大小 (KB) |
| ---------------------------- | ----------- | --- | ------------- |
| MediaBunny                   |             |     |               |
| WebAV                        |             |     |               |
| Python + ffmpeg              |             |     |               |
| ffmpeg 命令行                |             |     |               |
| [基准] ffmpeg 命令行生成纯黑 |             |     |               |

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

生成测试视频：

```
ffmpeg -f lavfi -i color=c=black:s=1920x1080:r=30:d=600 \
-vf "drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf: \
text='Frame\: %{n}': x=700: y=500: fontsize=100: fontcolor=white: box=0" \
-c:v h264_videotoolbox -b:v 4000000 -g 90 -keyint_min 90 -pix_fmt yuv420p \
ffmpeg.mp4 -y
```

生成纯黑基准视频：

```
ffmpeg -f lavfi -i color=c=black:s=1920x1080:r=30:d=600 -c:v h264_videotoolbox -b:v 4000000 -g 90 -keyint_min 9 -pix_fmt yuv420p -y ffmpeg_baseline.mp4
```
