"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ProductEditorDraft } from "./product-workbench-model";
import type { ProductImageUploadProgress } from "./product-editor-image-panel";
import { selectProductImageFiles, uploadProductImageFile } from "./product-attachment-upload";

export function useProductImageUploads(draft: ProductEditorDraft, setDraft: Dispatch<SetStateAction<ProductEditorDraft>>) {
  const [imageUploads, setImageUploads] = useState<ProductImageUploadProgress[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const files = useRef(new Map<string, File>());
  const previews = useRef(new Map<string, string>());
  const queue = useRef<string[]>([]);
  const activeCount = useRef(0);
  const disposed = useRef(false);
  useEffect(() => {
    disposed.current = false;
    const activeControllers = controllers.current;
    const activeFiles = files.current;
    const activePreviews = previews.current;
    return () => {
      disposed.current = true;
      queue.current = [];
      activeControllers.forEach(controller => controller.abort());
      activeControllers.clear();
      activeFiles.clear();
      activePreviews.forEach(url => URL.revokeObjectURL(url));
      activePreviews.clear();
    };
  }, []);

  function releasePreview(id: string) {
    const url = previews.current.get(id);
    if (url) URL.revokeObjectURL(url);
    previews.current.delete(id);
  }
  async function handleImageUpload(selectedFiles: FileList | null) {
    const selected = selectProductImageFiles(selectedFiles ?? [], Math.max(draft.imageAssets?.length ?? 0, draft.images.length));
    if (!selected.length) return;
    const uploads = selected.map((file, index) => ({ id: `product-image-upload-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`, file, previewUrl: URL.createObjectURL(file) }));
    uploads.forEach(({ id, file, previewUrl }) => { files.current.set(id, file); previews.current.set(id, previewUrl); });
    queue.current.push(...uploads.map(({ id }) => id));
    setImageUploads(current => [...current, ...uploads.map(({ id, file, previewUrl }) => ({ id, name: file.name, progress: 0, status: "queued" as const, previewUrl }))]);
    void pump();
  }
  async function pump() {
    while (!disposed.current && activeCount.current < 2) {
      const id = queue.current.shift();
      if (!id) return;
      const file = files.current.get(id);
      if (!file) continue;
      activeCount.current++;
      void upload(id, file).finally(() => { activeCount.current--; void pump(); });
      await Promise.resolve();
    }
  }
  async function upload(id: string, file: File) {
    setImageUploads(current => current.map(item => item.id === id ? { ...item, status: "uploading", error: undefined } : item));
    const controller = new AbortController();
    controllers.current.set(id, controller);
    try {
      const asset = await uploadProductImageFile(file, { signal: controller.signal, onUploadProgress: progress => { if (!disposed.current && !controller.signal.aborted) setImageUploads(current => current.map(item => item.id === id ? { ...item, progress } : item)); } });
      if (disposed.current || controller.signal.aborted) return;
      setDraft(current => ({ ...current, images: [...current.images, asset.thumbUrl].slice(0, 10), imageAssets: [...(current.imageAssets ?? []), asset].slice(0, 10) }));
      setImageUploads(current => current.filter(item => item.id !== id));
      files.current.delete(id);
      releasePreview(id);
    } catch (error) {
      if (!disposed.current && !controller.signal.aborted) setImageUploads(current => current.map(item => item.id === id ? { ...item, status: "failed", error: error instanceof Error ? error.message : "上传失败" } : item));
    } finally { controllers.current.delete(id); }
  }
  function cancelImageUpload(id: string) {
    controllers.current.get(id)?.abort();
    files.current.delete(id);
    queue.current = queue.current.filter(value => value !== id);
    releasePreview(id);
    setImageUploads(current => current.filter(item => item.id !== id));
  }
  function retryImageUpload(id: string) {
    if (!imageUploads.some(item => item.id === id) || !files.current.has(id)) return;
    setImageUploads(current => current.map(item => item.id === id ? { ...item, status: "queued", progress: 0 } : item));
    queue.current.push(id);
    void pump();
  }
  function removeImage(index: number) {
    setDraft(current => ({ ...current, images: current.images.filter((_, i) => i !== index), imageAssets: current.imageAssets?.filter((_, i) => i !== index) }));
  }
  return { imageUploads, handleImageUpload, cancelImageUpload, retryImageUpload, removeImage };
}
