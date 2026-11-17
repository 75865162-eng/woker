"use client";

import { useRef, useState } from "react";
import { blobToDataUrl, saveListingAiImageAsset } from "@/lib/listing-ai/image-assets";
import { applyGalleryCellStyleToExcelCell, excelCellStyleToGalleryStyle, excelCellToText, galleryCellKey, imageExtension, mergeGalleryCellStyle, setExcelCellText } from "@/lib/listing-ai/gallery-excel";
import type { ListingOptimizationRequest } from "@/lib/listing-ai/types";
import { createEmptyCompetitor, type CompetitorDraft, type GalleryCellStyle, type GalleryInfoRow, type ImagePreview, type OwnImageDraft } from "@/lib/listing-ai/workspace-draft";
type GalleryImageColumn = { key: string; type: "mine" | "competitor"; label: string; images: ImagePreview[]; index: number };
export function useGalleryExcelTransfer({ competitors, ownImages, input, cellStyles, competitorColumns, mineColumn, excelRows, infoRows, imageRowLabels, aplusRow, maxRows, updateBulletLine, setCompetitors, setOwnImages, setCellStyles, update }: { competitors: CompetitorDraft[]; ownImages: OwnImageDraft; input: ListingOptimizationRequest; cellStyles: Record<string, GalleryCellStyle>; competitorColumns: GalleryImageColumn[]; mineColumn: GalleryImageColumn; excelRows: string[]; infoRows: GalleryInfoRow[]; imageRowLabels: string[]; aplusRow: GalleryInfoRow; maxRows: number; updateBulletLine: (text: string, index: number, value: string) => string; setCompetitors: React.Dispatch<React.SetStateAction<CompetitorDraft[]>>; setOwnImages: React.Dispatch<React.SetStateAction<OwnImageDraft>>; setCellStyles: React.Dispatch<React.SetStateAction<Record<string, GalleryCellStyle>>>; update: <K extends keyof ListingOptimizationRequest>(key: K, value: ListingOptimizationRequest[K]) => void; }) {
const importInputRef = useRef<HTMLInputElement | null>(null);

const [excelBusy, setExcelBusy] = useState(false);

const [excelError, setExcelError] = useState("");

const [excelNotice, setExcelNotice] = useState("");

function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

async function handleExportGalleryExcel() {
    setExcelBusy(true);
    setExcelError("");
    setExcelNotice("");

    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Competitor Images Gallery");
      const dataColumns = [...competitorColumns, mineColumn];

      worksheet.columns = [
        { key: "label", width: 20 },
        ...dataColumns.map((column) => ({ key: column.key, width: 34 })),
      ];

      worksheet.getCell(1, 1).value = "";
      dataColumns.forEach((column, index) => {
        worksheet.getCell(1, index + 2).value = column.label;
      });

      excelRows.forEach((label, rowIndex) => {
        const rowNumber = rowIndex + 2;
        worksheet.getCell(rowNumber, 1).value = label;
        worksheet.getCell(rowNumber, 1).font = { bold: true };
      });

      infoRows.forEach((row, rowIndex) => {
        const rowNumber = imageRowLabels.length + rowIndex + 2;
        competitorColumns.forEach((column, columnIndex) => {
          const competitor = competitors[column.index];
          const cell = worksheet.getCell(rowNumber, columnIndex + 2);
          const styleKey = galleryCellKey(row.label, column.key);
          setExcelCellText(
            cell,
            competitor ? row.competitorValue(competitor) : "",
            cellStyles[styleKey],
          );
          applyGalleryCellStyleToExcelCell(
            cell,
            cellStyles[styleKey],
          );
        });
        const mineCell = worksheet.getCell(rowNumber, competitorColumns.length + 2);
        const mineStyleKey = galleryCellKey(row.label, mineColumn.key);
        setExcelCellText(mineCell, row.mineValue, cellStyles[mineStyleKey]);
        applyGalleryCellStyleToExcelCell(
          mineCell,
          cellStyles[mineStyleKey],
        );
        worksheet.getRow(rowNumber).height = row.tall ? 115 : row.multiline ? 72 : 28;
      });

      const aplusRowNumber = imageRowLabels.length + infoRows.length + 2;
      competitorColumns.forEach((column, columnIndex) => {
        const competitor = competitors[column.index];
        const cell = worksheet.getCell(aplusRowNumber, columnIndex + 2);
        const styleKey = galleryCellKey(aplusRow.label, column.key);
        setExcelCellText(
          cell,
          competitor ? aplusRow.competitorValue(competitor) : "",
          cellStyles[styleKey],
        );
        applyGalleryCellStyleToExcelCell(
          cell,
          cellStyles[styleKey],
        );
      });
      const aplusMineCell = worksheet.getCell(aplusRowNumber, competitorColumns.length + 2);
      const aplusMineStyleKey = galleryCellKey(aplusRow.label, mineColumn.key);
      setExcelCellText(
        aplusMineCell,
        aplusRow.mineValue,
        cellStyles[aplusMineStyleKey],
      );
      applyGalleryCellStyleToExcelCell(
        aplusMineCell,
        cellStyles[aplusMineStyleKey],
      );
      worksheet.getRow(aplusRowNumber).height = 72;

      imageRowLabels.forEach((_, imageIndex) => {
        const rowNumber = imageIndex + 2;
        worksheet.getRow(rowNumber).height = 150;
        worksheet.getCell(rowNumber, 1).value =
          `${imageRowLabels[imageIndex]}\n${ownImages.imageNotes?.[imageIndex] ?? ""}`.trim();

        dataColumns.forEach((column, columnIndex) => {
          const image = column.images[imageIndex];
          if (!image?.url?.startsWith("data:image/")) return;
          const imageId = workbook.addImage({
            base64: image.url,
            extension: imageExtension(image),
          });
          worksheet.addImage(imageId, {
            tl: { col: columnIndex + 1.08, row: rowNumber - 0.92 },
            ext: { width: 170, height: 140 },
          });
          worksheet.getCell(rowNumber, columnIndex + 2).value = image.name;
        });
      });

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = {
            top: { style: "thin", color: { argb: "FFE2E8F0" } },
            left: { style: "thin", color: { argb: "FFE2E8F0" } },
            bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
            right: { style: "thin", color: { argb: "FFE2E8F0" } },
          };
        });
      });

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).height = 28;
      worksheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];

      const buffer = await workbook.xlsx.writeBuffer();
      downloadBlob(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        `listing-ai-competitor-gallery-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (exportError) {
      setExcelError(exportError instanceof Error ? exportError.message : "Excel 导出失败。");
    } finally {
      setExcelBusy(false);
    }
  }

async function handleImportGalleryExcel(file: File | null) {
    if (!file) return;
    setExcelBusy(true);
    setExcelError("");
    setExcelNotice("");

    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const worksheet = workbook.worksheets[0];
      if (!worksheet) throw new Error("Excel 中没有可读取的工作表。");

      const headers: string[] = [];
      worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber > 1) headers[colNumber] = excelCellToText(cell.value).trim();
      });
      const normalizedHeaders = headers.map((header) =>
        typeof header === "string" ? header.trim().toLowerCase() : "",
      );
      const competitorColumnNumbers = normalizedHeaders
        .map((header, colNumber) => ({ header, colNumber }))
        .filter(
          ({ header }) =>
            header.startsWith("competitor") || header.startsWith("竞品"),
        )
        .map(({ colNumber }) => colNumber);
      const importedCompetitorCount = competitorColumnNumbers.length;
      const detectedMineColNumber = normalizedHeaders.findIndex(
        (header) => header === "mine",
      );
      const mineColNumber = detectedMineColNumber > 0 ? detectedMineColNumber : 0;
      const nextCompetitors = Array.from(
        { length: Math.max(importedCompetitorCount, competitors.length, 3) },
        (_, index) => ({ ...createEmptyCompetitor(), ...competitors[index], images: [...(competitors[index]?.images ?? [])] }),
      );
      const nextOwnImages: OwnImageDraft = {
        ...ownImages,
        images: [...ownImages.images],
        imageNotes: [...(ownImages.imageNotes ?? [])],
      };
      const nextInput = { ...input };
      const nextCellStyles = { ...cellStyles };
      const rowByLabel = new Map<string, number>();
      const imageRowIndexByRowNumber = new Map<number, number>();
      worksheet.eachRow((row, rowNumber) => {
        const label = excelCellToText(row.getCell(1).value).split("\n")[0].trim();
        if (!label) return;
        rowByLabel.set(label, rowNumber);
        const imageMatch = /^(?:Image|主图)\s*(\d+)$/iu.exec(label);
        if (imageMatch) {
          imageRowIndexByRowNumber.set(rowNumber, Number(imageMatch[1]) - 1);
        }
      });

      function rowNumberForLabels(labels: string[]) {
        for (const label of labels) {
          const rowNumber = rowByLabel.get(label);
          if (rowNumber) return rowNumber;
        }
        return 0;
      }

      function readCell(labels: string | string[], colNumber: number) {
        const rowNumber = rowNumberForLabels(Array.isArray(labels) ? labels : [labels]);
        return rowNumber ? excelCellToText(worksheet.getCell(rowNumber, colNumber).value) : "";
      }

      function readCellStyle(labels: string | string[], colNumber: number) {
        const rowNumber = rowNumberForLabels(Array.isArray(labels) ? labels : [labels]);
        return rowNumber
          ? excelCellStyleToGalleryStyle(worksheet.getCell(rowNumber, colNumber))
          : {};
      }

      function imageLabels(imageIndex: number) {
        const imageNumber = imageIndex + 1;
        return [`Image ${imageNumber}`, `主图${imageNumber}`, `主图 ${imageNumber}`];
      }

      function imageIndexForExcelRow(rowNumber: number) {
        for (let current = rowNumber; current >= Math.max(1, rowNumber - 1); current -= 1) {
          const imageIndex = imageRowIndexByRowNumber.get(current);
          if (
            imageIndex !== undefined &&
            imageIndex >= 0 &&
            imageIndex < maxRows
          ) {
            return imageIndex;
          }
        }
        return null;
      }

      infoRows.forEach((row) => {
        nextCompetitors.forEach((competitor, index) => {
          const colNumber = competitorColumnNumbers[index] ?? index + 2;
          const value = readCell(row.label, colNumber);
          mergeGalleryCellStyle(
            nextCellStyles,
            galleryCellKey(row.label, `competitor-${index}`),
            readCellStyle(row.label, colNumber),
          );
          if (!value) return;
          if (row.label === "ASIN") competitor.asin = value.trim();
          if (row.label === "产品卖点") competitor.productFeatures = value;
          if (row.label === "销量") competitor.sales = value;
          if (row.label === "价格") competitor.price = value;
          if (row.label === "变体") competitor.variation = value;
          if (row.label === "星级") competitor.rating = value;
          if (row.label === "评论数") competitor.reviewCount = value;
          if (row.label === "标题") competitor.title = value;
          if (row.label.startsWith("5点")) {
            const bulletIndex = Number(row.label.replace("5点", "")) - 1;
            competitor.bullets = updateBulletLine(competitor.bullets, bulletIndex, value);
          }
        });
        const mineValue = mineColNumber ? readCell(row.label, mineColNumber) : "";
        if (mineColNumber) {
          mergeGalleryCellStyle(
            nextCellStyles,
            galleryCellKey(row.label, mineColumn.key),
            readCellStyle(row.label, mineColNumber),
          );
        }
        if (mineValue) {
          if (row.label === "ASIN") nextInput.asin = mineValue.trim();
          if (row.label === "产品卖点") nextInput.mainSellingPoint1 = mineValue;
          if (row.label === "销量") nextOwnImages.sales = mineValue;
          if (row.label === "价格") nextOwnImages.price = mineValue;
          if (row.label === "变体") nextInput.variationInfo = mineValue;
          if (row.label === "星级") nextOwnImages.rating = mineValue;
          if (row.label === "评论数") nextOwnImages.reviewCount = mineValue;
          if (row.label === "标题") nextInput.currentTitle = mineValue;
          if (row.label.startsWith("5点")) {
            const bulletIndex = Number(row.label.replace("5点", "")) - 1;
            nextInput.currentBullets = updateBulletLine(
              nextInput.currentBullets,
              bulletIndex,
              mineValue,
            );
          }
        }
      });

      const aplusMineValue = mineColNumber ? readCell("A+", mineColNumber) : "";
      if (aplusMineValue) nextInput.aplusRequirements = aplusMineValue;
      nextCompetitors.forEach((competitor, index) => {
        const colNumber = competitorColumnNumbers[index] ?? index + 2;
        const value = readCell("A+", colNumber);
        mergeGalleryCellStyle(
          nextCellStyles,
          galleryCellKey(aplusRow.label, `competitor-${index}`),
          readCellStyle("A+", colNumber),
        );
        if (value) competitor.aplus = value;
      });
      if (mineColNumber) {
        mergeGalleryCellStyle(
          nextCellStyles,
          galleryCellKey(aplusRow.label, mineColumn.key),
          readCellStyle("A+", mineColNumber),
        );
      }

      for (let imageIndex = 0; imageIndex < maxRows; imageIndex += 1) {
        const rowNumber = rowNumberForLabels(imageLabels(imageIndex));
        if (!rowNumber) continue;
        const labelCell = excelCellToText(worksheet.getCell(rowNumber, 1).value);
        nextOwnImages.imageNotes[imageIndex] = labelCell.split("\n").slice(1).join("\n");
      }

      const mediaItems =
        ((workbook.model as unknown) as {
          media?: Array<{
            index?: number;
            buffer?: Uint8Array | ArrayBuffer;
            extension?: string;
          }>;
        }).media ?? [];
      const mediaById = new Map(
        mediaItems
          .filter((media): media is typeof media & { index: number } =>
            typeof media.index === "number",
          )
          .map((media) => [media.index, media]),
      );
      const worksheetImages = worksheet.getImages();
      for (const image of worksheetImages) {
        const excelRowNumber = image.range.tl.nativeRow + 1;
        const excelColNumber = image.range.tl.nativeCol + 1;
        const imageIndex = imageIndexForExcelRow(excelRowNumber);
        if (imageIndex === null || excelColNumber < 1) continue;
        const media = mediaById.get(Number(image.imageId));
        if (!media?.buffer) continue;
        const extension = media.extension || "png";
        const sourceBytes =
          media.buffer instanceof ArrayBuffer
            ? new Uint8Array(media.buffer)
            : new Uint8Array(
                media.buffer.buffer,
                media.buffer.byteOffset,
                media.buffer.byteLength,
              );
        const buffer = sourceBytes.slice().buffer;
        const blob = new Blob([buffer], {
          type: `image/${extension === "jpg" ? "jpeg" : extension}`,
        });
        const name = `imported-image-${imageIndex + 1}-${excelColNumber}.${extension}`;
        const asset = await saveListingAiImageAsset(
          new File([blob], name, { type: blob.type }),
        );
        const preview = {
          name,
          url: await blobToDataUrl(asset.blob),
          assetId: asset.id,
        };
        const competitorIndex = competitorColumnNumbers.indexOf(excelColNumber);
        if (mineColNumber && excelColNumber === mineColNumber) {
          nextOwnImages.images[imageIndex] = preview;
        } else if (competitorIndex >= 0) {
          nextCompetitors[competitorIndex].images[imageIndex] = preview;
        }
      }

      setCompetitors(nextCompetitors);
      setOwnImages(nextOwnImages);
      setCellStyles(nextCellStyles);
      (Object.keys(nextInput) as Array<keyof ListingOptimizationRequest>).forEach((key) =>
        update(key, nextInput[key]),
      );
      if (!worksheetImages.length) {
        setExcelNotice("已导入文字信息；这个 Excel 文件里没有可读取的嵌入图片。");
      }
    } catch (importError) {
      setExcelError(importError instanceof Error ? importError.message : "Excel 导入失败。");
    } finally {
      setExcelBusy(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }
return { importInputRef, excelBusy, excelError, excelNotice, setExcelError, setExcelNotice, handleExportGalleryExcel, handleImportGalleryExcel };
}
