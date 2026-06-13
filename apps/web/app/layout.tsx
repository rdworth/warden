export const metadata = {
  title: "Warden — Escape Room Game Master",
  description: "AI Game Master operator console",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          color: "#e7e9f0",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          // Deep-purple vignette with a faint grid, matching the splash.
          background:
            "linear-gradient(rgba(124,92,200,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(124,92,200,0.045) 1px, transparent 1px), radial-gradient(1200px 700px at 50% -15%, #2a1b4a 0%, #170f2c 55%, #110a20 100%)",
          backgroundSize: "44px 44px, 44px 44px, cover",
          backgroundAttachment: "fixed",
        }}
      >
        <style>{`
          * { box-sizing: border-box; }
          ::placeholder { color: #6b7280; }
          ::-webkit-scrollbar { width: 10px; height: 10px; }
          ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 8px; }
          ::-webkit-scrollbar-track { background: transparent; }
        `}</style>
        {children}
      </body>
    </html>
  );
}
