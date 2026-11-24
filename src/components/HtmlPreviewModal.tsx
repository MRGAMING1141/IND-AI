import { useState } from 'react';
import { Download, Monitor, Smartphone, Tablet, X } from 'lucide-react';
import { injectPreviewApiShim } from '../utils/previewShim';

interface HtmlPreviewModalProps {
  html: string | null;
  onClose: () => void;
}

type ViewportSize = 'desktop' | 'tablet' | 'mobile';

const VIEWPORT_WIDTHS: Record<ViewportSize, string> = {
  desktop: 'w-full',
  tablet: 'w-[768px] max-w-full',
  mobile: 'w-[390px] max-w-full',
};

export function HtmlPreviewModal({ html, onClose }: HtmlPreviewModalProps) {
  const [viewport, setViewport] = useState<ViewportSize>('desktop');

  if (!html) return null;

  const previewDoc = injectPreviewApiShim(html);

  const handleDownload = () => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ind-agent-website.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Live Website Preview"
    >
      <div className="flex h-[88vh] w-full max-w-6xl flex-col rounded-2xl border border-[#DDE3EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] shadow-2xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E1E5EA] dark:border-[#2E3033] px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
              Live Website Preview
            </h2>
            <p className="text-xs text-[#5F6368] dark:text-[#9AA0A6]">
              Sandboxed interactive preview · Test desktop, tablet, and mobile layouts
            </p>
          </div>

          {/* Viewport Switcher */}
          <div
            className="flex items-center gap-1 rounded-full border border-[#DDE3EA] dark:border-[#333537] bg-[#F0F4F9] dark:bg-[#131314] p-1"
            role="radiogroup"
            aria-label="Preview viewport size"
          >
            {(
              [
                { id: 'desktop', label: 'Desktop', icon: Monitor },
                { id: 'tablet', label: 'Tablet', icon: Tablet },
                { id: 'mobile', label: 'Mobile', icon: Smartphone },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = viewport === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setViewport(item.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white dark:bg-[#282A2C] text-[#1F1F1F] dark:text-[#E3E3E3] shadow-sm'
                      : 'text-[#5F6368] dark:text-[#9AA0A6] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#DDE3EA] dark:border-[#3C4043] bg-white dark:bg-[#282A2C] px-3.5 py-1.5 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-[#F0F4F9] dark:hover:bg-[#333537] transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Download HTML
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close live preview"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#DDE3EA] dark:border-[#3C4043] text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 items-stretch justify-center overflow-auto bg-[#F0F4F9] dark:bg-[#131314] p-3">
          <div
            className={`h-full transition-all duration-200 ${VIEWPORT_WIDTHS[viewport]} ${
              viewport !== 'desktop'
                ? 'rounded-xl border border-[#DDE3EA] dark:border-[#333537] bg-white shadow-lg overflow-hidden'
                : 'bg-white rounded-xl border border-[#E1E5EA] dark:border-[#333537] overflow-hidden'
            }`}
          >
            <iframe
              title="Generated Website Preview"
              srcDoc={previewDoc}
              sandbox="allow-scripts allow-forms"
              className="h-full w-full border-0 bg-white"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
