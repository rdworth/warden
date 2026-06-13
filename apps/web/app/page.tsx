import Link from "next/link";

/**
 * Splash screen. Centered artwork at ~80% of the viewport over a dark-purple
 * backdrop matching the image. Clicking the art enters the console at /console.
 */
export default function Splash() {
  return (
    <div
      style={{
        height: "100vh",
        boxSizing: "border-box",
        overflow: "hidden",
        background: "#1a0e2e",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2vmin",
      }}
    >
      <Link href="/console" aria-label="Enter the Warden console" style={{ display: "block", lineHeight: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/splashscreen.png"
          alt="Warden — Escape Room Game Master. Press start."
          style={{
            maxWidth: "80vw",
            maxHeight: "80vh",
            width: "auto",
            height: "auto",
            cursor: "pointer",
            borderRadius: 10,
            boxShadow: "0 0 80px rgba(0, 0, 0, 0.6)",
          }}
        />
      </Link>
    </div>
  );
}
