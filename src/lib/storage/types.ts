export type StoredObject = {
  key: string;
  size: number;
  contentType?: string;
};

export type StorageDriver = {
  putFile(params: {
    key: string;
    file: File;
  }): Promise<StoredObject>;
  putBuffer(params: {
    key: string;
    buffer: Buffer;
    contentType?: string;
  }): Promise<StoredObject>;
  getBuffer(key: string): Promise<Buffer>;
  getPublicPath?(key: string): string;
  delete(key: string): Promise<void>;
};
