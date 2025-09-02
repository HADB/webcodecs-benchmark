# WebCodecs Benchmark

### 测试方式 1

每帧背景色为黑色，并居中绘制当前帧数和时间，最终生成如下参数的视频，比较各种方式的消耗时间。

- **视频分辨率**: 1920x1080
- **帧率**: 30 FPS
- **最高码率**: 4,000,000 bps (4 Mbps)
- **关键帧间隔**: 3
- **总帧数**: 1800 帧 (60 秒)

### 性能对比

| 方案            | 描述      | 总耗时 (ms) | FPS    | 文件大小 (KB) |
| --------------- | --------- | ----------- | ------ | ------------- |
| 原生 WebCodecs  | 编码      | 7721.4      | 233.12 | -             |
| MediaBunny      | 编码+封装 | 7784.3      | 231.23 | 3978          |
| WebAV           | 编码+封装 | 8056.3      | 223.43 | 4447          |
| Python + ffmpeg | 编码+封装 | 8177.1      | 220.13 | 3230          |
| ffmpeg          | 编码+封装 | 7880.0      | 228.43 | 4590          |

### ffmpeg 命令

```
ffmpeg -f lavfi -i color=c=black:s=1920x1080:r=30:d=60 \
-vf "drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf: \
text='ffmpeg': x=(w-tw)/2: y=h/2-th*2: fontsize=100: \
fontcolor=white: box=0, \
drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf: \
text='Frame\: %{n}': x=(w-tw)/2: y=h/2: fontsize=100: \
fontcolor=white: box=0, \
drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf: \
text='Time\: %{pts\:hms}': x=(w-tw)/2: y=h/2+th*2: fontsize=100: \
fontcolor=white: box=0" \
-c:v h264_videotoolbox -g 90 -keyint_min 90 -b:v 4000000 \
-pix_fmt yuv420p -movflags +faststart \
output.mp4
```
