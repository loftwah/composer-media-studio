export declare const IMAGE_RECEIPT_SCHEMA: string;
export declare const IMAGE_RECEIPT_VERSION: number;

export type ImageReceiptInput = {
  sourceHash: string;
  result: {
    plan: object;
    settings: object;
    width: number;
    height: number;
    mime: string;
    bytes: number;
    sha256: string;
  };
};

export type ImageReceipt = {
  schema: string;
  version: number;
  note: string;
  source: { sha256: string };
  transform: { plan: object; settings: object };
  output: { width: number; height: number; mime: string; bytes: number; sha256: string };
};

export declare function buildImageReceipt(input: ImageReceiptInput): ImageReceipt;
