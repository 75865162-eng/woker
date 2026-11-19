"use client";

import { AlertTriangle, CheckCircle2, Download, Eye } from "lucide-react";
import { WorkbenchPageTemplate } from "@/components/templates/page-templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StandardDataTable } from "@/components/ui/table-variants";
import { formatMetricNumber } from "@/lib/logistics/utils";
import { FreightEstimator } from "@/components/logistics/freight-estimator";
import { logisticsTemplateOptions } from "./use-logistics-workbench-model";
import { useLogisticsWorkbench } from "./use-logistics-workbench";
import { UploadCard, TemplateLibraryCard, LogisticsTemplateCard, MetricCard, ExportRow } from "./logistics-workbench-cards";
export function LogisticsWorkbench() {
const { state, processingSlot, handleFileUpload, downloadExport, handleBuildB, handleBuildSaihu, rawFiles, handleBuildC, handleDownloadRenamedPdf, handlePdfUploads, busy, setState, handleDownloadInvoiceTemplate, handleBuildD, taskColumns, taskSummary, toneForLog, visibleARows, aPreviewColumns, handleBuildComparison } = useLogisticsWorkbench();
return (
    <WorkbenchPageTemplate
      context={<section className="grid gap-[var(--gap-section)] md:grid-cols-2 xl:grid-cols-5">
            <UploadCard
              title="装箱表 A"
              description="读取业务 sheet，提取 SKU、发货总数、箱号分布"
              file={state.aFile}
              isProcessing={processingSlot === "a"}
              status={
                state.aSummary
                  ? [
                      state.aSummary.imageParsingSkipped ? "快速解析" : "已识别",
                      state.aSummary.imageParsingSkipped
                        ? `${state.aSummary.latestSheetName}（已跳过图片读取）`
                        : `${state.aSummary.latestSheetName}`,
                    ]
                  : undefined
              }
              onSelect={(file) => handleFileUpload("a", file)}
            />
            <TemplateLibraryCard
              saihuFile={state.saihuFile}
              saihuSummary={state.saihuSummary}
              onDownloadB={() => {
                if (state.bExport) {
                  downloadExport("bExport");
                  return;
                }
                void handleBuildB(true);
              }}
              onSaihuSelect={(file) => handleFileUpload("saihu", file)}
              onDownloadSaihu={() => {
                if (state.saihuExport) {
                  downloadExport("saihuExport");
                  return;
                }
                void handleBuildSaihu(true);
              }}
            />
            <UploadCard
              title="包装箱表 C"
              description="按 SKU 和箱号自动回填数量、重量、尺寸"
              file={state.cFile}
              status={
                state.cExport
                  ? ["已生成", state.cExport.fileName]
                  : state.cError
                    ? ["生成失败", state.cError]
                  : state.cSummary
                    ? [state.cSummary.totalBoxes === 0 ? "识别失败" : "箱数", String(state.cSummary.totalBoxes)]
                    : undefined
              }
              actionLabel="生成 C 表"
              actionDisabled={!state.aSummary || !rawFiles.c}
              onAction={handleBuildC}
              downloadLabel="下载 C 表"
              downloadDisabled={!state.cExport}
              onDownload={() => downloadExport("cExport")}
              onSelect={(file) => handleFileUpload("c", file)}
            />
            <UploadCard
              title="箱唛 PDF"
              description="读取 PDF 页面中的货件号、仓库、FBA 编号，箱数按页数计算"
              files={state.pdfFiles}
              status={state.pdfSummaries.length ? ["票数", String(state.pdfSummaries.length)] : undefined}
              downloadLabel="下载全部箱唛"
              onDownload={() => handleDownloadRenamedPdf()}
              onSelectMany={(files) => handlePdfUploads(files)}
              multiple
            />
            <LogisticsTemplateCard
              selectedTemplate={state.selectedLogisticsTemplate}
              options={logisticsTemplateOptions}
              status={state.dExports.length ? ["已生成", `${state.dExports.length} 个物流表`] : ["模板", logisticsTemplateOptions.find((item) => item.id === state.selectedLogisticsTemplate)?.label ?? "未选择"]}
              downloadDisabled={!state.aSummary || !state.pdfSummaries.length || busy || state.selectedLogisticsTemplate !== "kaiqi"}
              onTemplateChange={(value) => setState((current) => ({ ...current, selectedLogisticsTemplate: value, dExports: [] }))}
              onDownload={() => {
                if (state.dExports.length) {
                  void handleDownloadInvoiceTemplate();
                  return;
                }
                void handleBuildD();
              }}
            />
        </section>}

        main={<div className="flex flex-col gap-[var(--gap-section)]">
        <FreightEstimator />

        <section className="grid gap-[var(--gap-section)] xl:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="text-section">任务总览</CardTitle>
                <p className="mt-1 text-sm text-muted">根据 PDF 页面解析结果展示货件信息，不再依赖文件名</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <StandardDataTable
                ariaLabel="物流任务总览"
                rows={state.pdfSummaries}
                getRowKey={(item) => item.fileNameBase}
                columns={taskColumns}
                empty="上传 PDF 后，这里会按每个货件逐条展示"
              />
              <div className="overflow-x-auto pb-2">
                <div className="flex min-w-max gap-[var(--gap-section)]">
                  <MetricCard label="SKU数" value={formatMetricNumber(taskSummary.skuCount)} />
                  <MetricCard label="发货总数" value={formatMetricNumber(taskSummary.totalShipment)} />
                  <MetricCard label="PDF票数" value={formatMetricNumber(taskSummary.pdfCount)} />
                  <MetricCard label="PDF页数" value={formatMetricNumber(taskSummary.pdfPageCount)} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-section">处理日志</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {state.logs.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 rounded-lg border border-border bg-surface-muted px-3 py-3">
                  {entry.level === "success" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                  ) : entry.level === "warning" ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-accent" />
                  ) : entry.level === "error" ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-danger" />
                  ) : (
                    <Eye className="mt-0.5 h-4 w-4 text-info" />
                  )}
                  <div className="flex-1">
                    <Badge tone={toneForLog(entry.level)}>{entry.level}</Badge>
                    <p className="mt-1 text-sm text-foreground">{entry.message}</p>
                  </div>
                </div>
              ))}
              {!state.logs.length && <div className="py-6 text-center text-sm text-muted">上传文件或执行生成动作后将在这里记录日志</div>}
            </CardContent>
          </Card>

        </section>

        <section className="grid gap-[var(--gap-section)] xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="min-w-0">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-section">A 表数据预览</CardTitle>
                <p className="mt-1 text-sm text-muted">展示已解析的 SKU、发货总数、海关编码与箱号分布</p>
              </div>
              {state.aSummary ? <Badge tone="green">{state.aSummary.latestSheetName}</Badge> : <Badge>等待上传</Badge>}
            </CardHeader>
            <CardContent>
              <StandardDataTable
                ariaLabel="A 表数据预览"
                rows={visibleARows.slice(0, 12)}
                getRowKey={(row) => `${row.sku}-${row.rowIndex}`}
                columns={aPreviewColumns}
                empty="上传 A 表后将在这里展示预览"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-section">PDF 解析列表</CardTitle>
              <Button variant="secondary" size="sm" onClick={handleBuildComparison} disabled={!state.aSummary || !state.pdfSummaries.length || busy}>
                <Download className="h-4 w-4" />
                下载创货件对比表
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {state.pdfSummaries.map((pdf) => (
                <div key={pdf.fileNameBase} className="rounded-xl border border-border bg-surface-muted p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-foreground">{pdf.renamedFileName}</p>
                      <p className="mt-1 text-xs text-muted">{pdf.shipmentTitle || "--"}</p>
                      <p className="mt-1 text-xs text-muted">
                        {pdf.shipmentName || "--"} / {pdf.warehouseCode || "--"} / {pdf.fbaCode || "--"}
                      </p>
                    </div>
                    <Badge tone="blue">{pdf.pages.length} 页</Badge>
                  </div>
                  <div className="mt-3 space-y-2">
                    {pdf.pages.map((page) => (
                      <div key={`${pdf.fileNameBase}-${page.pageNumber}`} className="rounded-lg border border-white/70 bg-surface px-3 py-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge tone="blue">第 {page.pageNumber} 页</Badge>
                            <span className="text-sm font-semibold text-foreground">{page.fbaBoxCode || "待识别箱码"}</span>
                          </div>
                          <span className="text-xs text-muted">{page.positionCode || "--"}</span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted">
                          <div>货件号：{page.shipmentName || "--"}</div>
                          <div>仓库：{page.warehouseCode || "--"}</div>
                          <div>FBA编号：{page.fbaCode || "--"}</div>
                          <div>SKU类型：{page.skuType || "--"}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {!state.pdfSummaries.length && <div className="py-6 text-center text-sm text-muted">上传 PDF 后将在这里展示逐票、逐页解析结果</div>}
            </CardContent>
          </Card>

        </section>

        <section className="grid gap-[var(--gap-section)] xl:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-section">结果文件</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ExportRow label="B 发货表" ready={Boolean(state.bExport)} onDownload={() => downloadExport("bExport")} />
              <ExportRow label="赛狐模板" ready={Boolean(state.saihuExport)} onDownload={() => downloadExport("saihuExport")} />
              <ExportRow label="C 包装箱表" ready={Boolean(state.cExport)} onDownload={() => downloadExport("cExport")} />
              <ExportRow label="装箱汇总表" ready={Boolean(state.summaryExport)} onDownload={() => downloadExport("summaryExport")} />
              <ExportRow label="创货件对比表" ready={Boolean(state.compareExport)} onDownload={() => downloadExport("compareExport")} />
              <ExportRow
                label="物流发票"
                ready={Boolean(state.dExports.length)}
                description={state.dExports.length ? `已生成 ${state.dExports.length} 个与 PDF 同名的物流表` : "尚未生成"}
                onDownload={() => handleDownloadInvoiceTemplate()}
              />
              <div className="rounded-lg border border-dashed border-border p-3 text-xs leading-6 text-muted">
                当前版本会为每个 PDF 生成一个同名物流表，例如 `货件3-LGB8-FBA19H4WYDTY-7箱.xlsx`。
                英文名目前优先使用系统内置映射，后续可补手动维护和缓存机制。
              </div>
            </CardContent>
          </Card>

        </section>
        </div>}
    />
  );
}
