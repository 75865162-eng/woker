"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FieldLabel,
  ImageUploader,
  inputClass,
  textareaClass,
} from "@/components/listing-ai/studio-fields";
import {
  studioMarketplaces,
  studioTones,
  type StudioImage,
  type StudioProductInput,
} from "@/lib/listing-ai/studio";
import { imageGeneratorViews } from "@/lib/listing-ai/workspace-draft";
import { cn } from "@/lib/utils";

const maxCompetitorImages = 8;
const maxOwnImages = 6;

function lineCount(value: string) {
  return value.split("\n").filter((line) => line.trim()).length;
}

export function StudioInputForm({
  input,
  onField,
  competitorImages,
  ownImages,
  uploading,
  onUpload,
  onRemoveImage,
}: {
  input: StudioProductInput;
  onField: <K extends keyof StudioProductInput>(key: K, value: StudioProductInput[K]) => void;
  competitorImages: StudioImage[];
  ownImages: StudioImage[];
  uploading: "competitor" | "own" | "";
  onUpload: (files: FileList | null, target: "competitor" | "own") => void;
  onRemoveImage: (target: "competitor" | "own", index: number) => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex items-center justify-between gap-2">
          <CardTitle>1 产品资料</CardTitle>
          <Badge tone="gray">名称 + 至少一项卖点</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <FieldLabel label="中文名称" required />
              <input
                className={inputClass}
                value={input.chineseName}
                onChange={(event) => onField("chineseName", event.target.value)}
                placeholder="不锈钢厨房置物架"
              />
            </label>
            <label>
              <FieldLabel label="英文名称" hint="选填" />
              <input
                className={inputClass}
                value={input.englishName}
                onChange={(event) => onField("englishName", event.target.value)}
                placeholder="Stainless Steel Kitchen Rack"
              />
            </label>
            <label>
              <FieldLabel label="品牌" hint="选填" />
              <input
                className={inputClass}
                value={input.brand}
                onChange={(event) => onField("brand", event.target.value)}
                placeholder="Brand"
              />
            </label>
            <label>
              <FieldLabel label="ASIN" hint="选填" />
              <input
                className={inputClass}
                value={input.asin}
                onChange={(event) => onField("asin", event.target.value)}
                placeholder="B0XXXXXXXX"
              />
            </label>
            <label>
              <FieldLabel label="类目 / 产品类型" hint="选填" />
              <input
                className={inputClass}
                value={input.productType}
                onChange={(event) => onField("productType", event.target.value)}
                placeholder="Home & Kitchen > Racks"
              />
            </label>
            <label>
              <FieldLabel label="站点" />
              <select
                className={inputClass}
                value={input.marketplace}
                onChange={(event) =>
                  onField("marketplace", event.target.value as StudioProductInput["marketplace"])
                }
              >
                {studioMarketplaces.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <FieldLabel label="文案语气" />
            <div className="flex flex-wrap gap-1.5">
              {studioTones.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onField("tone", item.id)}
                  className={cn(
                    "h-8 rounded-full border px-3 text-xs font-bold transition",
                    input.tone === item.id
                      ? "border-brand bg-brand text-white"
                      : "border-border bg-white text-muted hover:border-brand/50 hover:text-foreground",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <FieldLabel label="产品特点" required hint="一行一条，写买家能感知的差异" />
            <textarea
              className={cn(textareaClass, "min-h-[104px]")}
              value={input.features}
              onChange={(event) => onField("features", event.target.value)}
              placeholder={"免打孔安装，不伤墙面\n承重 15kg，放满锅具不塌\n304 不锈钢，厨房潮湿环境不生锈"}
            />
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[11px] text-muted">已填 {lineCount(input.features)} 条</span>
              <span className="text-[11px] text-muted">
                这些是模型唯一允许引用的卖点来源
              </span>
            </div>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <FieldLabel label="参数" hint="一行一个，键: 值" />
              <textarea
                className={cn(textareaClass, "min-h-[112px]")}
                value={input.parameters}
                onChange={(event) => onField("parameters", event.target.value)}
                placeholder={"材质: 304 不锈钢\n承重: 15kg\n层数: 3 层\n安装方式: 免打孔"}
              />
            </label>
            <label className="block">
              <FieldLabel label="规格" hint="尺寸 / 重量 / 包装" />
              <textarea
                className={cn(textareaClass, "min-h-[112px]")}
                value={input.specifications}
                onChange={(event) => onField("specifications", event.target.value)}
                placeholder={"展开尺寸: 60 × 25 × 45 cm\n单件重量: 1.8kg\n包装: 1 件/箱，含安装配件"}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <FieldLabel label="核心关键词" hint="逗号或空格分隔" />
              <input
                className={inputClass}
                value={input.keywords}
                onChange={(event) => onField("keywords", event.target.value)}
                placeholder="kitchen rack, no drill, stainless steel"
              />
            </label>
            <label className="block">
              <FieldLabel label="禁止宣称" hint="合规红线" />
              <input
                className={inputClass}
                value={input.forbidden}
                onChange={(event) => onField("forbidden", event.target.value)}
                placeholder="不要写 best seller、100% 防水、医用级"
              />
            </label>
            <label className="block">
              <FieldLabel label="目标人群" hint="选填" />
              <input
                className={inputClass}
                value={input.targetAudience}
                onChange={(event) => onField("targetAudience", event.target.value)}
                placeholder="小户型租客、家庭主妇"
              />
            </label>
            <label className="block">
              <FieldLabel label="使用场景" hint="选填" />
              <input
                className={inputClass}
                value={input.useScenarios}
                onChange={(event) => onField("useScenarios", event.target.value)}
                placeholder="厨房台面、浴室、阳台"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between gap-2">
          <CardTitle>2 竞品参考</CardTitle>
          <Badge tone={input.competitorNames.trim() || input.competitorListing.trim() ? "blue" : "gray"}>
            {input.competitorNames.trim() || input.competitorListing.trim() ? "已提供" : "选填"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="block">
            <FieldLabel label="竞品品牌 / ASIN" hint="填了对比表才有竞品列" />
            <input
              className={inputClass}
              value={input.competitorNames}
              onChange={(event) => onField("competitorNames", event.target.value)}
              placeholder="B0XXXXXXX / 品牌名"
            />
          </label>
          <label className="block">
            <FieldLabel label="竞品标题与五点摘录" hint="粘贴原文，AI 只按摘录对比" />
            <textarea
              className={cn(textareaClass, "min-h-[104px]")}
              value={input.competitorListing}
              onChange={(event) => onField("competitorListing", event.target.value)}
              placeholder={"竞品标题：...\n1. ...\n2. ..."}
            />
          </label>

          <ImageUploader
            title="竞品图片"
            hint="1-8 张。只学角度、场景、构图和光线，不复制对方外观与品牌元素。"
            images={competitorImages}
            limit={maxCompetitorImages}
            uploading={uploading === "competitor"}
            onUpload={(files) => onUpload(files, "competitor")}
            onRemove={(index) => onRemoveImage("competitor", index)}
          />

          <ImageUploader
            title="自有产品图"
            hint="0-6 张，按顺序对应六个视图。上传后生成图才能保持你的产品真实外形；不上传只能做风格参考，不可直接上架。"
            images={ownImages}
            limit={maxOwnImages}
            uploading={uploading === "own"}
            onUpload={(files) => onUpload(files, "own")}
            onRemove={(index) => onRemoveImage("own", index)}
            viewLabels={imageGeneratorViews.map((view) => view.label)}
          />

          <label className="block">
            <FieldLabel label="图片补充要求" hint="选填" />
            <input
              className={inputClass}
              value={input.imageNotes}
              onChange={(event) => onField("imageNotes", event.target.value)}
              placeholder="例如：纯白底主图，场景图要出现小厨房"
            />
          </label>
        </CardContent>
      </Card>
    </div>
  );
}

export { maxCompetitorImages, maxOwnImages };
