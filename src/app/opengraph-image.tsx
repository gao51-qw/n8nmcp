import { ImageResponse } from "next/og";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        background: "#080a12",
        color: "white",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "center",
        padding: 72,
        width: "100%",
      }}
    >
      <div
        style={{
          border: "1px solid #3b4257",
          borderRadius: 14,
          color: "#a7f3d0",
          display: "flex",
          fontSize: 28,
          padding: "12px 18px",
          alignSelf: "flex-start",
        }}
      >
        n8n-mcp
      </div>
      <div
        style={{
          fontSize: 68,
          fontWeight: 800,
          letterSpacing: 0,
          lineHeight: 1.04,
          marginTop: 34,
          maxWidth: 920,
        }}
      >
        Connect n8n workflows to any AI client through MCP.
      </div>
      <div
        style={{
          color: "#cbd5e1",
          fontSize: 30,
          lineHeight: 1.35,
          marginTop: 28,
          maxWidth: 900,
        }}
      >
        Hosted MCP gateway for Claude, ChatGPT, Cursor, VS Code and automation teams.
      </div>
    </div>,
    size,
  );
}
