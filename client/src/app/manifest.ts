import type { MetadataRoute } from "next";
import { getVenueName } from "@/lib/venue";

export default function manifest(): MetadataRoute.Manifest {
  const venueName = getVenueName(process.env.NEXT_PUBLIC_VENUE_SLUG);

  return {
    id: "/",
    name: venueName,
    short_name: venueName,
    description: `${venueName} guest and staff web app with push notifications.`,
    start_url: "/staff/login",
    scope: "/",
    display: "standalone",
    background_color: "#070707",
    theme_color: "#070707",
    orientation: "portrait",
    prefer_related_applications: false,
    icons: [
      {
        src: "/logo.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
