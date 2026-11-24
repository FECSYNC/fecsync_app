import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Apple touch icon — FECSYNC mark */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0B1F2A",
          borderRadius: 36,
        }}
      >
        <div
          style={{
            display: "flex",
            width: 180,
            height: 180,
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 45,
              top: 48,
              width: 28,
              height: 84,
              background: "#1DB8A0",
              borderRadius: 4,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 45,
              top: 48,
              width: 62,
              height: 28,
              background: "#1DB8A0",
              borderRadius: 4,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 73,
              top: 92,
              width: 42,
              height: 28,
              background: "#1DB8A0",
              borderRadius: 4,
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 38,
              bottom: 42,
              width: 36,
              height: 36,
              borderRadius: 18,
              background: "#F4B942",
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  );
}
