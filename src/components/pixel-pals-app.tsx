import { appEntry } from "@/lib/app-entry";
import { scrubBrowserChatHistory } from "@/lib/chat-scrub";
import { useEffect, useState } from "react";
import { Room } from "./room";
import { GeneralChat } from "./general-chat";
export function PixelPalsApp() {
  const [workspace, setWorkspace] = useState(true);
  useEffect(() => {
    try {
      scrubBrowserChatHistory(localStorage);
    } catch {
      /* Storage may be unavailable. */
    }
    setWorkspace(appEntry(location.search) !== "chat");
    const show = () => {
      setWorkspace(true);
      history.replaceState(null, "", "/?workspace=1");
    };
    const general = () => {
      setWorkspace(false);
      history.replaceState(null, "", "/?chat=1");
    };
    window.addEventListener("pixelpals:workspace", show);
    window.addEventListener("pixelpals:general-chat", general);
    return () => {
      window.removeEventListener("pixelpals:workspace", show);
      window.removeEventListener("pixelpals:general-chat", general);
    };
  }, []);
  return (
    <>
      <div hidden={workspace}>
        <GeneralChat open={!workspace} />
      </div>
      <div hidden={!workspace}>
        <Room />
      </div>
    </>
  );
}
