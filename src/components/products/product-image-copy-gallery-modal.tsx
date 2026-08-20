"use client";

import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { scopedFetch } from "@/lib/workspace/scoped-fetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  GalleryCell,
  AmazonLinkButton,
  ImagePreviewModal,
} from "@/components/listing-ai/gallery-primitives";
import { MiniUploader } from "@/components/listing-ai/image-upload-primitives";
import { blobToDataUrl, readListingAiImageAsset, saveListingAiImageAsset } from "@/lib/listing-ai/image-assets";
import type { ImagePreview } from "@/lib/listing-ai/workspace-draft";
import {
  createEmptyProductImageCopyGallery,
  createPersistableProductImageCopyGallery,
  normalizeProductImageCopyGallery,
  type ProductGalleryInfo,
  type ProductImageCopyGalleryDraft,
} from "@/lib/products/image-copy-gallery";

function createEmptyGalleryInfo(): ProductGalleryInfo {
  return {
    asin: "",
    productFeatures: "",
    sales: "",
    price: "",
    variation: "",
    rating: "",
    reviewCount: "",
    title: "",
    bullets: "",
    aplus: "",
  };
}

function getBulletLine(text: string, index: number) {
  return text.split(/\n/)[index] ?? "";
}

function updateBulletLine(text: string, index: number, value: string) {
  const lines = text.split(/\n/);
  while (lines.length <= index) {
    lines.push("");
  }
  lines[index] = value;
  return lines.join("\n").replace(/\n+$/u, "");
}

async function uploadPreview(file: File): Promise<ImagePreview> {
  try {
    const asset = await saveListingAiImageAsset(file);
    return {
      name: asset.name,
      url: await blobToDataUrl(asset.blob),
      assetId: asset.id,
    };
  } catch (storageError) {
    console.warn("Failed to save product gallery image asset.", storageError);
    return new Promise<ImagePreview>((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve({ name: file.name, url: String(reader.result || "") });
      reader.onerror = () =>
        resolve({ name: file.name, url: URL.createObjectURL(file) });
      reader.readAsDataURL(file);
    });
  }
}

async function readFilesAsPreviews(files: FileList | null) {
  const selected = Array.from(files ?? []).slice(0, 12);
  return Promise.all(selected.map((file) => uploadPreview(file)));
}

async function hydratePreview(image: ImagePreview) {
  if (image.url && image.assetId) {
    return image;
  }

  if (image.assetId) {
    try {
      const asset = await readListingAiImageAsset(image.assetId);
      if (!asset) return image;
      return {
        ...image,
        name: image.name || asset.name,
        url: await blobToDataUrl(asset.blob),
      };
    } catch (storageError) {
      console.warn("Failed to restore product gallery image asset.", storageError);
      return image;
    }
  }

  if (image.url?.startsWith("data:image/") || image.url?.startsWith("blob:")) {
    try {
      const blob = await (await fetch(image.url)).blob();
      const file = new File([blob], image.name || "image", {
        type: blob.type || "image/png",
      });
      return uploadPreview(file);
    } catch {
      return image;
    }
  }

  return image;
}

async function hydrateGalleryDraft(draft: ProductImageCopyGalleryDraft) {
  const competitorColumns = await Promise.all(
    draft.competitorColumns.map(async (column) => ({
      ...column,
      images: await Promise.all(column.images.map(hydratePreview)),
    })),
  );

  return {
    ...draft,
    competitorColumns,
    mineImages: await Promise.all(draft.mineImages.map(hydratePreview)),
  };
}

export function ProductImageCopyGalleryModal({
  sku,
  productName,
  initialMineInfo,
  onClose,
}: {
  sku: string;
  productName: string;
  initialMineInfo?: Partial<ProductGalleryInfo>;
  onClose: () => void;
}) {
  const initialMineInfoDraft = useMemo(
    () => ({
      ...createEmptyGalleryInfo(),
      ...(initialMineInfo ?? {}),
      asin: initialMineInfo?.asin?.trim() ?? "",
    }),
    [initialMineInfo],
  );
  const [draft, setDraft] = useState<ProductImageCopyGalleryDraft>(() => ({
    ...createEmptyProductImageCopyGallery(),
    mineInfo: initialMineInfoDraft,
  }));
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null);
  const [draggedImage, setDraggedImage] = useState<{
    columnIndex: number;
    imageIndex: number;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadGallery() {
      setReady(false);
      setError("");
      setSaveStatus("idle");

      try {
        const response = await scopedFetch(`/api/products/${encodeURIComponent(sku)}/image-copy-gallery`, {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          gallery?: Partial<ProductImageCopyGalleryDraft>;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error || "图片文案草稿读取失败");
        }

        const normalized = normalizeProductImageCopyGallery(data.gallery, 3);
        const hydrated = await hydrateGalleryDraft(normalized);

        if (!cancelled) {
            setDraft({
              ...hydrated,
              mineInfo: {
                ...initialMineInfoDraft,
                ...hydrated.mineInfo,
                asin: hydrated.mineInfo.asin || initialMineInfoDraft.asin || "",
              },
            });
          }
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "图片文案草稿读取失败";
        if (!cancelled) {
          setError(message);
          setDraft({
            ...createEmptyProductImageCopyGallery(),
            mineInfo: initialMineInfoDraft,
          });
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
  }, [initialMineInfoDraft, sku]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setSaveStatus("saving");
      scopedFetch(`/api/products/${encodeURIComponent(sku)}/image-copy-gallery`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gallery: createPersistableProductImageCopyGallery(draft) }),
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

  function addCompetitorColumn() {
    setDraft((current) => ({
      ...current,
      competitorColumns: [
        ...current.competitorColumns,
        {
          label: `Competitor ${current.competitorColumns.length + 1}`,
          info: createEmptyGalleryInfo(),
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

  function updateCompetitorInfo(
    columnIndex: number,
    key: keyof ProductGalleryInfo,
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      competitorColumns: current.competitorColumns.map((column, index) =>
        index === columnIndex
          ? {
              ...column,
              info: {
                ...column.info,
                [key]: key === "asin" ? value.trim() : value,
              },
            }
          : column,
      ),
    }));
  }

  function updateMineInfo(key: keyof ProductGalleryInfo, value: string) {
    setDraft((current) => ({
      ...current,
      mineInfo: {
        ...current.mineInfo,
        [key]: key === "asin" ? value.trim() : value,
      },
    }));
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

  const infoRows = [
    { label: "ASIN", key: "asin" as const, asin: true },
    { label: "产品卖点", key: "productFeatures" as const, multiline: true },
    { label: "销量", key: "sales" as const },
    { label: "价格", key: "price" as const },
    { label: "变体", key: "variation" as const },
    { label: "星级", key: "rating" as const },
    { label: "评论数", key: "reviewCount" as const },
    { label: "标题", key: "title" as const, multiline: true },
    { label: "5点1", key: "bullets" as const, multiline: true, tall: true, bulletIndex: 0 },
    { label: "5点2", key: "bullets" as const, multiline: true, tall: true, bulletIndex: 1 },
    { label: "5点3", key: "bullets" as const, multiline: true, tall: true, bulletIndex: 2 },
    { label: "5点4", key: "bullets" as const, multiline: true, tall: true, bulletIndex: 3 },
    { label: "5点5", key: "bullets" as const, multiline: true, tall: true, bulletIndex: 4 },
    { label: "5点6", key: "bullets" as const, multiline: true, tall: true, bulletIndex: 5 },
  ];

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
              {ready
                ? saveStatus === "saving"
                  ? "正在保存到数据库"
                  : saveStatus === "failed"
                    ? "保存失败"
                    : "图片已走对象存储，草稿已连接数据库"
                : "正在读取数据库草稿"}
            </p>
            {error ? (
              <p className="mt-1 text-xs font-semibold text-danger">{error}</p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={addCompetitorColumn}>
              <Plus className="h-4 w-4" />
              新增竞品列
            </Button>
            <Button
              variant="secondary"
              size="sm"
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
                        <th
                          key={`${column.label}-${index}`}
                          className="w-[260px] px-4 py-3"
                        >
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
                          <td
                            key={`${column.label}-${columnIndex}`}
                            className="px-4 py-3 align-top"
                          >
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
                              setDraggedImage({
                                columnIndex: -1,
                                imageIndex: index,
                              })
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

                    {infoRows.map((row) => (
                      <tr key={row.label}>
                        <td className="sticky left-0 z-[1] bg-white px-3 py-3 align-middle text-sm font-black text-foreground">
                          {row.label}
                        </td>
                        {draft.competitorColumns.map((column, columnIndex) => {
                          const bulletIndex = "bulletIndex" in row ? row.bulletIndex : undefined;
                          const isBulletRow = typeof bulletIndex === "number";
                          const value =
                            isBulletRow
                              ? getBulletLine(column.info.bullets, bulletIndex)
                              : column.info[row.key];
                          return (
                            <td
                              key={`${column.label}-${columnIndex}`}
                              className="px-4 py-3 align-top"
                            >
                              {row.asin ? (
                                <div className="grid grid-cols-[minmax(0,1fr)_44px] gap-2">
                                  <input
                                    className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
                                    value={value}
                                    onChange={(event) =>
                                      updateCompetitorInfo(
                                        columnIndex,
                                        row.key,
                                        event.target.value,
                                      )
                                    }
                                  />
                                  <AmazonLinkButton asin={value} />
                                </div>
                              ) : (
                                <textarea
                                  className={`w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10 ${row.multiline ? "min-h-24 resize-y" : "min-h-10 resize-none"} ${row.tall ? "min-h-36" : ""}`}
                                  value={value}
                                  onChange={(event) =>
                                    isBulletRow
                                      ? updateCompetitorInfo(
                                          columnIndex,
                                          "bullets",
                                          updateBulletLine(
                                            column.info.bullets,
                                            bulletIndex,
                                            event.target.value,
                                          ),
                                        )
                                      : updateCompetitorInfo(
                                          columnIndex,
                                          row.key,
                                          event.target.value,
                                        )
                                  }
                                />
                              )}
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 align-top">
                          {row.asin ? (
                            <div className="grid grid-cols-[minmax(0,1fr)_44px] gap-2">
                              <input
                                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
                                value={draft.mineInfo[row.key]}
                                onChange={(event) =>
                                  updateMineInfo(row.key, event.target.value)
                                }
                              />
                              <AmazonLinkButton asin={draft.mineInfo[row.key]} />
                            </div>
                          ) : (
                            <textarea
                              className={`w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10 ${row.multiline ? "min-h-24 resize-y" : "min-h-10 resize-none"} ${row.tall ? "min-h-36" : ""}`}
                              value={
                                "bulletIndex" in row && row.key === "bullets"
                                  ? getBulletLine(draft.mineInfo.bullets, row.bulletIndex)
                                  : draft.mineInfo[row.key]
                              }
                              onChange={(event) =>
                                "bulletIndex" in row && row.key === "bullets"
                                  ? updateMineInfo(
                                      "bullets",
                                      updateBulletLine(
                                        draft.mineInfo.bullets,
                                        row.bulletIndex,
                                        event.target.value,
                                      ),
                                    )
                                  : updateMineInfo(row.key, event.target.value)
                              }
                            />
                          )}
                        </td>
                      </tr>
                    ))}

                    <tr>
                      <td className="sticky left-0 z-[1] bg-white px-3 py-3 align-middle text-sm font-black text-foreground">
                        A+
                      </td>
                      {draft.competitorColumns.map((column, columnIndex) => (
                        <td
                          key={`${column.label}-${columnIndex}-aplus`}
                          className="px-4 py-3 align-top"
                        >
                          <textarea
                            className="w-full min-h-24 resize-y rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
                            value={column.info.aplus}
                            onChange={(event) =>
                              updateCompetitorInfo(
                                columnIndex,
                                "aplus",
                                event.target.value,
                              )
                            }
                          />
                        </td>
                      ))}
                      <td className="px-4 py-3 align-top">
                        <textarea
                          className="w-full min-h-24 resize-y rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10"
                          value={draft.mineInfo.aplus}
                          onChange={(event) =>
                            updateMineInfo("aplus", event.target.value)
                          }
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Image Assets Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                className="min-h-32 w-full resize-y rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
                value={draft.structureNotes}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    structureNotes: event.target.value,
                  }))
                }
                placeholder="记录结构、差异点、主图策略和文案提示。"
              />
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
