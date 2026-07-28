/**
 * PP-OCRv4 engine loader (@gutenye/ocr-node: onnxruntime CPU, bundled models — fully local).
 * Own module so tests can mock the ESM-only dependency. tsc (CommonJS) would down-level a
 * dynamic import() into an un-loadable require() — the Function indirection keeps it a real
 * import() at runtime.
 */

export interface OcrLine {
  text: string;
}

export interface OcrEngine {
  detect(image: Buffer): Promise<OcrLine[]>;
}

const importEsm = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<{ default: { create(): Promise<OcrEngine> } }>;

export async function createOcrEngine(): Promise<OcrEngine> {
  const { default: Ocr } = await importEsm("@gutenye/ocr-node");
  return Ocr.create();
}
