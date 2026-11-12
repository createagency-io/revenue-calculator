import type { jsPDF } from 'jspdf';

export interface PdfOutput {
  url: string;
  filename: string;
  doc: jsPDF;
}

export function toOutput(doc: jsPDF, filename: string): PdfOutput {
  const blob = doc.output('blob');
  return { url: URL.createObjectURL(blob), filename, doc };
}

export function downloadPdf(out: PdfOutput) {
  out.doc.save(out.filename);
}

/** Print via a hidden iframe; falls back to opening the PDF in a new tab (mobile browsers). */
export function printPdf(out: PdfOutput) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.src = out.url;
  const fallback = () => window.open(out.url, '_blank', 'noopener');
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      fallback();
    }
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    frame.remove();
    fallback();
  }
}

export function safeFilePart(s: string): string {
  return s.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'document';
}
