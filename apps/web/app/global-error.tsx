'use client';

/**
 * Last-resort boundary for an error thrown by the ROOT layout itself (Phase
 * 16 §16) — e.g. a crash in `AppShell` or `Providers`. Next.js requires this
 * file to render its own complete `<html>`/`<body>` (the root layout is what
 * failed, so it can't be relied on), which rules out importing the app's
 * normal shared components/providers/tokens — kept deliberately minimal,
 * inline-styled, and dependency-free so it can render even when the rest of
 * the app cannot.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          background: 'Canvas',
          color: 'CanvasText',
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 380, padding: '0 16px' }}>
          <p
            style={{
              margin: '0 0 8px',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: '#b3261e',
            }}
          >
            Something went wrong
          </p>
          <h1 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 600 }}>
            Aivoryx couldn't load this page
          </h1>
          <p style={{ margin: '0 0 16px', fontSize: 14, color: 'GrayText' }}>
            Please try again. If this keeps happening, contact your workspace administrator or
            Aivoryx support.
          </p>
          {error.digest ? (
            <p
              style={{
                margin: '0 0 16px',
                fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                fontSize: 12,
                color: 'GrayText',
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              height: 36,
              padding: '0 16px',
              borderRadius: 6,
              border: 'none',
              background: '#00A19A',
              color: '#ffffff',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
