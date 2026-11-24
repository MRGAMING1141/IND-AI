/**
 * Injects a lightweight sandboxed `/api/*` fetch shim into generated HTML
 * documents so full-stack prototypes work immediately inside IND AGENT's
 * live iframe preview (both HtmlPreviewModal and Split-Pane ArtifactWorkbench).
 */
export function injectPreviewApiShim(rawHtml: string): string {
  const shim = `<script>
(function(){
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  const origFetch = window.fetch.bind(window);
  const store = {
    inquiries: [],
    messages: [],
    projects: [
      { id: 'prj_1', title: 'FinLedger Treasury Platform', category: 'Full-Stack', description: 'Real-time multi-currency treasury dashboard processing 120k daily settlements with audit trails.', metrics: '42% faster reconciliation', tech: ['TypeScript', 'Node.js', 'PostgreSQL'] },
      { id: 'prj_2', title: 'PulseOps Cloud Telemetry', category: 'AI & Data', description: 'Low-latency observability console with anomaly alerts and interactive service topology maps.', metrics: '99.98% uptime SLA', tech: ['React', 'Express', 'WebSockets'] },
      { id: 'prj_3', title: 'Kala Design System', category: 'Design Systems', description: 'Accessible 48-component UI library powering 6 enterprise web products across light and dark themes.', metrics: '3x faster UI shipping', tech: ['CSS Tokens', 'TypeScript', 'Storybook'] },
      { id: 'prj_4', title: 'DocuFlow Collaborative Studio', category: 'Full-Stack', description: 'Document workflow engine with live version diffs, role approvals, and instant PDF export.', metrics: '18k active teams', tech: ['Node.js', 'Express', 'REST API'] },
    ],
    items: [],
  };
  const okJson = (data, status) => Promise.resolve(new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  }));
  window.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!url.startsWith('/api/')) return origFetch(input, init);
    const method = ((init && init.method) || 'GET').toUpperCase();
    let body = {};
    try { if (init && typeof init.body === 'string') body = JSON.parse(init.body); } catch {}
    const path = url.split('?')[0];
    if (path.includes('contact') || path.includes('inquir') || path.includes('message')) {
      if (method === 'POST') {
        const entry = Object.assign({ id: 'inq_' + Date.now(), createdAt: new Date().toISOString() }, body);
        store.inquiries.unshift(entry);
        return okJson({ ok: true, id: entry.id, inquiry: entry, data: entry, inquiries: store.inquiries }, 201);
      }
      if (method === 'DELETE') {
        const id = path.split('/').pop();
        store.inquiries = store.inquiries.filter((x) => String(x.id) !== String(id));
        return okJson({ ok: true, inquiries: store.inquiries });
      }
      return okJson(store.inquiries);
    }
    if (path.includes('project')) {
      if (method === 'POST') {
        const item = Object.assign({ id: 'prj_' + Date.now() }, body);
        store.projects.unshift(item);
        return okJson({ ok: true, project: item, projects: store.projects }, 201);
      }
      return okJson(store.projects);
    }
    if (method === 'POST') {
      const item = Object.assign({ id: 'item_' + Date.now() }, body);
      store.items.unshift(item);
      return okJson({ ok: true, item, items: store.items }, 201);
    }
    return okJson(store.items);
  };
})();
</script>`;
  if (/<head[^>]*>/i.test(rawHtml)) {
    return rawHtml.replace(/<head([^>]*)>/i, `<head$1>\n${shim}`);
  }
  return `${shim}\n${rawHtml}`;
}

export function isPreviewableLanguage(language: string, filename = ''): boolean {
  const l = language.trim().toLowerCase();
  const f = filename.trim().toLowerCase();
  return (
    l === 'html' ||
    l === 'htm' ||
    l === 'svg' ||
    f.endsWith('.html') ||
    f.endsWith('.htm') ||
    f.endsWith('.svg')
  );
}
