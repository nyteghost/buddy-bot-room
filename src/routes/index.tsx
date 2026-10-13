import { createFileRoute } from "@tanstack/react-router";
import { Room } from "@/components/room";
export const Route = createFileRoute("/")({
  component: Room,
  head: () => ({
    meta: [
      { title: "Pixel Pals Chat — The discussion room" },
      {
        name: "description",
        content:
          "Choose your pixel pals, give them a topic, and start a real multi-model AI discussion.",
      },
      { property: "og:title", content: "Pixel Pals Chat — The discussion room" },
      {
        property: "og:description",
        content: "A little room for big ideas. Start a roundtable with your pixel AI pals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});
