import { jsPDF } from 'jspdf';
import { autoTable, type RowInput, type UserOptions } from 'jspdf-autotable';
import { formatDate } from '../lib/calc';
import { formatNaira, type Kobo } from '../lib/money';
import type { Settings } from '../lib/types';
import { CARLITO_BOLD, CARLITO_REGULAR } from './fonts/carlito';

export const FONT = 'Carlito';
export const PAGE_W = 210;
export const PAGE_H = 297;
export const M = 16; // side margin (mm)
export const CONTENT_W = PAGE_W - M * 2;
const TOP_CONT = 30; // top margin on continuation pages
const BOTTOM = 20;

export type RGB = [number, number, number];
export const INK: RGB = [28, 25, 24];
export const ESPRESSO: RGB = [45, 41, 40];
export const MUTED: RGB = [111, 104, 98];
export const CREAM: RGB = [250, 247, 240];
export const CREAM2: RGB = [243, 238, 227];
export const LINE: RGB = [226, 219, 207];
export const RED: RGB = [168, 36, 36];

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [194, 105, 58];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface DocMeta {
  title: string; // QUOTATION, INVOICE ...
  number: string;
  meta: [string, string][]; // right-hand header lines, e.g. ["Date issued", "4 Aug 2026"]
  confidential?: boolean;
  heading?: string; // optional full-width heading under the header
}

export class PdfBuilder {
  doc: jsPDF;
  y = 0;
  accent: RGB;
  settings: Settings;
  meta: DocMeta;

  constructor(settings: Settings, meta: DocMeta) {
    this.settings = settings;
    this.meta = meta;
    this.accent = hexToRgb(settings.pdf.accent);
    this.doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    this.doc.addFileToVFS('Carlito-Regular.ttf', CARLITO_REGULAR);
    this.doc.addFont('Carlito-Regular.ttf', FONT, 'normal');
    this.doc.addFileToVFS('Carlito-Bold.ttf', CARLITO_BOLD);
    this.doc.addFont('Carlito-Bold.ttf', FONT, 'bold');
    this.doc.setFont(FONT, 'normal');
    this.doc.setProperties({ title: `${meta.title} ${meta.number}`, author: settings.company.name, creator: `${settings.company.name} Revenue Calculator` });
    this.y = this.firstHeader();
  }

  /* ----------------------------------------------------------- helpers */

  money(k: Kobo): string {
    return this.settings.pdf.currencyLabel === 'code' ? formatNaira(k, { symbol: 'NGN ' }) : formatNaira(k);
  }

  font(size: number, style: 'normal' | 'bold' = 'normal', color: RGB = INK) {
    this.doc.setFont(FONT, style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
  }

  /** Start a new page if `h` mm would not fit. */
  ensure(h: number) {
    if (this.y + h > PAGE_H - BOTTOM) {
      this.doc.addPage();
      this.y = TOP_CONT + (this.meta.confidential ? 6 : 0);
    }
  }

  gap(h = 4) {
    this.y += h;
  }

  sectionTitle(text: string) {
    this.ensure(14);
    this.font(8.5, 'bold', this.accent);
    this.doc.text(text.toUpperCase(), M, this.y, { charSpace: 0.4 });
    this.doc.setDrawColor(...LINE);
    this.doc.setLineWidth(0.25);
    this.doc.line(M, this.y + 1.8, PAGE_W - M, this.y + 1.8);
    this.y += 6.5;
  }

  paragraph(text: string, size = 9.5, color: RGB = ESPRESSO, width = CONTENT_W, x = M) {
    if (!text.trim()) return;
    this.font(size, 'normal', color);
    const lh = size * 0.42;
    for (const para of text.split(/\n/)) {
      const lines = this.doc.splitTextToSize(para, width) as string[];
      for (const line of lines) {
        this.ensure(lh + 1);
        this.doc.text(line, x, this.y);
        this.y += lh;
      }
      this.y += 1.2;
    }
  }

  bullets(items: string[], numbered = false, size = 9) {
    const list = items.map((s) => s.trim()).filter(Boolean);
    this.font(size, 'normal', ESPRESSO);
    const lh = size * 0.42;
    list.forEach((item, i) => {
      const marker = numbered ? `${i + 1}.` : '•';
      const lines = this.doc.splitTextToSize(item, CONTENT_W - 7) as string[];
      this.ensure(lh * Math.min(lines.length, 2) + 1);
      this.font(size, 'normal', numbered ? MUTED : this.accent);
      this.doc.text(marker, M + 1, this.y);
      this.font(size, 'normal', ESPRESSO);
      lines.forEach((line, j) => {
        if (j > 0) this.ensure(lh);
        this.doc.text(line, M + 7, this.y);
        this.y += lh;
      });
      this.y += 1.3;
    });
  }

  /** Two side-by-side label/value blocks (e.g. Bill to / Project). */
  infoColumns(cols: { title: string; lines: [string, string][] }[]) {
    this.y += 4;
    const colW = (CONTENT_W - 8) / cols.length;
    const lh = 4.6;
    const heights = cols.map((c) => 7 + c.lines.reduce((h, [, v]) => h + lh * Math.max(1, (this.doc.splitTextToSize(v || '—', colW - 30) as string[]).length), 0));
    const h = Math.max(...heights) + 3;
    this.ensure(h);
    const top = this.y;
    cols.forEach((c, i) => {
      const x = M + i * (colW + 8);
      this.doc.setFillColor(...CREAM);
      this.doc.setDrawColor(...LINE);
      this.doc.roundedRect(x, top - 4, colW, h, 2, 2, 'FD');
      this.font(8, 'bold', this.accent);
      this.doc.text(c.title.toUpperCase(), x + 4, top + 1, { charSpace: 0.3 });
      let yy = top + 6.5;
      c.lines.forEach(([k, v]) => {
        this.font(8.5, 'normal', MUTED);
        this.doc.text(k, x + 4, yy);
        this.font(9, 'bold', INK);
        const lines = this.doc.splitTextToSize(v || '—', colW - 30) as string[];
        lines.forEach((ln, j) => this.doc.text(ln, x + 26, yy + j * lh));
        yy += lh * lines.length;
      });
    });
    this.y = top + h + 2;
  }

  table(opts: UserOptions & { body: RowInput[] }) {
    const { styles, headStyles, footStyles, ...rest } = opts;
    autoTable(this.doc, {
      startY: this.y,
      margin: { left: M, right: M, top: TOP_CONT + (this.meta.confidential ? 6 : 0), bottom: BOTTOM },
      theme: 'plain',
      styles: { font: FONT, fontSize: 9, textColor: INK, cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 }, lineColor: LINE, lineWidth: { bottom: 0.2 }, overflow: 'linebreak', valign: 'top', ...styles },
      headStyles: { font: FONT, fontStyle: 'bold', fillColor: ESPRESSO, textColor: CREAM, fontSize: 8.5, lineWidth: 0, ...headStyles },
      footStyles: { font: FONT, fontStyle: 'bold', fillColor: CREAM2, textColor: INK, ...footStyles },
      alternateRowStyles: { fillColor: [253, 251, 247] },
      rowPageBreak: 'avoid',
      ...rest,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.y = ((this.doc as any).lastAutoTable?.finalY ?? this.y) + 5;
  }

  /** Right-aligned totals block. `strong` rows are highlighted. */
  totals(rows: { label: string; value: string; strong?: boolean; note?: string; muted?: boolean }[], width = 92) {
    const x = PAGE_W - M - width;
    const h = rows.reduce((s, r) => s + (r.strong ? 9 : 6.2) + (r.note ? 3.6 : 0), 0) + 2;
    this.ensure(h);
    rows.forEach((r) => {
      const rowH = (r.strong ? 9 : 6.2) + (r.note ? 3.6 : 0);
      if (r.strong) {
        this.doc.setFillColor(...this.accent);
        this.doc.roundedRect(x, this.y - 0.5, width, rowH, 1.5, 1.5, 'F');
        this.font(10.5, 'bold', [255, 255, 255]);
        this.doc.text(r.label, x + 3, this.y + 5.4);
        this.font(12, 'bold', [255, 255, 255]);
        this.doc.text(r.value, x + width - 3, this.y + 5.6, { align: 'right' });
      } else {
        this.font(9.2, 'normal', r.muted ? MUTED : ESPRESSO);
        this.doc.text(r.label, x + 3, this.y + 4);
        this.font(9.6, 'bold', r.muted ? MUTED : INK);
        this.doc.text(r.value, x + width - 3, this.y + 4, { align: 'right' });
        if (r.note) {
          this.font(7.5, 'normal', MUTED);
          this.doc.text(r.note, x + 3, this.y + 7.6);
        }
        this.doc.setDrawColor(...LINE);
        this.doc.line(x, this.y + rowH - 0.4, x + width, this.y + rowH - 0.4);
      }
      this.y += rowH + (r.strong ? 1.5 : 0);
    });
    this.y += 3;
  }

  /** A shaded call-out box with a title and body text. */
  callout(title: string, body: string, opts: { tone?: 'accent' | 'cream' | 'red'; bigValue?: string } = {}) {
    const tone = opts.tone ?? 'cream';
    this.font(9, 'normal');
    const lines = this.doc.splitTextToSize(body, CONTENT_W - (opts.bigValue ? 82 : 10)) as string[];
    const h = 10 + lines.length * 4 + (opts.bigValue ? 2 : 0);
    this.ensure(h + 2);
    const fill: RGB = tone === 'accent' ? [252, 240, 230] : tone === 'red' ? [251, 235, 235] : CREAM;
    const edge: RGB = tone === 'accent' ? this.accent : tone === 'red' ? RED : LINE;
    this.doc.setFillColor(...fill);
    this.doc.setDrawColor(...edge);
    this.doc.setLineWidth(0.35);
    this.doc.roundedRect(M, this.y, CONTENT_W, h, 2, 2, 'FD');
    this.doc.setFillColor(...edge);
    this.doc.rect(M, this.y, 1.6, h, 'F');
    this.font(9.5, 'bold', tone === 'red' ? RED : INK);
    this.doc.text(title, M + 5, this.y + 6);
    this.font(9, 'normal', ESPRESSO);
    lines.forEach((ln, i) => this.doc.text(ln, M + 5, this.y + 11 + i * 4));
    if (opts.bigValue) {
      this.font(17, 'bold', tone === 'red' ? RED : this.accent);
      this.doc.text(opts.bigValue, PAGE_W - M - 5, this.y + h / 2 + 2.5, { align: 'right' });
    }
    this.y += h + 5;
  }

  /* ------------------------------------------------------- page chrome */

  private wordmark(x: number, y: number, size: number) {
    const s = this.settings;
    if (s.company.logoDataUrl) {
      try {
        const props = this.doc.getImageProperties(s.company.logoDataUrl);
        const h = size * 0.62;
        const w = Math.min((props.width / props.height) * h, 60);
        this.doc.addImage(s.company.logoDataUrl, x, y - h + 1.5, w, h);
        return;
      } catch {
        /* fall back to text */
      }
    }
    this.font(size, 'bold', INK);
    const name = s.company.name.replace(/\s+Agency$/i, '');
    this.doc.text(name, x, y, { charSpace: 0.2 });
    const w = this.doc.getTextWidth(name) + name.length * 0.2;
    this.doc.setFillColor(...this.accent);
    this.doc.circle(x + w + size * 0.08, y - size * 0.06, size * 0.045, 'F');
  }

  private firstHeader(): number {
    const d = this.doc;
    const s = this.settings;
    let top = 14;
    if (this.meta.confidential) {
      this.confidentialBand();
      top += 6;
    }
    d.setFillColor(...this.accent);
    d.rect(0, 0, PAGE_W, 2.2, 'F');
    this.wordmark(M, top + 8, 22);
    this.font(8.5, 'normal', MUTED);
    const contact = [s.company.name, s.company.website, s.company.email, s.company.phone].filter(Boolean).join('  ·  ');
    d.text(contact, M, top + 14);
    if (s.company.address) d.text(s.company.address, M, top + 18);

    this.font(20, 'bold', this.accent);
    d.text(this.meta.title, PAGE_W - M, top + 7, { align: 'right', charSpace: 0.6 });
    this.font(10, 'bold', INK);
    d.text(this.meta.number, PAGE_W - M, top + 13, { align: 'right' });
    let my = top + 18;
    this.meta.meta.forEach(([k, v]) => {
      this.font(8.5, 'normal', MUTED);
      const vw = (this.doc.setFont(FONT, 'bold'), this.doc.setFontSize(8.5), this.doc.getTextWidth(v));
      this.font(8.5, 'normal', MUTED);
      d.text(`${k}`, PAGE_W - M - vw - 2, my, { align: 'right' });
      this.font(8.5, 'bold', INK);
      d.text(v, PAGE_W - M, my, { align: 'right' });
      my += 4.3;
    });
    const bottom = Math.max(top + 24, my + 1);
    d.setDrawColor(...LINE);
    d.setLineWidth(0.3);
    d.line(M, bottom, PAGE_W - M, bottom);
    let y = bottom + 8;
    if (this.meta.heading) {
      this.font(13, 'bold', INK);
      d.text(this.meta.heading, M, y);
      y += 8;
    }
    return y;
  }

  private confidentialBand() {
    const d = this.doc;
    d.setFillColor(...RED);
    d.rect(0, 2.2, PAGE_W, 6, 'F');
    this.font(8.5, 'bold', [255, 255, 255]);
    d.text('CONFIDENTIAL — INTERNAL USE ONLY  ·  DO NOT SHARE WITH CLIENTS', PAGE_W / 2, 6.3, { align: 'center', charSpace: 0.5 });
  }

  /** Draws continuation headers and footers on every page. Call once, after all content. */
  finish(): jsPDF {
    const d = this.doc;
    const total = d.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      d.setPage(i);
      if (i > 1) {
        d.setFillColor(...this.accent);
        d.rect(0, 0, PAGE_W, 2.2, 'F');
        let top = 12;
        if (this.meta.confidential) {
          this.confidentialBand();
          top += 6;
        }
        this.wordmark(M, top + 4, 13);
        this.font(9, 'bold', INK);
        d.text(`${this.meta.title}  ${this.meta.number}`, PAGE_W - M, top + 3.5, { align: 'right' });
        d.setDrawColor(...LINE);
        d.line(M, top + 8, PAGE_W - M, top + 8);
      }
      const fy = PAGE_H - 14;
      d.setDrawColor(...LINE);
      d.setLineWidth(0.3);
      d.line(M, fy - 4, PAGE_W - M, fy - 4);
      this.font(7.8, 'normal', MUTED);
      const note = this.meta.confidential ? `${this.settings.company.name} — internal financial record. Generated ${formatDate(new Date().toISOString().slice(0, 10))}.` : this.settings.pdf.footerNote;
      d.text(d.splitTextToSize(note, CONTENT_W - 40) as string[], M, fy);
      d.text(`${this.settings.company.website}`, M, fy + 4.2);
      this.font(7.8, 'bold', MUTED);
      d.text(`Page ${i} of ${total}`, PAGE_W - M, fy, { align: 'right' });
    }
    return d;
  }
}
