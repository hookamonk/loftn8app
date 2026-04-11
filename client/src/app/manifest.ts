import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const appName = "LOFT №8";

  return {
    id: "/",
    name: appName,
    short_name: appName,
    description: "LOFT №8 guest and staff web app with push notifications.",
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
