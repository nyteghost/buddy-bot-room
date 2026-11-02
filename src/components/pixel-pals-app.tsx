import { scrubBrowserChatHistory } from "@/lib/chat-scrub";
import { useEffect, useState } from "react";
import { Room } from "./room";
import { GeneralChat } from "./general-chat";
export function PixelPalsApp() {
  const legacyOnly = typeof __SELF_HOSTED__ === "undefined" || !__SELF_HOSTED__;
  const [workspace, setWorkspace] = useState(legacyOnly),
    [visited, setVisited] = useState(legacyOnly);
  useEffect(() => {
    try {
      scrubBrowserChatHistory(localStorage);
    } catch {
      /* Storage may be unavailable. */
    }
    if (new URLSearchParams(location.search).get("workspace") === "1") {
      setWorkspace(true);
      setVisited(true);
    }
    const show = () => {
      setVisited(true);
      setWorkspace(true);
      history.replaceState(null, "", "/?workspace=1");
    };
    const general = () => {
      setWorkspace(false);
      history.replaceState(null, "", "/");
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
      {visited && (
        <div hidden={!workspace}>
          <Room />
        </div>
      )}
    </>
  );
}
