import { ImageResponse } from "next/og";
import { site } from "@/site";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** The browser-tab icon, drawn from the site name so a rename carries through. */
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
          background: "#17181C",
          color: "#F6F4EE",
          fontSize: 22,
          fontWeight: 600,
        }}
      >
        {site.name.trim().charAt(0).toUpperCase() || "S"}
      </div>
    ),
    size,
  );
}
