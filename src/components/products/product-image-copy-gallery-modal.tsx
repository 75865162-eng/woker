"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  GalleryCell,
  ImagePreviewModal,
} from "@/components/listing-ai/gallery-primitives";
import { MiniUploader } from "@/components/listing-ai/image-upload-primitives";
import { fieldClass, labelClass, type ImagePreview } from "@/lib/listing-ai/workspace-draft";
import {
  createEmptyProductImageCopyGallery,
  normalizeProductImageCopyGallery,
  type ProductImageCopyGalleryDraft,
} from "@/lib/products/image-copy-gallery";

const compactToolbarButtonClass =
  "shrink-0 whitespace-nowrap max-sm:h-7 max-sm:px-2 max-sm:text-[10px] max-sm:leading-none max-sm:gap-1";

async function readFilesAsPreviews(files: FileList | null) {
  const selected = Array.from(files ?? []).slice(0, 12);

  return Promise.all(
    selected.map(
      (file) =>
        new Promise<ImagePreview>((resolve) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({ name: file.name, url: String(reader.result || "") });
          reader.onerror = () =>
            resolve({ name: file.name, url: URL.createObjectURL(file) });
          reader.readAsDataURL(file);
        }),
    ),
  );
}

export function ProductImageCopyGalleryModal({
  sku,
  productName,
  onClose,
}: {
  sku: string;
  productName: string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ProductImageCopyGalleryDraft>(() =>
    createEmptyProductImageCopyGallery(),
  );
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null);
  const [draggedImage, setDraggedImage] = useState<{
    columnIndex: number;
    imageIndex: number;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [error, setError] = useState("");
  const [generatingAplus, setGeneratingAplus] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadGallery() {
      setReady(false);
      setError("");

      try {
        const response = await fetch(`/api/products/${encodeURIComponent(sku)}/image-copy-gallery`, { cache: "no-store" });
        const data = (await response.json()) as { gallery?: Partial<ProductImageCopyGalleryDraft>; error?: string };

        if (!response.ok) {
          throw new Error(data.error || "图片文案草稿读取失败");
        }

        if (!cancelled) {
          setDraft(normalizeProductImageCopyGallery(data.gallery, 3));
        }
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "图片文案草稿读取失败";
        if (!cancelled) {
          setError(message);
          setDraft(createEmptyProductImageCopyGallery());
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    }

    void loadGallery();

    return () => {
      cancelled = true;
    };
  }, [sku]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setSaveStatus("saving");
      fetch(`/api/products/${encodeURIComponent(sku)}/image-copy-gallery`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gallery: draft }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const data = (await response.json()) as { error?: string };
          if (!response.ok) {
            throw new Error(data.error || "图片文案草稿保存失败");
          }
          setSaveStatus("saved");
          setError("");
        })
        .catch((saveError) => {
          if (controller.signal.aborted) return;
          setSaveStatus("failed");
          setError(saveError instanceof Error ? saveError.message : "图片文案草稿保存失败");
        });
    }, 500);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [draft, ready, sku]);

  function updateImageNote(index: number, value: string) {
    setDraft((current) => {
      const imageNotes = [...current.imageNotes];
      imageNotes[index] = value;
      return { ...current, imageNotes };
    });
  }

  function updateField<K extends keyof ProductImageCopyGalleryDraft>(
    field: K,
    value: ProductImageCopyGalleryDraft[K],
  ) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateBullet(index: number, value: string) {
    setDraft((current) => {
      const bullets = [...current.bullets];
      bullets[index] = value;
      return { ...current, bullets };
    });
  }

  function generateAplusRequirements() {
    setGeneratingAplus(true);
    try {
      const bulletLines = draft.bullets.filter((line) => line.trim());
      const summary = [
        draft.asin ? `ASIN: ${draft.asin}` : "",
        draft.productFeatures ? `产品卖点: ${draft.productFeatures}` : "",
        draft.sales ? `销量: ${draft.sales}` : "",
        draft.price ? `价格: ${draft.price}` : "",
        draft.variation ? `变体: ${draft.variation}` : "",
        draft.rating ? `星级: ${draft.rating}` : "",
        draft.reviewCount ? `评论数: ${draft.reviewCount}` : "",
        draft.title ? `标题: ${draft.title}` : "",
        bulletLines.length ? `5点: ${bulletLines.join(" / ")}` : "",
        draft.structureNotes ? `图片结构: ${draft.structureNotes}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const generated = [
        "主图与附图需突出核心卖点，优先展示差异化结构、使用场景和购买理由。",
        draft.productFeatures ? `重点强化: ${draft.productFeatures}` : "",
        draft.structureNotes ? `现有图片结构: ${draft.structureNotes}` : "",
        summary ? `参考信息:\n${summary}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      setDraft((current) => ({ ...current, aplusRequirements: generated }));
    } finally {
      setGeneratingAplus(false);
    }
  }

  const detailRows = [
    { label: "ASIN", value: draft.asin, onChange: (value: string) => updateField("asin", value) },
    { label: "产品卖点", value: draft.productFeatures, onChange: (value: string) => updateField("productFeatures", value) },
    { label: "销量", value: draft.sales, onChange: (value: string) => updateField("sales", value) },
    { label: "价格", value: draft.price, onChange: (value: string) => updateField("price", value) },
    { label: "变体", value: draft.variation, onChange: (value: string) => updateField("variation", value) },
    { label: "星级", value: draft.rating, onChange: (value: string) => updateField("rating", value) },
    { label: "评论数", value: draft.reviewCount, onChange: (value: string) => updateField("reviewCount", value) },
    { label: "标题", value: draft.title, onChange: (value: string) => updateField("title", value) },
  ];

  function addCompetitorColumn() {
    setDraft((current) => ({
      ...current,
      competitorColumns: [
        ...current.competitorColumns,
        {
          label: `Competitor ${current.competitorColumns.length + 1}`,
          images: [],
        },
      ],
    }));
  }

  function removeCompetitorColumn() {
    setDraft((current) => ({
      ...current,
      competitorColumns:
        current.competitorColumns.length > 1
          ? current.competitorColumns.slice(0, -1)
          : current.competitorColumns,
    }));
  }

  function setColumnImages(columnIndex: number, images: ImagePreview[]) {
    setDraft((current) => ({
      ...current,
      competitorColumns: current.competitorColumns.map((column, index) =>
        index === columnIndex ? { ...column, images } : column,
      ),
    }));
  }

  function setMineImages(images: ImagePreview[]) {
    setDraft((current) => ({ ...current, mineImages: images }));
  }

  function moveColumnImage(
    columnIndex: number,
    fromIndex: number,
    toIndex: number,
  ) {
    setDraft((current) => {
      const column = current.competitorColumns[columnIndex];
      if (!column || toIndex < 0 || toIndex >= column.images.length) {
        return current;
      }

      const images = [...column.images];
      const [moved] = images.splice(fromIndex, 1);
      if (!moved) return current;
      images.splice(toIndex, 0, moved);

      return {
        ...current,
        competitorColumns: current.competitorColumns.map((item, index) =>
          index === columnIndex ? { ...item, images } : item,
        ),
      };
    });
  }

  function moveMineImage(fromIndex: number, toIndex: number) {
    setDraft((current) => {
      if (toIndex < 0 || toIndex >= current.mineImages.length) {
        return current;
      }

      const images = [...current.mineImages];
      const [moved] = images.splice(fromIndex, 1);
      if (!moved) return current;
      images.splice(toIndex, 0, moved);

      return { ...current, mineImages: images };
    });
  }

  function moveBetweenColumns(
    sourceColumnIndex: number,
    sourceImageIndex: number,
    targetColumnIndex: number,
    targetImageIndex: number,
  ) {
    setDraft((current) => {
      const sourceIsMine = sourceColumnIndex < 0;
      const targetIsMine = targetColumnIndex < 0;
      const sourceImages = sourceIsMine
        ? current.mineImages
        : current.competitorColumns[sourceColumnIndex]?.images;
      const targetImages = targetIsMine
        ? current.mineImages
        : current.competitorColumns[targetColumnIndex]?.images;

      if (!sourceImages || !targetImages) {
        return current;
      }

      const nextSource = [...sourceImages];
      const [moved] = nextSource.splice(sourceImageIndex, 1);
      if (!moved) return current;

      const nextTarget = [...targetImages];
      const insertIndex = Math.min(
        Math.max(targetImageIndex, 0),
        nextTarget.length,
      );
      nextTarget.splice(insertIndex, 0, moved);

      return {
        ...current,
        mineImages: sourceIsMine
          ? nextSource
          : targetIsMine
            ? nextTarget
            : current.mineImages,
        competitorColumns: current.competitorColumns.map((column, index) => {
          if (index === sourceColumnIndex) {
            return { ...column, images: nextSource };
          }
          if (index === targetColumnIndex) {
            return { ...column, images: nextTarget };
          }
          return column;
        }),
      };
    });
  }

  function handleDrop(
    targetColumnIndex: number,
    sourceColumnIndex: number,
    sourceImageIndex: number,
    targetImageIndex: number,
  ) {
    if (sourceColumnIndex === targetColumnIndex) {
      if (targetColumnIndex < 0) {
        moveMineImage(sourceImageIndex, targetImageIndex);
        return;
      }

      moveColumnImage(targetColumnIndex, sourceImageIndex, targetImageIndex);
      return;
    }

    moveBetweenColumns(
      sourceColumnIndex,
      sourceImageIndex,
      targetColumnIndex,
      targetImageIndex,
    );
  }

  const maxRows = Math.max(
    8,
    draft.mineImages.length,
    ...draft.competitorColumns.map((column) => column.images.length),
  );

  return (
    <div className="fixed inset-0 z-50 bg-foreground/35 p-4 backdrop-blur-sm">
      <div className="mx-auto flex h-full w-full max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">
              Competitor Images Gallery
            </h2>
            <p className="mt-1 text-xs font-medium text-muted">
              SKU {sku} {productName ? `· ${productName}` : ""}
            </p>
            <p className="mt-1 text-xs font-semibold text-muted">
              {ready ? saveStatus === "saving" ? "正在保存到数据库" : saveStatus === "failed" ? "保存失败" : "已连接数据库草稿" : "正在读取数据库草稿"}
            </p>
            {error ? <p className="mt-1 text-xs font-semibold text-danger">{error}</p> : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" className={compactToolbarButtonClass} onClick={addCompetitorColumn}>
              <Plus className="h-4 w-4" />
              新增竞品列
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className={compactToolbarButtonClass}
              disabled={draft.competitorColumns.length <= 1}
              onClick={removeCompetitorColumn}
            >
              <Minus className="h-4 w-4" />
              删除竞品列
            </Button>
            <Button variant="secondary" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
              关闭
            </Button>
          </div>
        </div>

        <div className="thin-scrollbar flex-1 overflow-auto p-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle>Competitor Images Gallery</CardTitle>
              <p className="text-xs font-semibold text-muted">每个 SKU 独立保存到数据库</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[74vh] overflow-auto thin-scrollbar">
                <table
                  className="min-w-full table-fixed text-left text-sm"
                  style={{
                    width: 144 + draft.competitorColumns.length * 260 + 260,
                  }}
                >
                  <thead className="sticky top-0 z-10 bg-surface-muted text-xs font-bold text-muted">
                    <tr>
                      <th className="sticky left-0 z-20 w-36 bg-surface-muted px-4 py-3">
                        Image
                      </th>
                      {draft.competitorColumns.map((column, index) => (
                        <th key={`${column.label}-${index}`} className="w-[260px] px-4 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <span>{column.label}</span>
                            <MiniUploader
                              images={column.images}
                              label="Upload"
                              onUpload={(files) =>
                                void readFilesAsPreviews(files).then((images) =>
                                  setColumnImages(index, images),
                                )
                              }
                            />
                          </div>
                        </th>
                      ))}
                      <th className="w-[260px] px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <span>Mine</span>
                          <MiniUploader
                            images={draft.mineImages}
                            label="Upload"
                            onUpload={(files) =>
                              void readFilesAsPreviews(files).then(setMineImages)
                            }
                          />
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {Array.from({ length: maxRows }).map((_, index) => (
                      <tr key={index}>
                        <td className="sticky left-0 z-[1] bg-white px-3 py-3 align-middle">
                          <label className="block text-sm font-black text-foreground">
                            Image {index + 1}
                          </label>
                          <textarea
                            className="mt-2 h-[200px] w-full resize-none rounded-md border border-border bg-white px-2 py-1.5 text-xs font-medium leading-5 text-foreground outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/10"
                            value={draft.imageNotes[index] ?? ""}
                            onChange={(event) =>
                              updateImageNote(index, event.target.value)
                            }
                            placeholder="备注"
                          />
                        </td>
                        {draft.competitorColumns.map((column, columnIndex) => (
                          <td key={`${column.label}-${columnIndex}`} className="px-4 py-3 align-top">
                            <GalleryCell
                              image={column.images[index]}
                              draggable={Boolean(column.images[index])}
                              onDragStart={() =>
                                setDraggedImage({
                                  columnIndex,
                                  imageIndex: index,
                                })
                              }
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={() =>
                                draggedImage
                                  ? handleDrop(
                                      columnIndex,
                                      draggedImage.columnIndex,
                                      draggedImage.imageIndex,
                                      index,
                                    )
                                  : undefined
                              }
                              onMoveUp={() =>
                                moveColumnImage(columnIndex, index, index - 1)
                              }
                              onMoveDown={() =>
                                moveColumnImage(columnIndex, index, index + 1)
                              }
                              canMoveUp={index > 0}
                              canMoveDown={index < column.images.length - 1}
                              onPreview={() => setPreviewImage(column.images[index])}
                            />
                          </td>
                        ))}
                        <td className="px-4 py-3 align-top">
                          <GalleryCell
                            image={draft.mineImages[index]}
                            mine
                            draggable={Boolean(draft.mineImages[index])}
                            onDragStart={() =>
                              setDraggedImage({ columnIndex: -1, imageIndex: index })
                            }
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() =>
                                draggedImage
                                ? handleDrop(
                                    -1,
                                    draggedImage.columnIndex,
                                    draggedImage.imageIndex,
                                    index,
                                  )
                                : undefined
                            }
                            onMoveUp={() => moveMineImage(index, index - 1)}
                            onMoveDown={() => moveMineImage(index, index + 1)}
                            canMoveUp={index > 0}
                            canMoveDown={index < draft.mineImages.length - 1}
                            onPreview={() => setPreviewImage(draft.mineImages[index])}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle>Image Assets Notes</CardTitle>
              <p className="text-xs font-semibold text-muted">记录自身图片结构、差距、希望 AI 策划强化的方向</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {detailRows.map((row) => (
                  <label key={row.label} className="text-xs font-bold text-muted">
                    {row.label}
                    <input
                      className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-brand"
                      value={row.value}
                      onChange={(event) => row.onChange(event.target.value)}
                    />
                  </label>
                ))}
              </div>

              <div className="rounded-md border border-border bg-surface-muted p-4">
                <p className={labelClass}>Image Assets Notes</p>
                <textarea
                  className={`${fieldClass} mt-3 min-h-32 resize-y`}
                  value={draft.structureNotes}
                  onChange={(event) => updateField("structureNotes", event.target.value)}
                  placeholder="记录自身图片结构、差距、希望 AI 策划强化的方向"
                />
              </div>

              <div className="rounded-md border border-border bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className={labelClass}>A+ Requirements</p>
                  <Button variant="secondary" size="sm" onClick={() => generateAplusRequirements()} disabled={generatingAplus}>
                    <RefreshCw className={`h-4 w-4 ${generatingAplus ? "animate-spin" : ""}`} />
                    Generate / Regenerate
                  </Button>
                </div>
                <textarea
                  className={`${fieldClass} mt-3 min-h-32 resize-y`}
                  value={draft.aplusRequirements}
                  onChange={(event) => updateField("aplusRequirements", event.target.value)}
                  placeholder="填写 A+ 版面、模块顺序、文案重点和视觉要求。"
                />
              </div>

              <div className="rounded-md border border-border bg-white p-4">
                <p className={labelClass}>5点描述</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {Array.from({ length: 6 }, (_, index) => (
                    <label key={index} className="text-xs font-bold text-muted">
                      5点{index + 1}
                      <textarea
                        className={`${fieldClass} mt-1 min-h-20 resize-y`}
                        value={draft.bullets[index] ?? ""}
                        onChange={(event) => updateBullet(index, event.target.value)}
                        placeholder={`填写 5点${index + 1}`}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {previewImage ? (
        <ImagePreviewModal
          image={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      ) : null}
    </div>
  );
}
