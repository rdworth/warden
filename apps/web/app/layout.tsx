import { JetBrains_Mono } from "next/font/google";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
});

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
    <html lang="en" className={mono.className}>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          color: "#ddd5f2",
          // Deep-purple vignette with a faint grid, matching the splash.
          background:
            "linear-gradient(rgba(140,100,220,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(140,100,220,0.05) 1px, transparent 1px), radial-gradient(1100px 700px at 50% -10%, #271640 0%, #160e2a 55%, #0f0a1e 100%)",
          backgroundSize: "44px 44px, 44px 44px, cover",
          backgroundAttachment: "fixed",
        }}
      >
        <style>{`
          * { box-sizing: border-box; }
          ::placeholder { color: #7e6fb0; opacity: 1; }
          ::-webkit-scrollbar { width: 10px; height: 10px; }
          ::-webkit-scrollbar-thumb { background: rgba(167,139,250,0.22); border-radius: 8px; }
          ::-webkit-scrollbar-track { background: transparent; }
        `}</style>
        {children}
      </body>
    </html>
  );
}
