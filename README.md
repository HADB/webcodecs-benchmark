# WebCodecs Benchmark

### 测试方式 1

每帧背景色为黑色，并绘制当前帧数，最终生成如下参数的视频，比较各种方式的消耗时间。

- **视频分辨率**: 1920x1080
- **帧率**: 30 FPS
- **最高码率**: 4,000,000 bps
- **关键帧间隔**: 3
- **总帧数**: 1800 帧 (60 秒)

### 性能对比

| 生成方式               | 总耗时 (ms)     | FPS    | 文件大小 (KB) |
| ---------------------- | --------------- | ------ | ------------- |
| MediaBunny             | 7784.3 (+4.35%) | 231.23 | 1520          |
| WebAV                  | 8056.3 (+7.99%) | 223.43 | 2027          |
| Python + ffmpeg        | 8030.5 (+7.65%) | 224.14 | 1349          |
| ffmpeg                 | 7800.0 (+4.56%) | 230.77 | 1993          |
| [基准] ffmpeg 生成纯黑 | 7460.0 (+0.00%) | 241.29 | 169           |

### ffmpeg 命令

显示帧数：

```
ffmpeg -f lavfi -i color=c=black:s=1920x1080:r=30:d=60 \
-vf "drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf: \
text='Frame\: %{n}': x=700: y=500: fontsize=100: fontcolor=white: box=0" \
-c:v h264_videotoolbox -b:v 4000000 -g 90 -keyint_min 90 -pix_fmt yuv420p \
output.mp4 -y
```

纯黑：

```
ffmpeg -f lavfi -i color=c=black:s=1920x1080:r=30:d=60 -c:v h264_videotoolbox -b:v 4000000 -g 90 -keyint_min 9 -pix_fmt yuv420p -y output.mp4
```
