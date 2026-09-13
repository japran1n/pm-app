"use client";

// Audit NX-004: last-resort boundary for a throw inside app/layout.tsx
// itself. Unlike app/error.tsx this replaces the root layout entirely, so
// it must render its own <html>/<body> and can rely on no providers, no
// theme, and no app CSS — hence the inline styles.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error(error);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#fafafa",
          color: "#171717",
        }}
      >
        <div role="alert" style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: "#525252", marginBottom: 16 }}>
            The app failed to load. Reloading usually fixes this.
          </p>
          <button
            onClick={reset}
            style={{
              font: "inherit",
              fontSize: 14,
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #d4d4d4",
              background: "#ffffff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
