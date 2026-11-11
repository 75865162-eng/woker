import { gallerySaveName, GallerySnapshotError, normalizeGallerySnapshot } from "./gallery-snapshot";
import type { GallerySaveRepository, GallerySaveScope } from "./gallery-save-repository";

export function createGallerySaveService(repository: GallerySaveRepository) {
  return {
    list(scope: GallerySaveScope, page: number) {
      return repository.list(scope, page);
    },
    async save(scope: GallerySaveScope, savedBy: string, name: unknown, value: unknown) {
      const normalizedName = gallerySaveName(name);
      const snapshot = normalizeGallerySnapshot(value);
      if (!(await repository.assetsAvailable(scope, snapshot))) {
        throw new GallerySnapshotError("工作区中有无权访问或已失效的图片，请重新上传后保存。");
      }
      return repository.save(scope, normalizedName, savedBy, snapshot);
    },
    async restore(scope: GallerySaveScope, id: string) {
      const record = await repository.find(scope, id);
      if (!record) return null;
      const snapshot = normalizeGallerySnapshot(record.snapshot);
      if (!(await repository.assetsAvailable(scope, snapshot))) {
        throw new GallerySnapshotError("此记录中有图片已失效或无权访问，无法完整恢复。");
      }
      return { record: { id: record.id, name: record.name, savedBy: record.savedBy, createdAt: record.createdAt }, snapshot };
    },
  };
}
