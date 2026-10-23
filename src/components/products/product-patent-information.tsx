"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { FileText, Link as LinkIcon, LoaderCircle, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { uploadProductPatentAttachment } from "@/lib/products/image-assets";
import { useProductImageUrls } from "@/lib/products/signed-image-urls";
import type { ProductPatentAttachment, ProductPatentInformation, ProductPatentRecord, ProductPatentSearchChannel } from "@/lib/products/types";

const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createChannel = (name = ""): ProductPatentSearchChannel => ({ id: newId("patent-channel"), name, keywords: [], note: "", imageAssets: [] });
const createPatent = (): ProductPatentRecord => ({ id: newId("patent-record"), patentNumber: "", patentType: "", relatedUrl: "", note: "", attachments: [] });

export function normalizePatentInformation(value?: Partial<ProductPatentInformation>): ProductPatentInformation {
  return {
    searchChannels: Array.isArray(value?.searchChannels)
      ? value.searchChannels.map((channel) => ({ ...createChannel(), ...channel, keywords: Array.isArray(channel.keywords) ? channel.keywords.filter(Boolean) : [], imageAssets: Array.isArray(channel.imageAssets) ? channel.imageAssets : [] }))
      : [createChannel("抖音"), createChannel("微信公众号")],
    patents: Array.isArray(value?.patents)
      ? value.patents.map((patent) => ({ ...createPatent(), ...patent, attachments: Array.isArray(patent.attachments) ? patent.attachments : [] }))
      : [],
  };
}

function externalUrl(value: string) {
  try {
    const text = value.trim();
    if (!text || /\s/.test(text)) return "";
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text.replace(/^\/\//, "")}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function CompactAttachments({ assets, onRemove }: { assets: ProductPatentAttachment[]; onRemove: (id: string) => void }) {
  const { urls } = useProductImageUrls(assets.flatMap((asset) => [asset.id, asset.thumbFileId]));
  if (assets.length === 0) return null;
  return <div className="flex min-h-8 flex-wrap items-center gap-1">{assets.map((asset) => (
    <span key={asset.id} className="inline-flex max-w-36 items-center gap-1 rounded border border-border bg-white px-1 py-0.5 text-[11px]">
      {asset.thumbUrl && urls[asset.thumbFileId || asset.id] ? <a href={urls[asset.id] || asset.downloadUrl} target="_blank" rel="noreferrer"><img src={urls[asset.thumbFileId || asset.id]} alt={asset.name} className="h-7 w-7 rounded object-cover" /></a> : <FileText className="h-3.5 w-3.5 shrink-0 text-muted" />}
      <a href={urls[asset.id] || asset.downloadUrl} target="_blank" rel="noreferrer" className="truncate text-brand hover:underline">{asset.name}</a>
      <button type="button" aria-label={`移除 ${asset.name}`} className="text-muted hover:text-danger" onClick={() => onRemove(asset.id)}>×</button>
    </span>
  ))}</div>;
}

function AutoGrowInput({ value, onChange, onBlur, className = "" }: { value: string; onChange: (value: string) => void; onBlur?: () => void; className?: string }) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const resize = (element: HTMLTextAreaElement) => {
    element.style.height = "0px";
    element.style.height = `${Math.max(32, Math.min(element.scrollHeight + 2, 72))}px`;
  };

  useEffect(() => {
    if (inputRef.current) resize(inputRef.current);
  }, [value]);

  return <textarea ref={inputRef} rows={1} value={value} onChange={(event) => onChange(event.target.value)} onInput={(event) => resize(event.currentTarget)} onBlur={onBlur} style={{ height: 32, fontSize: 12, lineHeight: "20px" }} className={`block max-h-[72px] w-full resize-none overflow-y-auto rounded-md border border-border bg-white px-2 py-[5px] text-xs leading-5 text-foreground outline-none focus:border-brand ${className}`} />;
}

export function ProductPatentInformationSection({ value, onChange, onUploadStateChange }: { value?: ProductPatentInformation; onChange: (value: ProductPatentInformation) => void; onUploadStateChange: (busy: boolean) => void }) {
  const info = normalizePatentInformation(value);
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadTarget = useRef<{ kind: "channel" | "patent"; id: string } | null>(null);
  const update = (mutate: (current: ProductPatentInformation) => ProductPatentInformation) => onChange(mutate(info));
  const setChannel = (id: string, patch: Partial<ProductPatentSearchChannel>) => update((current) => ({ ...current, searchChannels: current.searchChannels.map((channel) => channel.id === id ? { ...channel, ...patch } : channel) }));
  const setPatent = (id: string, patch: Partial<ProductPatentRecord>) => update((current) => ({ ...current, patents: current.patents.map((patent) => patent.id === id ? { ...patent, ...patch } : patent) }));
  const addKeyword = (channel: ProductPatentSearchChannel) => {
    const keyword = (keywordDrafts[channel.id] ?? "").trim();
    if (!keyword || channel.keywords.includes(keyword)) return;
    setChannel(channel.id, { keywords: [...channel.keywords, keyword] });
    setKeywordDrafts((current) => ({ ...current, [channel.id]: "" }));
  };
  const chooseUpload = (kind: "channel" | "patent", id: string) => { uploadTarget.current = { kind, id }; inputRef.current?.click(); };
  async function upload(file?: File) {
    const target = uploadTarget.current;
    if (!file || !target) return;
    setUploading(target.id); onUploadStateChange(true);
    try {
      const asset = await uploadProductPatentAttachment(file);
      if (target.kind === "channel") {
        const channel = info.searchChannels.find((item) => item.id === target.id);
        if (channel) setChannel(target.id, { imageAssets: [...channel.imageAssets, asset] });
      } else {
        const patent = info.patents.find((item) => item.id === target.id);
        if (patent) setPatent(target.id, { attachments: [...patent.attachments, asset] });
      }
    } finally { setUploading(null); onUploadStateChange(false); uploadTarget.current = null; if (inputRef.current) inputRef.current.value = ""; }
  }

  return <Card>
    <input ref={inputRef} type="file" className="hidden" onChange={(event) => void upload(event.target.files?.[0])} />
    <CardHeader className="flex-row items-center justify-between border-b border-border py-2.5"><div><CardTitle className="text-base">专利信息</CardTitle></div></CardHeader>
    <CardContent className="p-3">
      <div className="overflow-x-auto rounded border border-border">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[150px_repeat(4,minmax(110px,1fr))_minmax(150px,1.25fr)_180px_42px] border-b border-border bg-surface-muted text-[13px] font-medium text-foreground">
            <div className="flex items-center justify-between border-r border-border px-2 py-1.5"><span>搜索渠道</span><Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label="新增搜索渠道" title="新增搜索渠道" onClick={() => update((current) => ({ ...current, searchChannels: [...current.searchChannels, createChannel()] }))}><Plus className="h-4 w-4" /></Button></div><div className="border-r border-border px-2 py-2">关键词 1</div><div className="border-r border-border px-2 py-2">关键词 2</div><div className="border-r border-border px-2 py-2">关键词 3</div><div className="border-r border-border px-2 py-2">关键词 4</div><div className="border-r border-border px-2 py-2">备注</div><div className="border-r border-border px-2 py-2">图片（160×160）</div><div />
          </div>
          {info.searchChannels.map((channel) => <div key={channel.id} className="grid grid-cols-[150px_repeat(4,minmax(110px,1fr))_minmax(150px,1.25fr)_180px_42px] border-b border-border last:border-b-0">
            <div className="border-r border-border p-2"><AutoGrowInput value={channel.name} onChange={(name) => setChannel(channel.id, { name })} /></div>
            {[0, 1, 2, 3].map((index) => <div key={index} className="border-r border-border p-2"><AutoGrowInput value={channel.keywords[index] ?? (index === 3 ? keywordDrafts[channel.id] ?? "" : "")} onChange={(value) => { if (index < 3) { const keywords = [...channel.keywords]; keywords[index] = value; setChannel(channel.id, { keywords: keywords.filter(Boolean) }); } else setKeywordDrafts((current) => ({ ...current, [channel.id]: value })); }} onBlur={index === 3 ? () => addKeyword(channel) : undefined} /></div>)}
            <div className="border-r border-border p-2"><AutoGrowInput value={channel.note} onChange={(note) => setChannel(channel.id, { note })} /></div>
            <div className="border-r border-border px-2 py-1"><CompactAttachments assets={channel.imageAssets} onRemove={(id) => setChannel(channel.id, { imageAssets: channel.imageAssets.filter((asset) => asset.id !== id) })} /><Button type="button" size="sm" variant="ghost" className="h-6 px-1 text-[11px]" disabled={uploading === channel.id} onClick={() => chooseUpload("channel", channel.id)}>{uploading === channel.id ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}图片</Button></div>
            <div className="flex items-center justify-center"><Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted hover:text-danger" title="删除渠道" onClick={() => update((current) => ({ ...current, searchChannels: current.searchChannels.filter((item) => item.id !== channel.id) }))}><Trash2 className="h-3.5 w-3.5" /></Button></div>
          </div>)}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2"><span className="text-sm font-bold">专利情况</span><span className="text-xs text-muted">未查到专利时可只保存上方查询记录</span><Button type="button" size="sm" variant="secondary" className="ml-auto h-7" onClick={() => update((current) => ({ ...current, patents: [...current.patents, createPatent()] }))}><Plus className="h-3.5 w-3.5" />新增专利</Button></div>
      {info.patents.length > 0 ? <div className="mt-2 overflow-x-auto rounded border border-border"><div className="min-w-[780px]"><div className="grid grid-cols-[190px_160px_minmax(230px,1fr)_220px_42px] border-b border-border bg-surface-muted text-xs font-semibold text-muted"><div className="border-r border-border px-2 py-2">专利号</div><div className="border-r border-border px-2 py-2">专利类型</div><div className="border-r border-border px-2 py-2">相关信息（链接，单击直接跳转）</div><div className="border-r border-border px-2 py-2">专利文件（任意格式）</div><div /></div>{info.patents.map((patent) => { const href = externalUrl(patent.relatedUrl); return <div key={patent.id} className="grid grid-cols-[190px_160px_minmax(230px,1fr)_220px_42px] border-b border-border last:border-b-0"><div className="border-r border-border p-2"><AutoGrowInput value={patent.patentNumber} onChange={(patentNumber) => setPatent(patent.id, { patentNumber })} /></div><div className="border-r border-border p-2"><AutoGrowInput value={patent.patentType} onChange={(patentType) => setPatent(patent.id, { patentType })} /></div><div className="flex border-r border-border p-2"><AutoGrowInput value={patent.relatedUrl} onChange={(relatedUrl) => setPatent(patent.id, { relatedUrl })} className="min-w-0 flex-1" />{href ? <a href={href} target="_blank" rel="noreferrer" aria-label="打开相关信息链接" title="在新标签页打开网址" className="ml-1 inline-flex h-8 shrink-0 items-center justify-center gap-1 self-start rounded-md border border-border bg-white px-2 text-xs text-brand"><LinkIcon className="h-3.5 w-3.5" />打开</a> : null}</div><div className="border-r border-border px-2 py-1"><CompactAttachments assets={patent.attachments} onRemove={(id) => setPatent(patent.id, { attachments: patent.attachments.filter((asset) => asset.id !== id) })} /><Button type="button" size="sm" variant="ghost" className="h-6 px-1 text-[11px]" disabled={uploading === patent.id} onClick={() => chooseUpload("patent", patent.id)}>{uploading === patent.id ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}上传文件</Button></div><div className="flex items-center justify-center"><Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted hover:text-danger" title="删除专利" onClick={() => update((current) => ({ ...current, patents: current.patents.filter((item) => item.id !== patent.id) }))}><Trash2 className="h-3.5 w-3.5" /></Button></div></div>; })}</div></div> : null}
    </CardContent>
  </Card>;
}
