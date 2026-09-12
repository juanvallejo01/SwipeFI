import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** Lucide "Zap" glyph — matches the Zap & Yield branding used across the UI. */
const ZAP_PATH =
  "M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #020617 0%, #0f172a 100%)",
          borderRadius: 14,
        }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="#34d399">
          <path d={ZAP_PATH} />
        </svg>
      </div>
    ),
    { ...size },
  );
}
