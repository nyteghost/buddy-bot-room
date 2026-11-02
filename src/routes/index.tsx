import { createFileRoute } from "@tanstack/react-router";
import { PixelPalsApp } from "@/components/pixel-pals-app";
export const Route = createFileRoute("/")({
  component: PixelPalsApp,
  head: () => ({
    meta: [
      { title: "Pixel Pals — General Chat & Ask Anything" },
      {
        name: "description",
        content:
          "Choose your pixel pals, give them a topic, and start a real multi-model AI discussion.",
      },
      { property: "og:title", content: "Pixel Pals — General Chat & Ask Anything" },
      {
        property: "og:description",
        content: "A little room for big ideas. Start a roundtable with your pixel AI pals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
