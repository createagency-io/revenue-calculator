import type { jsPDF } from 'jspdf';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { downloadPdf, printPdf, toOutput, type PdfOutput } from '../pdf/output';
import { useStore } from '../lib/store';
import { Button, Modal } from './ui';

interface PdfApi {
  /** Build a PDF and open the preview (with Download / Print buttons). */
  preview: (build: () => jsPDF, filename: string, title: string) => void;
  download: (build: () => jsPDF, filename: string) => void;
  print: (build: () => jsPDF, filename: string) => void;
}

const Ctx = createContext<PdfApi | null>(null);

export function PdfProvider({ children }: { children: ReactNode }) {
  const { toast } = useStore();
  const [state, setState] = useState<{ out: PdfOutput; title: string } | null>(null);

  useEffect(() => () => {
    if (state) URL.revokeObjectURL(state.out.url);
  }, [state]);

  const make = useCallback(
    (build: () => jsPDF, filename: string): PdfOutput | null => {
      try {
        return toOutput(build(), filename);
      } catch (e) {
        toast((e as Error).message, 'err');
        return null;
      }
    },
    [toast],
  );

  const api: PdfApi = {
    preview: (build, filename, title) => {
      const out = make(build, filename);
      if (out) setState({ out, title });
    },
    download: (build, filename) => {
      const out = make(build, filename);
      if (out) {
        downloadPdf(out);
        toast(`Downloaded ${filename}`);
      }
    },
    print: (build, filename) => {
      const out = make(build, filename);
      if (out) printPdf(out);
    },
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <Modal
        open={!!state}
        onClose={() => setState(null)}
        title={state?.title ?? ''}
        wide
        footer={
          state && (
            <>
              <a href={state.out.url} target="_blank" rel="noopener" className="mr-auto self-center text-xs text-muted underline">
                Open in new tab
              </a>
              <Button onClick={() => printPdf(state.out)}>Print</Button>
              <Button variant="primary" onClick={() => downloadPdf(state.out)}>
                Download PDF
              </Button>
            </>
          )
        }
      >
        {state && (
          <div>
            <object data={state.out.url} type="application/pdf" className="h-[70vh] w-full rounded-xl border border-line bg-white" aria-label="PDF preview">
              <div className="flex h-[40vh] flex-col items-center justify-center gap-3 text-center text-sm text-muted">
                <p>Your browser can’t show the preview here (common on phones).</p>
                <a className="font-medium text-ochre underline" href={state.out.url} target="_blank" rel="noopener">
                  Open the PDF
                </a>
              </div>
            </object>
            <p className="mt-2 text-xs text-muted">File name: {state.out.filename}</p>
          </div>
        )}
      </Modal>
    </Ctx.Provider>
  );
}

export function usePdf(): PdfApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePdf outside provider');
  return v;
}
