"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import { Download, ImagePlus, Loader2, RotateCcw, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ImageKind = "illustration" | "photo";
type NoiseLevel = "none" | "low" | "medium" | "high";

const scaleOptions = [2, 4] as const;

const imageKindLabels: Record<ImageKind, string> = {
  illustration: "插画 / 线稿",
  photo: "商品 / 照片",
};

interface ImageMeta {
  name: string;
  type: string;
  width: number;
  height: number;
  size: number;
}

export function ImageUpscaleWorkbench() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageMeta, setImageMeta] = useState<ImageMeta | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [resultModel, setResultModel] = useState("");
  const [scale, setScale] = useState<(typeof scaleOptions)[number]>(2);
  const [imageKind, setImageKind] = useState<ImageKind>("illustration");
  const [noiseLevel, setNoiseLevel] = useState<NoiseLevel>("low");
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");

  const resultSize = useMemo(() => {
    if (!imageMeta) {
      return "等待图片";
    }

    return `${imageMeta.width * scale} × ${imageMeta.height * scale}px`;
  }, [imageMeta, scale]);

  const loadFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("请上传 JPG、PNG 或 WebP 图片。");
      return;
    }

    setError("");
    setResultUrl("");
    setResultModel("");

    const bitmap = await createImageBitmap(file);
    const nextSourceUrl = URL.createObjectURL(file);

    setSelectedFile(file);
    setSourceUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return nextSourceUrl;
    });
    setImageMeta({
      name: file.name,
      type: file.type,
      width: bitmap.width,
      height: bitmap.height,
      size: file.size,
    });
    bitmap.close();
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void loadFile(file);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files?.[0];
    if (file) {
      void loadFile(file);
    }
  };

  const handleUpscale = async () => {
    if (!sourceUrl || !imageMeta || !selectedFile) {
      setError("请先上传一张图片。");
      return;
    }

    setIsProcessing(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("scale", String(scale));
      formData.append("imageKind", imageKind);
      formData.append("noiseLevel", noiseLevel);

      const response = await fetch("/api/image-upscale", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "AI 图片放大失败。");
      }

      const blob = await response.blob();
      const model = response.headers.get("X-Image-Upscale-Model") ?? "";
      const result = URL.createObjectURL(blob);

      setResultUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return result;
      });
      setResultModel(model);
    } catch (processingError) {
      setError(processingError instanceof Error ? processingError.message : "图片处理失败，请换一张图片再试。");
    } finally {
      setIsProcessing(false);
    }
  };

  const reset = () => {
    setImageMeta(null);
    setSelectedFile(null);
    setError("");
    setResultModel("");
    setSourceUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return "";
    });
    setResultUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return "";
    });

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <section className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>处理参数</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={cn(
                "flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted px-5 py-6 text-center transition-colors",
                isDragging && "border-brand bg-white",
              )}
            >
              <ImagePlus className="h-9 w-9 text-brand" />
              <p className="mt-3 text-sm font-bold text-foreground">拖入图片或选择文件</p>
              <p className="mt-1 text-xs leading-5 text-muted">支持 JPG / PNG / WebP，使用本机 NVIDIA GPU 做 AI 超分。</p>
              <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
              <Button type="button" variant="secondary" className="mt-4" onClick={() => inputRef.current?.click()}>
                选择图片
              </Button>
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-normal text-muted">图片类型</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {Object.entries(imageKindLabels).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setImageKind(value as ImageKind)}
                    className={cn(
                      "h-10 rounded-md border border-border bg-white text-sm font-semibold text-muted transition-colors",
                      imageKind === value && "border-brand bg-brand text-white",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-normal text-muted">放大倍数</label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {scaleOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setScale(option)}
                    className={cn(
                      "h-10 rounded-md border border-border bg-white text-sm font-semibold text-muted transition-colors",
                      scale === option && "border-brand bg-brand text-white",
                    )}
                  >
                    {option}x
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="noise-level" className="text-xs font-bold uppercase tracking-normal text-muted">
                降噪强度
              </label>
              <select
                id="noise-level"
                value={noiseLevel}
                onChange={(event) => setNoiseLevel(event.target.value as NoiseLevel)}
                className="mt-2 h-10 w-full rounded-md border border-border bg-white px-3 text-sm font-semibold text-foreground outline-none focus:border-brand"
              >
                <option value="none">不降噪</option>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </div>

            <div className="rounded-md border border-border bg-surface-muted p-3">
              <p className="text-xs font-bold text-muted">输出尺寸</p>
              <p className="mt-1 text-lg font-black text-foreground">{resultSize}</p>
              {resultModel ? <p className="mt-1 text-xs font-semibold text-muted">模型：{resultModel}</p> : null}
            </div>

            {error ? <p className="rounded-md border border-danger/30 bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{error}</p> : null}

            <div className="flex gap-2">
              <Button type="button" className="flex-1" disabled={!sourceUrl || isProcessing} onClick={handleUpscale}>
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
                AI 放大
              </Button>
              <Button type="button" variant="secondary" size="icon" title="重置" onClick={reset}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <PreviewCard
          title="原图"
          imageUrl={sourceUrl}
          metaText={imageMeta ? `${imageMeta.width} × ${imageMeta.height}px · ${formatBytes(imageMeta.size)}` : ""}
          emptyText="上传图片后显示原图"
        />
        <PreviewCard
          title="放大结果"
          imageUrl={resultUrl}
          metaText={resultUrl && imageMeta ? `${imageMeta.width * scale} × ${imageMeta.height * scale}px · PNG${resultModel ? ` · ${resultModel}` : ""}` : ""}
          emptyText="处理完成后显示结果"
          downloadName={imageMeta ? buildDownloadName(imageMeta.name, scale) : undefined}
        />
      </section>
    </div>
  );
}

function PreviewCard({
  title,
  imageUrl,
  metaText,
  emptyText,
  downloadName,
}: {
  title: string;
  imageUrl: string;
  metaText: string;
  emptyText: string;
  downloadName?: string;
}) {
  return (
    <Card className="min-h-[520px] overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          {metaText ? <p className="mt-1 text-xs font-medium text-muted">{metaText}</p> : null}
        </div>
        {downloadName && imageUrl ? (
          <a href={imageUrl} download={downloadName}>
            <Button type="button" variant="secondary" size="sm">
              <Download className="h-4 w-4" />
              下载
            </Button>
          </a>
        ) : null}
      </CardHeader>
      <CardContent className="flex min-h-[440px] items-center justify-center bg-surface-muted p-3">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={title} className="max-h-[70vh] max-w-full rounded-md object-contain shadow-sm" />
        ) : (
          <div className="flex h-full min-h-[360px] w-full items-center justify-center rounded-md border border-dashed border-border bg-white text-sm font-semibold text-muted">
            {emptyText}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function buildDownloadName(fileName: string, scale: number) {
  const dotIndex = fileName.lastIndexOf(".");
  const baseName = dotIndex > -1 ? fileName.slice(0, dotIndex) : fileName;

  return `${baseName}-${scale}x-upscaled.png`;
}
