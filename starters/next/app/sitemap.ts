import type { MetadataRoute } from "next";
import { site } from "@/site";

/** One entry per page. Add a line here when you add a route. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: site.url, lastModified: new Date(), changeFrequency: "monthly", priority: 1 }];
}
