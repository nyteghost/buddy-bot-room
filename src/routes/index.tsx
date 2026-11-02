import { createFileRoute } from "@tanstack/react-router";
import { PixelPalsApp } from "@/components/pixel-pals-app";
export const Route = createFileRoute("/")({
  component: PixelPalsApp,
  head: () => ({
    meta: [
      { title: "Pixel Pals — Today at a glance" },
      {
        name: "description",
        content:
          "Your day at a glance: tasks, calendar, weather, Focus Assist and General Chat.",
      },
      { property: "og:title", content: "Pixel Pals — Today at a glance" },
      {
        property: "og:description",
        content: "A little room for big ideas. Start a roundtable with your pixel AI pals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
