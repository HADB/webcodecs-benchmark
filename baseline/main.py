import argparse
import os
import platform
import queue
import random
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Event, Lock, Thread

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def detect_hardware_encoders():
    """检测可用的硬件编码器"""
    hardware_encoders = {}

    # 根据操作系统检测可用的硬件编码器
    system = platform.system()

    # 检测 NVIDIA GPU (NVENC)
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if "h264_nvenc" in result.stdout:
            hardware_encoders["h264_nvenc"] = "NVIDIA H.264 (NVENC)"
        if "hevc_nvenc" in result.stdout:
            hardware_encoders["hevc_nvenc"] = "NVIDIA HEVC (NVENC)"
    except:
        pass

    # 检测 Intel Quick Sync (QSV)
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if "h264_qsv" in result.stdout:
            hardware_encoders["h264_qsv"] = "Intel H.264 (Quick Sync)"
        if "hevc_qsv" in result.stdout:
            hardware_encoders["hevc_qsv"] = "Intel HEVC (Quick Sync)"
    except:
        pass

    # 检测 AMD AMF (仅Windows)
    if system == "Windows":
        try:
            result = subprocess.run(
                ["ffmpeg", "-hide_banner", "-encoders"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if "h264_amf" in result.stdout:
                hardware_encoders["h264_amf"] = "AMD H.264 (AMF)"
            if "hevc_amf" in result.stdout:
                hardware_encoders["hevc_amf"] = "AMD HEVC (AMF)"
        except:
            pass

    # 检测 Apple VideoToolbox (仅macOS)
    if system == "Darwin":
        try:
            result = subprocess.run(
                ["ffmpeg", "-hide_banner", "-encoders"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if "h264_videotoolbox" in result.stdout:
                hardware_encoders["h264_videotoolbox"] = "Apple H.264 (VideoToolbox)"
            if "hevc_videotoolbox" in result.stdout:
                hardware_encoders["hevc_videotoolbox"] = "Apple HEVC (VideoToolbox)"
        except:
            pass

    return hardware_encoders


# 全局字体缓存，避免重复加载
_font_cache = None
_font_lock = Lock()


def get_font():
    """获取缓存的字体对象"""
    global _font_cache
    if _font_cache is None:
        with _font_lock:
            if _font_cache is None:
                _font_cache = ImageFont.load_default(size=100)
    return _font_cache


# 生成帧的函数
def generate_frame(width=1920, height=1080, frame_number=0):
    # 固定黑色背景
    bg_color = (0, 0, 0)

    # 创建图像（使用更高效的方式）
    img = Image.new("RGB", (width, height), bg_color)
    draw = ImageDraw.Draw(img)

    # 使用缓存的字体
    font = get_font()
    text_color = (255, 255, 255)

    # 预计算文本内容
    description_text = "python+ffmpeg"
    frame_text = f"Frame: {frame_number}"
    time_seconds = frame_number / 30.0
    time_text = f"Time: {time_seconds:.2f}s"

    # 计算画布中心位置
    center_x = width // 2
    center_y = height // 2

    # 获取文本边界框来计算居中位置
    desc_bbox = draw.textbbox((0, 0), description_text, font=font)
    frame_bbox = draw.textbbox((0, 0), frame_text, font=font)
    time_bbox = draw.textbbox((0, 0), time_text, font=font)

    # 计算居中的x坐标
    desc_x = center_x - (desc_bbox[2] - desc_bbox[0]) // 2
    frame_x = center_x - (frame_bbox[2] - frame_bbox[0]) // 2
    time_x = center_x - (time_bbox[2] - time_bbox[0]) // 2

    # 绘制居中文本，上下间距120px
    draw.text((desc_x, center_y - 120), description_text, fill=text_color, font=font)
    draw.text((frame_x, center_y), frame_text, fill=text_color, font=font)
    draw.text((time_x, center_y + 120), time_text, fill=text_color, font=font)

    # 直接转换为字节，减少中间转换
    frame_array = np.array(img, dtype=np.uint8)
    return frame_array.tobytes()


def generate_frames_batch(frame_numbers, width, height):
    """
    批量生成帧数据的工作函数
    """
    batch_data = []
    for frame_num in frame_numbers:
        frame_data = generate_frame(width, height, frame_num)
        batch_data.append((frame_num, frame_data))
    return batch_data


def get_default_codec(codec_type, hardware_encoders):
    """根据编码类型和可用硬件编码器返回默认编码器"""
    if codec_type == "h264":
        # H.264 编码器优先级
        for hw_codec in ["h264_videotoolbox", "h264_nvenc", "h264_qsv", "h264_amf"]:
            if hw_codec in hardware_encoders:
                return hw_codec
        return "libx264"  # 软件编码器作为备选
    elif codec_type == "h265":
        # H.265 编码器优先级
        for hw_codec in ["hevc_videotoolbox", "hevc_nvenc", "hevc_qsv", "hevc_amf"]:
            if hw_codec in hardware_encoders:
                return hw_codec
        return "libx265"  # 软件编码器作为备选
    else:
        return "libx264"  # 默认使用 H.264


def run_benchmark(output_file, codec, frame_count, width, height, bitrate):
    # 确保输出目录存在
    os.makedirs(os.path.dirname(output_file) or ".", exist_ok=True)

    # 构建 FFmpeg 命令
    ffmpeg_cmd = [
        "ffmpeg",
        "-y",  # 覆盖输出文件
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        f"{width}x{height}",
        "-r",
        "30",
        "-i",
        "-",
        "-c:v",
        codec,
        "-g",
        "90",
        "-keyint_min",
        "90",
    ]

    # 添加编码器参数
    ffmpeg_cmd.extend(["-b:v", bitrate])

    # 添加通用输出格式参数
    ffmpeg_cmd.extend(["-pix_fmt", "yuv420p", "-f", "mp4"])
    ffmpeg_cmd.append(output_file)

    # 输出最终命令
    print("最终 FFmpeg 命令:")
    print(" ".join(ffmpeg_cmd))

    print(
        f"开始编码测试，使用编码器: {codec}, 分辨率: {width}x{height}, 帧数: {frame_count}"
    )

    # 创建帧数据队列 - 限制队列大小以控制内存使用
    frame_queue = queue.Queue(maxsize=64)  # 最多缓存64帧

    # 线程间的状态控制
    generation_complete = Event()
    encoding_error = Event()

    # 统计信息
    frames_generated = 0
    frames_encoded = 0

    def frame_producer():
        """帧生成线程 - 生产者"""
        nonlocal frames_generated
        try:
            # 使用多线程生成
            gen_workers = min(os.cpu_count() or 1, 6)  # 为编码留出CPU资源

            print(f"使用 {gen_workers} 个线程并行生成帧数据...")

            # 分批处理帧
            batch_size = 8
            frame_batches = []
            for i in range(0, frame_count, batch_size):
                batch_end = min(i + batch_size, frame_count)
                frame_batches.append(list(range(i, batch_end)))

            with ThreadPoolExecutor(max_workers=gen_workers) as executor:
                # 提交所有批次任务
                future_to_batch = {
                    executor.submit(generate_frames_batch, batch, width, height): batch
                    for batch in frame_batches
                }

                # 按顺序收集结果并放入队列
                batch_results = {}
                for future in as_completed(future_to_batch):
                    batch = future_to_batch[future]
                    try:
                        results = future.result()
                        # 按批次的第一个帧号排序
                        batch_index = batch[0]
                        batch_results[batch_index] = results

                        # 检查是否可以按顺序输出
                        while frames_generated in batch_results:
                            for frame_num, frame_data in batch_results[
                                frames_generated
                            ]:
                                if encoding_error.is_set():
                                    return
                                frame_queue.put(frame_data, timeout=10)
                                frames_generated += 1

                                # 显示生成进度
                                if (
                                    frames_generated % 100 == 0
                                    or frames_generated == frame_count
                                ):
                                    progress = (frames_generated / frame_count) * 100
                                    print(
                                        f"帧生成进度: {progress:.1f}% ({frames_generated}/{frame_count})"
                                    )

                            # 找到下一个连续的批次
                            next_batch_start = frames_generated
                            if next_batch_start not in batch_results:
                                break

                    except Exception as e:
                        print(f"生成帧数据时出错: {e}")
                        encoding_error.set()
                        return

        except Exception as e:
            print(f"帧生成线程出错: {e}")
            encoding_error.set()
        finally:
            generation_complete.set()
            # 放入结束标记
            try:
                frame_queue.put(None, timeout=1)
            except:
                pass

    def frame_consumer(proc):
        """帧编码线程 - 消费者"""
        nonlocal frames_encoded
        try:
            write_buffer = b""
            buffer_size = 1024 * 1024 * 8  # 8MB 缓冲区

            while True:
                try:
                    # 从队列获取帧数据
                    frame_data = frame_queue.get(timeout=30)

                    # 检查是否是结束标记
                    if frame_data is None:
                        break

                    # 添加到写入缓冲区
                    write_buffer += frame_data
                    frames_encoded += 1

                    # 当缓冲区达到一定大小时写入
                    if len(write_buffer) >= buffer_size:
                        if proc.stdin:
                            proc.stdin.write(write_buffer)
                        write_buffer = b""

                    # 显示编码进度
                    if frames_encoded % 100 == 0 or frames_encoded == frame_count:
                        progress = (frames_encoded / frame_count) * 100
                        print(
                            f"编码进度: {progress:.1f}% ({frames_encoded}/{frame_count})"
                        )

                    frame_queue.task_done()

                except queue.Empty:
                    if generation_complete.is_set():
                        print("帧生成已完成，等待剩余帧编码...")
                        # 处理队列中剩余的帧
                        try:
                            while True:
                                frame_data = frame_queue.get_nowait()
                                if frame_data is None:
                                    break
                                write_buffer += frame_data
                                frames_encoded += 1
                                frame_queue.task_done()
                        except queue.Empty:
                            break
                    else:
                        print("等待帧生成...")
                        continue

            # 写入剩余数据
            if write_buffer and proc.stdin:
                proc.stdin.write(write_buffer)

        except Exception as e:
            print(f"帧编码线程出错: {e}")
            encoding_error.set()

    start_time = time.time()

    # 启动 FFmpeg 进程
    proc = subprocess.Popen(
        ffmpeg_cmd,
        stdin=subprocess.PIPE,
        bufsize=1024 * 1024 * 16,  # 16MB 缓冲区
        env={**os.environ, "FFREPORT": "level=quiet"},
    )

    try:
        # 启动生产者线程（帧生成）
        producer_thread = Thread(target=frame_producer, daemon=True)
        producer_thread.start()

        # 在主线程中运行消费者（帧编码）
        frame_consumer(proc)

        # 等待生产者线程完成
        producer_thread.join(timeout=60)

        if producer_thread.is_alive():
            print("警告：帧生成线程未在预期时间内完成")

    except Exception as e:
        print(f"并行编码过程中发生错误: {e}")
        encoding_error.set()
        if proc.stdin:
            proc.stdin.close()
        proc.kill()
        raise

    # 关闭输入流并等待完成
    if proc.stdin:
        proc.stdin.close()
    proc.wait()

    end_time = time.time()
    elapsed = end_time - start_time

    print(f"编码完成! 耗时: {elapsed*1000:.2f}毫秒")
    print(f"平均帧率: {frame_count/elapsed:.2f} FPS")
    print(f"生成帧数: {frames_generated}, 编码帧数: {frames_encoded}")
    print(f"输出文件: {os.path.abspath(output_file)}")

    return elapsed


def parse_arguments():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(description="视频编码性能测试工具")
    parser.add_argument(
        "--output",
        "-o",
        default="output/benchmark.mp4",
        help="输出文件路径 (默认: output/benchmark.mp4)",
    )
    parser.add_argument(
        "--frames", "-f", type=int, default=1800, help="生成的帧数 (默认: 1800)"
    )
    parser.add_argument(
        "--width", "-w", type=int, default=1920, help="视频宽度 (默认: 1920)"
    )
    parser.add_argument(
        "--height", type=int, default=1080, help="视频高度 (默认: 1080)"
    )
    parser.add_argument(
        "--encoder",
        type=str,
        help="手动指定编码器 (例如: libx264, h264_videotoolbox, hevc_nvenc)",
    )
    parser.add_argument(
        "--bitrate",
        "-b",
        type=str,
        required=True,
        help="目标码率，支持多种格式: 数值(如 8000000 表示8Mbps)、带单位(如 8M, 2000k)",
    )

    return parser.parse_args()


if __name__ == "__main__":
    # 解析命令行参数
    args = parse_arguments()

    # 首先显示可用的硬件编码器
    print("=== 硬件编码器检测 ===")
    hardware_encoders = detect_hardware_encoders()
    if hardware_encoders:
        print("检测到以下硬件编码器:")
        for encoder, desc in hardware_encoders.items():
            print(f"  - {encoder}: {desc}")
    else:
        print("未检测到硬件编码器")
    print()

    # 确定使用的编码器
    if args.encoder:
        # 手动指定编码器
        codec = args.encoder
        print(f"手动指定编码器: {codec}")
    else:
        # 自动选择最优的 H.264 编码器
        codec = get_default_codec("h264", hardware_encoders)
        print(f"自动选择编码器: {codec} (H.264)")

    # 测试参数
    params = {
        "output_file": args.output,
        "codec": codec,
        "frame_count": args.frames,
        "width": args.width,
        "height": args.height,
        "bitrate": args.bitrate,
    }

    print(f"测试参数:")
    print(f"  编码器: {codec}")
    print(f"  分辨率: {args.width}x{args.height}")
    print(f"  帧数: {args.frames}")
    print(f"  输出文件: {args.output}")
    print(f"  目标码率: {args.bitrate}")
    print()

    # 运行并行编码测试
    result = run_benchmark(**params)
