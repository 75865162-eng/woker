import { Loader2, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fieldClass,
  imageGeneratorViews,
  type ImageGeneratorDraft,
  type ImagePreview,
} from "@/lib/listing-ai/workspace-draft";
import {
  ImagePreviewGrid,
  MiniUploader,
} from "@/components/listing-ai/image-upload-primitives";

export function ImageGeneratorBoard({
  draft,
  error,
  loading,
  setDraft,
  handleImageUpload,
  onRun,
}: {
  draft: ImageGeneratorDraft;
  error: string;
  loading: boolean;
  setDraft: React.Dispatch<React.SetStateAction<ImageGeneratorDraft>>;
  handleImageUpload: (
    files: FileList | null,
    callback: (images: ImagePreview[]) => void,
  ) => void;
  onRun: () => void;
}) {
  const ownViewCount = imageGeneratorViews.reduce(
    (total, view) => total + draft.ownViews[view.key].length,
    0,
  );
  const canRun =
    ownViewCount > 0 &&
    draft.competitorImages.length > 0 &&
    draft.prompt.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Images Generator</CardTitle>
            <p className="mt-1 text-xs font-semibold text-muted">
              上传竞品图和我的六视图，编辑提示词后生成图片；API 接入点已预留。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={canRun ? "green" : "gray"}>
              {ownViewCount}/6 Views · {draft.competitorImages.length} Competitors
            </Badge>
            {draft.lastRunAt ? <Badge tone="blue">{draft.lastRunAt}</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <div className="min-w-[1160px] divide-y divide-border">
          <div className="grid grid-cols-[120px_repeat(6,minmax(150px,1fr))] divide-x divide-border">
            <div className="p-3 text-sm font-bold text-foreground">我的六视图</div>
            {imageGeneratorViews.map((view) => (
              <div key={view.key} className="p-3">
                <div className="mb-2 grid grid-cols-[1fr_auto] items-center gap-2">
                  <p className="min-w-0 text-sm font-bold text-foreground">{view.label}</p>
                  <MiniUploader
                    images={draft.ownViews[view.key]}
                    label="上传"
                    onUpload={(files) =>
                      handleImageUpload(files, (images) =>
                        setDraft((current) => ({
                          ...current,
                          ownViews: {
                            ...current.ownViews,
                            [view.key]: images.slice(0, 1),
                          },
                        })),
                      )
                    }
                  />
                </div>
                <ImagePreviewGrid images={draft.ownViews[view.key]} compact />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[120px_minmax(320px,1.05fr)_minmax(260px,0.9fr)_minmax(340px,1.15fr)] divide-x divide-border">
            <div className="p-3 text-sm font-bold text-foreground">上传竞品图</div>
            <div className="p-3">
              <MiniUploader
                images={draft.competitorImages}
                label="上传竞品图"
                onUpload={(files) =>
                  handleImageUpload(files, (images) =>
                    setDraft((current) => ({
                      ...current,
                      competitorImages: images,
                    })),
                  )
                }
              />
              <ImagePreviewGrid images={draft.competitorImages} />
            </div>
            <div className="flex flex-col gap-3 p-3">
              <details className="rounded-md border border-border bg-surface-muted/50 p-3">
                <summary className="cursor-pointer text-sm font-bold text-brand">
                  提示词
                </summary>
                <textarea
                  className={`${fieldClass} mt-3 min-h-44 resize-y`}
                  value={draft.prompt}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      prompt: event.target.value,
                    }))
                  }
                />
              </details>
              <Button className="self-start" disabled={!canRun || loading} onClick={onRun}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                运行按钮
              </Button>
              {error ? (
                <p className="max-w-64 text-center text-xs font-semibold leading-5 text-red-600">
                  {error}
                </p>
              ) : (
                <p className="max-w-64 text-center text-xs font-semibold leading-5 text-muted">
                  调用 Settings 中保存的模型配置。
                </p>
              )}
            </div>
            <div className="p-3">
              <p className="mb-2 text-sm font-bold text-foreground">
                生成图展示
              </p>
              <ImagePreviewGrid images={draft.generatedImages} />
              {false && !draft.generatedImages.length ? (
                <div className="flex min-h-36 items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-xs font-bold text-muted">
                  等待生成图片
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
