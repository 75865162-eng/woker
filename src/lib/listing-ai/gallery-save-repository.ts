import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { galleryThumbnailUrl, galleryAssetIds, type GallerySnapshot } from "./gallery-snapshot";

export type GallerySaveScope = { organizationId: string; workspaceId: string; userId: string };
export type GallerySaveSummary = { id: string; name: string; savedBy: string; createdAt: Date; thumbnailUrl?: string | null };
export type GallerySaveRecord = GallerySaveScope & GallerySaveSummary & { snapshot: Prisma.JsonValue };
export type GallerySaveRepository = {
  list(scope: GallerySaveScope, page: number): Promise<{ records: GallerySaveSummary[]; hasMore: boolean }>;
  find(scope: GallerySaveScope, id: string): Promise<GallerySaveRecord | null>;
  assetsAvailable(scope: GallerySaveScope, snapshot: GallerySnapshot): Promise<boolean>;
  save(scope: GallerySaveScope, name: string, savedBy: string, snapshot: GallerySnapshot): Promise<GallerySaveSummary>;
};
const summarySelect = { id: true, name: true, savedBy: true, createdAt: true } as const;

export const gallerySaveRepository: GallerySaveRepository = {
  async list(scope: GallerySaveScope, page: number) {
    const rows = await prisma.listingAiGallerySave.findMany({
      where: scope, select: { ...summarySelect, snapshot: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: page * 20, take: 21,
    });
    return { records: rows.slice(0, 20).map(({ snapshot, ...record }) => ({ ...record, thumbnailUrl: galleryThumbnailUrl(snapshot) })), hasMore: rows.length > 20 };
  },
  async find(scope: GallerySaveScope, id: string) {
    return prisma.listingAiGallerySave.findFirst({ where: { ...scope, id } });
  },
  async assetsAvailable(scope: GallerySaveScope, snapshot: GallerySnapshot) {
    const ids = galleryAssetIds(snapshot);
    if (!ids.length) return true;
    const files = await prisma.fileObject.findMany({
      where: { ...scope, storageKey: { in: ids }, status: "done" }, select: { storageKey: true },
    });
    const available = new Set(files.map(file => file.storageKey));
    return ids.every(id => available.has(id));
  },
  async save(scope: GallerySaveScope, name: string, savedBy: string, snapshot: GallerySnapshot) {
    return prisma.listingAiGallerySave.upsert({
      where: { organizationId_workspaceId_userId_name: { ...scope, name } },
      create: { ...scope, name, savedBy, snapshot: snapshot as unknown as Prisma.InputJsonValue },
      update: { savedBy, snapshot: snapshot as unknown as Prisma.InputJsonValue, createdAt: new Date() },
      select: summarySelect,
    });
  },
};
