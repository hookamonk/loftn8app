import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const appName = "LOFT№8";

  return {
    id: "/",
    name: appName,
    short_name: appName,
    description: "LOFT№8 guest and staff web app with push notifications.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#070707",
    theme_color: "#070707",
    orientation: "portrait",
    prefer_related_applications: false,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
