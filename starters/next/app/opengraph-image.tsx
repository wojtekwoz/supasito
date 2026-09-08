import { ImageResponse } from "next/og";
import { site } from "@/site";

export const alt = site.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The card people see when the site is shared. Same paper and ink as the page. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#F6F4EE",
          color: "#17181C",
          padding: 80,
        }}
      >
        <div style={{ display: "flex", fontSize: 28, letterSpacing: 6, textTransform: "uppercase", color: "#4B4E57" }}>
          {site.url.replace(/^https?:\/\//, "")}
        </div>
        <div style={{ display: "flex", fontSize: 92, lineHeight: 1.05, letterSpacing: -2 }}>{site.name}</div>
        <div style={{ display: "flex", fontSize: 34, color: "#4B4E57" }}>{site.description}</div>
      </div>
    ),
    size,
  );
}
