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
  getLocalPath?(key: string): string;
  getPublicPath?(key: string): string;
  delete(key: string): Promise<void>;
  deletePrefix?(keyPrefix: string): Promise<void>;
};
