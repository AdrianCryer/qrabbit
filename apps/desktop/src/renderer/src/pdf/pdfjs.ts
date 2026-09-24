import * as pdfjs from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

let ready = false;

/** PDF.js needs a worker; Vite bundles it as a module worker so it works from file:// in production. */
export function ensureWorker(): void {
  if (ready) return;
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  ready = true;
}

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy, TextItem } from "pdfjs-dist/types/src/display/api";
