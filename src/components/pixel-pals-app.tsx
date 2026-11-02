import { scrubBrowserChatHistory } from "@/lib/chat-scrub";
import { useEffect } from "react";
import { Room } from "./room";
export function PixelPalsApp() {
  useEffect(() => {
    try {
      scrubBrowserChatHistory(localStorage);
    } catch {
      /* Optional browser storage. */
    }
  }, []);
  return <Room />;
}
