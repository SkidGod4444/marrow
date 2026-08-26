import { ImageResponse } from "next/og";

export async function GET() {
  return new ImageResponse(<div style={{ display: "flex", width: "100%", height: "100%", background: "#111", color: "#eee", fontSize: 48, alignItems: "center", justifyContent: "center" }}>og test</div>, { width: 600, height: 300 });
}
