export function normalizeProductImageFileIds(value: unknown, maxFileIds: number) {
  if (!Array.isArray(value)) return [];
  const fileIds = [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
  return fileIds.length <= maxFileIds ? fileIds : [];
}

export function hasAuthorizedProductImageFiles(requestedFileIds: string[], authorizedFileIds: string[]) {
  return requestedFileIds.length > 0
    && requestedFileIds.length === authorizedFileIds.length
    && requestedFileIds.every((fileId) => authorizedFileIds.includes(fileId));
}
