"use client";

import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  GalleryCell,
  ImagePreviewModal,
} from "@/components/listing-ai/gallery-primitives";
import { MiniUploader } from "@/components/listing-ai/image-upload-primitives";
import type { ImagePreview } from "@/lib/listing-ai/workspace-draft";
import {
  createEmptyProductImageCopyGallery,
  getProductImageCopyGalleryStorageKey,
  normalizeProductImageCopyGallery,
  type ProductImageCopyGalleryDraft,
} from "@/lib/products/image-copy-gallery";

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
  const storageKey = useMemo(
    () => getProductImageCopyGalleryStorageKey(sku),
    [sku],
  );
  const [draft, setDraft] = useState<ProductImageCopyGalleryDraft>(() =>
    createEmptyProductImageCopyGallery(),
  );
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null);
  const [draggedImage, setDraggedImage] = useState<{
    columnIndex: number;
    imageIndex: number;
  } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    try {
      const saved = window.localStorage.getItem(storageKey);
      const parsed = saved
        ? (JSON.parse(saved) as Partial<ProductImageCopyGalleryDraft>)
        : null;
      if (!cancelled) {
        setDraft(normalizeProductImageCopyGallery(parsed, 3));
      }
    } catch {
      window.localStorage.removeItem(storageKey);
      if (!cancelled) {
        setDraft(createEmptyProductImageCopyGallery());
      }
    } finally {
      if (!cancelled) {
        setReady(true);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!ready) return;

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, [draft, ready, storageKey]);

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
              <p className="text-xs font-semibold text-muted">每个 SKU 独立保存</p>
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
