# General Chat and Ask Anything

Open Pixel Pals and sign in as the owner. The existing Today window is the home screen. Open General Chat from workspace navigation (mobile: More → General Chat), or use /?chat=1. Ask Anything needs no category, project or Pal selection. **Pixel Pals workspace** opens the existing rooms, Food Focus and tools; those windows remain mounted when you return to General Chat.

## Conversations

Use **Conversations → New Chat** for an independent conversation. Search history searches titles and messages. Favorites appear first. Conversation controls contain rename, pin, archive, recoverable deletion, project association, collection controls and continuation. Deleted chats remain in **Recoverable deleted** until restored; this release does not automatically purge transcripts. Selecting an archived chat shows its transcript; restore it before asking another question.

Drafts stay separate per conversation in this browser. Switching chats saves the draft on Unraid too. Reload restores the selected conversation and locally cached draft. A draft typed immediately before closing the browser has not necessarily synced to another device. Conflicting edits from another tab are refused rather than silently overwritten.

**Continue in fresh chat** brings a valid compact checkpoint, or recent user goals when no checkpoint exists. Carrying project/private access needs explicit approval. To continue the original, simply select it. The UI identifies restored context. Older messages remain stored; the AI receives a bounded recent window and available checkpoint, not every old message. **Queue checkpoint** rebuilds a checkpoint locally when collection is enabled. Review checkpoints and pending memories before relying on them.

## Models and tools

Auto prefers a reachable installed local Ollama chat model, preserving the previously successful model during the conversation where possible. It can try configured key providers if local processing is unavailable and Local-Only is off. Conversation controls allow an explicit provider and Ollama model override; unavailable manual assignments produce a repair message instead of silently changing the assignment. The answering provider/model appears on replies. Browser WebGPU remains available in the original Pals rooms, not the server-persistent General Chat route.

The optional research switch permits read-only configured search for questions that ask for research/current information. Without configured search, the assistant is told that no internet results were obtained. The existing Today endpoint supplies a bounded task snapshot for explicit questions about your tasks/day. This is conservative routing using request cues, not an unrestricted autonomous tool agent. It cannot execute shell commands, send mail or modify external services. Project suggestions never move chats automatically.

## Memory and privacy

Each chat defaults to **Review**: checkpoints can be processed locally, but proposed durable memories require approval in Memory Center. **Auto** permits non-sensitive, source-backed candidates within that conversation/project; contradictions stay pending. **Off** stops collection and queues for that chat. Already saved records remain under your control in Memory Center.

Recognizable chat credentials are scrubbed before inference and new chat persistence, across General Chat, Pals and Food Focus step questions. This includes common tokens, labelled passwords/logins, cookies, private keys and credential-bearing URLs. Enable **Also mask email addresses** in conversation controls or the AI settings for standalone email masking. Intentional API keys entered in provider/settings credential fields remain functional. Unlabelled passwords, uncommon or encoded credentials and images are not reliably detected. Do not paste secrets intentionally.

Memory Center → **Scrub existing chat history** cleans live chat and memory records/versions. Browser cleanup covers known local chat stores, not provider settings. It cannot erase backups, exported files, images, copies already sent to a provider, or manually changed vault notes. Rotate any exposed credential.
