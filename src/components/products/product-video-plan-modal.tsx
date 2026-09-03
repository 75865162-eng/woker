"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Minus, Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createEmptyProductVideoPlan,
  createVideoProp,
  createVideoShot,
  normalizeProductVideoPlan,
  type ProductVideoPlanDraft,
  type ProductVideoAsset,
  type ProductVideoProp,
  type ProductVideoReference,
  type ProductVideoShot,
} from "@/lib/products/video-plan";

const inputClass = "h-9 w-full rounded-md border border-border bg-white px-2 text-sm text-foreground outline-none focus:border-brand";
const textareaClass = "w-full resize-y rounded-md border border-border bg-white px-2 py-2 text-sm leading-6 text-foreground outline-none focus:border-brand";

export function ProductVideoPlanModal({
  sku,
  productName,
  onClose,
}: {
  sku: string;
  productName: string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ProductVideoPlanDraft>(() => createEmptyProductVideoPlan());
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [error, setError] = useState("");
  const [uploadingField, setUploadingField] = useState("");
  const [previewAsset, setPreviewAsset] = useState<ProductVideoAsset | null>(null);
  const totalPropsCost = useMemo(() => draft.props.reduce((total, item) => total + item.totalPrice, 0), [draft.props]);

  useEffect(() => {
    let cancelled = false;

    async function loadVideoPlan() {
      setReady(false);
      setError("");

      try {
        const response = await fetch(`/api/products/${encodeURIComponent(sku)}/video-plan`, { cache: "no-store" });
        const data = (await response.json()) as { videoPlan?: Partial<ProductVideoPlanDraft>; error?: string };

        if (!response.ok) {
          throw new Error(data.error || "视频策划草稿读取失败");
        }

        if (!cancelled) {
          setDraft(normalizeProductVideoPlan(data.videoPlan));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "视频策划草稿读取失败");
          setDraft(createEmptyProductVideoPlan());
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    }

    void loadVideoPlan();

    return () => {
      cancelled = true;
    };
  }, [sku]);

  useEffect(() => {
    if (!ready) return;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setSaveStatus("saving");
      fetch(`/api/products/${encodeURIComponent(sku)}/video-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoPlan: draft }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const data = (await response.json()) as { error?: string };
          if (!response.ok) {
            throw new Error(data.error || "视频策划草稿保存失败");
          }
          setSaveStatus("saved");
          setError("");
        })
        .catch((saveError) => {
          if (controller.signal.aborted) return;
          setSaveStatus("failed");
          setError(saveError instanceof Error ? saveError.message : "视频策划草稿保存失败");
        });
    }, 500);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [draft, ready, sku]);

  function updateReference(index: number, field: keyof ProductVideoReference, value: string) {
    setDraft((current) => ({
      ...current,
      references: current.references.map((reference, referenceIndex) => (referenceIndex === index ? { ...reference, [field]: value } : reference)),
    }));
  }

  function updateShot(index: number, field: keyof ProductVideoShot, value: string) {
    setDraft((current) => ({
      ...current,
      shots: current.shots.map((shot, shotIndex) => (shotIndex === index ? { ...shot, [field]: field === "shotNo" ? Number(value) || shot.shotNo : value } : shot)),
    }));
  }

  function updateProp(index: number, field: keyof ProductVideoProp, value: string) {
    setDraft((current) => ({
      ...current,
      props: current.props.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const next = { ...item, [field]: field === "quantity" || field === "unitPrice" || field === "totalPrice" ? Number(value) || 0 : value };
        if (field === "quantity" || field === "unitPrice") {
          next.totalPrice = Number((next.quantity * next.unitPrice).toFixed(2));
        }
        return next;
      }),
    }));
  }

  async function uploadAssets(field: "propsSceneRequirementImages" | "videoTypeImages" | "styleConfirmationImages" | "backgroundMusicFiles", files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    const isImageField = field !== "backgroundMusicFiles";
    const currentAssets = draft[field];
    const uploadFiles = isImageField ? selected.slice(0, Math.max(5 - currentAssets.length, 0)) : selected;
    if (!uploadFiles.length) return;

    setUploadingField(field);
    try {
      const uploaded: ProductVideoAsset[] = [];

      for (const file of uploadFiles) {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/products/video-assets/upload", {
          method: "POST",
          body: formData,
        });
        const data = (await response.json()) as { asset?: ProductVideoAsset; error?: string };

        if (!response.ok || !data.asset) {
          throw new Error(data.error || "素材上传失败");
        }

        uploaded.push(data.asset);
      }

      setDraft((current) => ({ ...current, [field]: isImageField ? [...current[field], ...uploaded].slice(0, 5) : [...current[field], ...uploaded] }));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "素材上传失败");
    } finally {
      setUploadingField("");
    }
  }

  async function uploadRowImages(type: "shot" | "prop", index: number, files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;

    const currentImages = type === "shot" ? draft.shots[index]?.images ?? [] : draft.props[index]?.images ?? [];
    const remainingSlots = Math.max(5 - currentImages.length, 0);
    const uploadFiles = selected.slice(0, remainingSlots);
    if (!uploadFiles.length) return;

    const uploadKey = `${type}-${index}`;
    setUploadingField(uploadKey);
    try {
      const uploaded: ProductVideoAsset[] = [];

      for (const file of uploadFiles) {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/products/video-assets/upload", {
          method: "POST",
          body: formData,
        });
        const data = (await response.json()) as { asset?: ProductVideoAsset; error?: string };

        if (!response.ok || !data.asset) {
          throw new Error(data.error || "图片上传失败");
        }

        uploaded.push(data.asset);
      }

      setDraft((current) =>
        type === "shot"
          ? {
              ...current,
              shots: current.shots.map((shot, shotIndex) =>
                shotIndex === index ? { ...shot, images: [...(shot.images ?? []), ...uploaded].slice(0, 5) } : shot,
              ),
            }
          : {
              ...current,
              props: current.props.map((item, itemIndex) =>
                itemIndex === index ? { ...item, images: [...(item.images ?? []), ...uploaded].slice(0, 5) } : item,
              ),
            },
      );
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "图片上传失败");
    } finally {
      setUploadingField("");
    }
  }

  function removeRowImage(type: "shot" | "prop", index: number, assetId: string) {
    setDraft((current) =>
      type === "shot"
        ? {
            ...current,
            shots: current.shots.map((shot, shotIndex) =>
              shotIndex === index ? { ...shot, images: (shot.images ?? []).filter((asset) => asset.id !== assetId) } : shot,
            ),
          }
        : {
            ...current,
            props: current.props.map((item, itemIndex) =>
              itemIndex === index ? { ...item, images: (item.images ?? []).filter((asset) => asset.id !== assetId) } : item,
            ),
          },
    );
  }

  function removeAsset(field: "propsSceneRequirementImages" | "videoTypeImages" | "styleConfirmationImages" | "backgroundMusicFiles", assetId: string) {
    setDraft((current) => ({ ...current, [field]: current[field].filter((asset) => asset.id !== assetId) }));
  }

  return (
    <div className="fixed inset-0 z-50 bg-foreground/35 p-4 backdrop-blur-sm">
      <div className="mx-auto flex h-full w-full max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">视频策划</h2>
            <p className="mt-1 text-xs font-medium text-muted">SKU {sku} {productName ? `· ${productName}` : ""}</p>
            <p className="mt-1 text-xs font-semibold text-muted">
              {ready ? saveStatus === "saving" ? "正在保存到数据库" : saveStatus === "failed" ? "保存失败" : "已连接数据库草稿" : "正在读取数据库草稿"}
            </p>
            {error ? <p className="mt-1 text-xs font-semibold text-danger">{error}</p> : null}
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
            关闭
          </Button>
        </div>

        <div className="thin-scrollbar flex-1 space-y-4 overflow-auto p-5">
          <Card>
            <CardHeader>
              <CardTitle>视频总要求</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <VideoField label="道具 / 场景要求">
                <textarea className={`${textareaClass} min-h-24`} value={draft.propsSceneRequirements} onChange={(event) => setDraft((current) => ({ ...current, propsSceneRequirements: event.target.value }))} />
                <AssetUploader
                  accept="image/*"
                  assets={draft.propsSceneRequirementImages}
                  uploading={uploadingField === "propsSceneRequirementImages"}
                  onUpload={(files) => void uploadAssets("propsSceneRequirementImages", files)}
                  onPreview={setPreviewAsset}
                  onRemove={(assetId) => removeAsset("propsSceneRequirementImages", assetId)}
                />
              </VideoField>
              <VideoField label="视频类型">
                <textarea className={`${textareaClass} min-h-24`} value={draft.videoType} onChange={(event) => setDraft((current) => ({ ...current, videoType: event.target.value }))} />
                <AssetUploader
                  accept="image/*"
                  assets={draft.videoTypeImages}
                  uploading={uploadingField === "videoTypeImages"}
                  onUpload={(files) => void uploadAssets("videoTypeImages", files)}
                  onPreview={setPreviewAsset}
                  onRemove={(assetId) => removeAsset("videoTypeImages", assetId)}
                />
              </VideoField>
              <VideoField label="视频色调风格">
                <textarea className={`${textareaClass} min-h-24`} value={draft.styleConfirmation} onChange={(event) => setDraft((current) => ({ ...current, styleConfirmation: event.target.value }))} />
                <AssetUploader
                  accept="image/*"
                  assets={draft.styleConfirmationImages}
                  uploading={uploadingField === "styleConfirmationImages"}
                  onUpload={(files) => void uploadAssets("styleConfirmationImages", files)}
                  onPreview={setPreviewAsset}
                  onRemove={(assetId) => removeAsset("styleConfirmationImages", assetId)}
                />
              </VideoField>
              <VideoField label="背景音乐">
                <textarea className={`${textareaClass} min-h-24`} value={draft.backgroundMusic} onChange={(event) => setDraft((current) => ({ ...current, backgroundMusic: event.target.value }))} />
                <AssetUploader
                  accept="audio/*,video/*,.mp3,.mov,.mp4,.wav,.webm,.m4a"
                  assets={draft.backgroundMusicFiles}
                  uploading={uploadingField === "backgroundMusicFiles"}
                  onUpload={(files) => void uploadAssets("backgroundMusicFiles", files)}
                  onPreview={setPreviewAsset}
                  onRemove={(assetId) => removeAsset("backgroundMusicFiles", assetId)}
                />
              </VideoField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle>参考视频</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setDraft((current) => ({ ...current, references: [...current.references, { label: `参考视频${current.references.length + 1}`, url: "" }] }))}>
                  <Plus className="h-4 w-4" />
                  新增
                </Button>
                <Button size="sm" variant="secondary" disabled={draft.references.length <= 1} onClick={() => setDraft((current) => ({ ...current, references: current.references.slice(0, -1) }))}>
                  <Minus className="h-4 w-4" />
                  删除
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {draft.references.map((reference, index) => (
                <div key={index} className="grid gap-2 md:grid-cols-[160px_minmax(0,1fr)_96px]">
                  <input className={inputClass} value={reference.label} onChange={(event) => updateReference(index, "label", event.target.value)} />
                  <input className={inputClass} value={reference.url} placeholder="https://..." onChange={(event) => updateReference(index, "url", event.target.value)} />
                  <Button size="sm" variant="secondary" disabled={!reference.url.trim()} onClick={() => openReferenceUrl(reference.url)}>
                    <ExternalLink className="h-4 w-4" />
                    打开
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>分镜脚本</CardTitle>
                <p className="mt-1 text-xs font-semibold text-muted">按镜号组织卖点、画面、镜头类别、运镜、时间、机位、参考和英文文案。</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setDraft((current) => ({ ...current, shots: [...current.shots, createVideoShot(current.shots.length + 1)] }))}>
                  <Plus className="h-4 w-4" />
                  新增镜头
                </Button>
                <Button size="sm" variant="secondary" disabled={draft.shots.length <= 1} onClick={() => setDraft((current) => ({ ...current, shots: current.shots.slice(0, -1) }))}>
                  <Minus className="h-4 w-4" />
                  删除镜头
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="thin-scrollbar max-h-[58vh] overflow-auto">
                <table className="min-w-[1660px] table-fixed text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-surface-muted text-muted">
                    <tr>
                      <th className="w-16 px-3 py-2">镜号</th>
                      <th className="w-36 px-3 py-2">卖点</th>
                      <th className="w-[360px] px-3 py-2">画面内容</th>
                      <th className="w-24 px-3 py-2">镜头类别</th>
                      <th className="w-32 px-3 py-2">运镜</th>
                      <th className="w-20 px-3 py-2">时间</th>
                      <th className="w-24 px-3 py-2">机位</th>
                      <th className="w-[260px] px-3 py-2">链接</th>
                      <th className="w-[260px] px-3 py-2">文案-英文</th>
                      <th className="w-[200px] px-3 py-2">图片</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {draft.shots.map((shot, index) => (
                      <tr key={shot.id} className="align-top">
                        <td className="px-3 py-2"><input className={inputClass} type="number" min="1" value={shot.shotNo} onChange={(event) => updateShot(index, "shotNo", event.target.value)} /></td>
                        <td className="px-3 py-2"><textarea className={`${textareaClass} min-h-24 font-semibold text-danger`} value={shot.sellingPoint} onChange={(event) => updateShot(index, "sellingPoint", event.target.value)} /></td>
                        <td className="px-3 py-2"><textarea className={`${textareaClass} min-h-24`} value={shot.sceneContent} onChange={(event) => updateShot(index, "sceneContent", event.target.value)} /></td>
                        <td className="px-3 py-2"><input className={inputClass} value={shot.shotType} onChange={(event) => updateShot(index, "shotType", event.target.value)} /></td>
                        <td className="px-3 py-2"><input className={inputClass} value={shot.cameraMove} onChange={(event) => updateShot(index, "cameraMove", event.target.value)} /></td>
                        <td className="px-3 py-2"><input className={inputClass} value={shot.duration} onChange={(event) => updateShot(index, "duration", event.target.value)} /></td>
                        <td className="px-3 py-2"><input className={inputClass} value={shot.angle} onChange={(event) => updateShot(index, "angle", event.target.value)} /></td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <textarea className={`${textareaClass} min-h-24`} value={shot.effectReference} onChange={(event) => updateShot(index, "effectReference", event.target.value)} />
                            <Button size="sm" variant="secondary" disabled={!shot.effectReference.trim()} onClick={() => openReferenceUrl(shot.effectReference)}>
                              <ExternalLink className="h-4 w-4" />
                              打开
                            </Button>
                          </div>
                        </td>
                        <td className="px-3 py-2"><textarea className={`${textareaClass} min-h-24`} value={shot.copyEnglish} onChange={(event) => updateShot(index, "copyEnglish", event.target.value)} /></td>
                        <td className="px-3 py-2">
                          <RowImageUploader
                            images={shot.images ?? []}
                            uploading={uploadingField === `shot-${index}`}
                            onUpload={(files) => void uploadRowImages("shot", index, files)}
                            onPreview={setPreviewAsset}
                            onRemove={(assetId) => removeRowImage("shot", index, assetId)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>道具清单</CardTitle>
                <p className="mt-1 text-xs font-semibold text-muted">合计 {totalPropsCost.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setDraft((current) => ({ ...current, props: [...current.props, createVideoProp()] }))}>
                  <Plus className="h-4 w-4" />
                  新增道具
                </Button>
                <Button size="sm" variant="secondary" disabled={draft.props.length <= 1} onClick={() => setDraft((current) => ({ ...current, props: current.props.slice(0, -1) }))}>
                  <Minus className="h-4 w-4" />
                  删除道具
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="thin-scrollbar overflow-auto">
                <table className="min-w-[1280px] table-fixed text-left text-xs">
                  <thead className="bg-surface-muted text-muted">
                    <tr>
                      <th className="w-44 px-3 py-2">图片 / 说明</th>
                      <th className="w-56 px-3 py-2">规格</th>
                      <th className="w-24 px-3 py-2">数量</th>
                      <th className="w-24 px-3 py-2">单价</th>
                      <th className="w-24 px-3 py-2">总价</th>
                      <th className="w-28 px-3 py-2">下单平台</th>
                      <th className="w-[360px] px-3 py-2">下单链接</th>
                      <th className="w-[200px] px-3 py-2">图片</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {draft.props.map((item, index) => (
                      <tr key={item.id} className="align-top">
                        <td className="px-3 py-2"><textarea className={`${textareaClass} min-h-20`} value={item.imageUrl} onChange={(event) => updateProp(index, "imageUrl", event.target.value)} /></td>
                        <td className="px-3 py-2"><textarea className={`${textareaClass} min-h-20`} value={item.spec} onChange={(event) => updateProp(index, "spec", event.target.value)} /></td>
                        <td className="px-3 py-2"><input className={inputClass} type="number" min="0" value={item.quantity || ""} onChange={(event) => updateProp(index, "quantity", event.target.value)} /></td>
                        <td className="px-3 py-2"><input className={inputClass} type="number" min="0" step="0.01" value={item.unitPrice || ""} onChange={(event) => updateProp(index, "unitPrice", event.target.value)} /></td>
                        <td className="px-3 py-2"><input className={inputClass} type="number" min="0" step="0.01" value={item.totalPrice || ""} onChange={(event) => updateProp(index, "totalPrice", event.target.value)} /></td>
                        <td className="px-3 py-2"><input className={inputClass} value={item.purchasePlatform} onChange={(event) => updateProp(index, "purchasePlatform", event.target.value)} /></td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <textarea className={`${textareaClass} min-h-20`} value={item.purchaseLink} onChange={(event) => updateProp(index, "purchaseLink", event.target.value)} />
                            <Button size="sm" variant="secondary" disabled={!item.purchaseLink.trim()} onClick={() => openReferenceUrl(item.purchaseLink)}>
                              <ExternalLink className="h-4 w-4" />
                              打开
                            </Button>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <RowImageUploader
                            images={item.images ?? []}
                            uploading={uploadingField === `prop-${index}`}
                            onUpload={(files) => void uploadRowImages("prop", index, files)}
                            onPreview={setPreviewAsset}
                            onRemove={(assetId) => removeRowImage("prop", index, assetId)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>制作备注</CardTitle>
            </CardHeader>
            <CardContent>
              <textarea className={`${textareaClass} min-h-32`} value={draft.productionNotes} onChange={(event) => setDraft((current) => ({ ...current, productionNotes: event.target.value }))} />
            </CardContent>
          </Card>
        </div>
      </div>
      {previewAsset ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/70 p-6" onClick={() => setPreviewAsset(null)}>
          <div className="max-h-full max-w-5xl overflow-hidden rounded-lg bg-white p-3 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mt-2 flex items-center justify-center" onClick={() => setPreviewAsset(null)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewAsset.url} alt={previewAsset.name} className="max-h-[82vh] max-w-full object-contain" onClick={(event) => event.stopPropagation()} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="truncate text-sm font-semibold text-foreground">{previewAsset.name}</p>
              <Button size="sm" variant="secondary" onClick={() => setPreviewAsset(null)}>
                <X className="h-4 w-4" />
                关闭
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VideoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs font-semibold text-muted">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function AssetUploader({
  accept,
  assets,
  uploading,
  onUpload,
  onPreview,
  onRemove,
}: {
  accept: string;
  assets: ProductVideoAsset[];
  uploading: boolean;
  onUpload: (files: FileList | null) => void;
  onPreview: (asset: ProductVideoAsset) => void;
  onRemove: (assetId: string) => void;
}) {
  if (accept === "image/*") {
    return (
      <div className="mt-2 rounded-md border border-border bg-surface-muted p-2">
        <ImageAppendUploader
          images={assets}
          uploading={uploading}
          onUpload={onUpload}
          onPreview={onPreview}
          onRemove={onRemove}
        />
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-border bg-surface-muted p-2">
      <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-white px-2 text-xs font-bold text-foreground hover:border-brand">
        <Upload className="h-3.5 w-3.5" />
        {uploading ? "上传中" : "上传素材"}
        <input className="hidden" type="file" accept={accept} multiple onChange={(event) => {
          onUpload(event.target.files);
          event.currentTarget.value = "";
        }} />
      </label>
      {assets.length ? (
        <div className="mt-2 grid gap-2">
          {assets.map((asset) => (
            <div key={asset.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-white px-2 py-1.5">
              <a className="min-w-0 truncate text-xs font-semibold text-brand hover:underline" href={asset.url} target="_blank" rel="noreferrer">
                {asset.name}
              </a>
              <button className="shrink-0 text-xs font-bold text-danger" type="button" onClick={() => onRemove(asset.id)}>
                移除
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RowImageUploader({
  images,
  uploading,
  onUpload,
  onPreview,
  onRemove,
}: {
  images: ProductVideoAsset[];
  uploading: boolean;
  onUpload: (files: FileList | null) => void;
  onPreview: (asset: ProductVideoAsset) => void;
  onRemove: (assetId: string) => void;
}) {
  return (
    <ImageAppendUploader images={images} uploading={uploading} onUpload={onUpload} onPreview={onPreview} onRemove={onRemove} />
  );
}

function ImageAppendUploader({
  images,
  uploading,
  onUpload,
  onPreview,
  onRemove,
}: {
  images: ProductVideoAsset[];
  uploading: boolean;
  onUpload: (files: FileList | null) => void;
  onPreview: (asset: ProductVideoAsset) => void;
  onRemove: (assetId: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((asset) => (
        <div key={asset.id} className="group relative h-20 w-20 overflow-hidden rounded-md border border-border bg-white">
          <button className="h-full w-full" type="button" onClick={() => onPreview(asset)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
          </button>
          <button
            className="absolute bottom-1 right-1 rounded bg-white/95 px-1.5 py-0.5 text-[10px] font-bold text-danger shadow"
            type="button"
            onClick={() => onRemove(asset.id)}
          >
            删除
          </button>
        </div>
      ))}
      {images.length < 5 ? (
        <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-border bg-white text-center text-xs font-bold text-foreground hover:border-brand">
          <Upload className="h-5 w-5 text-brand" />
          <span className="mt-1">{uploading ? "上传中" : "上传图片"}</span>
          <input
            className="hidden"
            type="file"
            accept="image/*"
            multiple
            disabled={uploading}
            onChange={(event) => {
              onUpload(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
      ) : null}
    </div>
  );
}

function openReferenceUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return;
  const href = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  window.open(href, "_blank", "noopener,noreferrer");
}
