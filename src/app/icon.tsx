import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Browser tab favicon — FECSYNC mark */
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
          background: "#0B1F2A",
          borderRadius: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            width: 32,
            height: 32,
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 8,
              top: 9,
              width: 5,
              height: 14,
              background: "#1DB8A0",
              borderRadius: 1,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 8,
              top: 9,
              width: 11,
              height: 5,
              background: "#1DB8A0",
              borderRadius: 1,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 13,
              top: 16,
              width: 7,
              height: 5,
              background: "#1DB8A0",
              borderRadius: 1,
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 5,
              bottom: 6,
              width: 7,
              height: 7,
              borderRadius: 4,
              background: "#F4B942",
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  );
}
