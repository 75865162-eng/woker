export const PRODUCT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export function formatProductAttachmentSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function productAttachmentSizeError(fileName: string, bytes: number) {
  return `${fileName} 不能超过 10 MB，当前大小为 ${formatProductAttachmentSize(bytes)}。`;
}
