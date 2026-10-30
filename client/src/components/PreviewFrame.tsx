import { useEffect, useRef } from 'react';

/**
 * Live preview for HTML rooms.
 *
 * User HTML is untrusted, so it renders inside an iframe that:
 *  - is sandboxed WITHOUT allow-same-origin: it gets an opaque origin, so its
 *    scripts can't read this app's cookies, localStorage (auth token) or DOM;
 *  - loads /sandbox/preview, a tiny page the server serves with its own
 *    permissive CSP. Inline <script>s in the user's page can therefore run,
 *    while the main app keeps its strict CSP (no inline scripts, no eval).
 *
 * The HTML is delivered with postMessage once the frame says it's ready.
 * A new frame is created for every run (key = run time), so state never leaks
 * from one run to the next.
 */
export function PreviewFrame({ html, runAt }: { html: string; runAt: number }) {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.type !== 'preview-ready') return;
      // The frame's origin is opaque ("null"), so '*' is the only usable target.
      frame.current?.contentWindow?.postMessage({ type: 'render', html }, '*');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [html, runAt]);

  return (
    <iframe
      key={runAt}
      ref={frame}
      className="preview-frame"
      title="HTML preview"
      src="/sandbox/preview"
      sandbox="allow-scripts allow-modals allow-forms"
    />
  );
}
