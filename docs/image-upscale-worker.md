# 图片放大 Worker

图片放大使用独立 BullMQ 队列 `image-upscale-jobs`，Web API 只负责上传原图、创建 `ImageUpscaleJob` 和入队。Real-ESRGAN 在 `amazon-image-upscale-worker` systemd 服务中执行。

## 配置

生产环境必须设置：

```env
QUEUE_DRIVER=redis
REDIS_URL=redis://127.0.0.1:6379
STORAGE_DRIVER=r2
IMAGE_UPSCALE_WORKER_CONCURRENCY=1
REALESRGAN_NCNN_BIN=tools/realesrgan-ncnn-vulkan/realesrgan-ncnn-vulkan
```

`IMAGE_UPSCALE_WORKER_CONCURRENCY` 默认建议保持为 `1`，因为同一块 GPU 并发放大容易造成显存不足。确认资源充足后再提高。

## Linux 引擎安装

在生产项目目录执行：

```bash
npm run setup:realesrgan:linux
```

脚本会下载官方 `realesrgan-ncnn-vulkan` Ubuntu 包，安装二进制和模型文件到 `tools/realesrgan-ncnn-vulkan/`。Worker 会从 R2 下载输入文件到系统临时目录，处理后把 PNG 结果上传回 R2，并清理临时文件。

## 运维

部署后检查：

```bash
systemctl status amazon-image-upscale-worker
journalctl -u amazon-image-upscale-worker -n 100 --no-pager
```

图片页面通过 `/api/image-upscale` 查询每张任务状态。失败任务可独立重试，完成批次可通过 ZIP 接口下载。
