# Discord Companion (beta) — setup and limits

Discord is an **optional** chat interface. The Pixel Pals backend stays on Unraid; its existing General Chat and Memory Keeper persist the Discord conversation under **Discord Companion**. Discord is a third-party service that processes every command and response.

## Available in this text-only increment

- Private owner-only slash commands: \`/ping\`, \`/help\`, and \`/ask question:...\`.
- Commands are restricted to **one configured Discord user and one Discord server**; replies are ephemeral.
- \`/ask\` uses Pixel Pals' local Ollama through the existing General Chat path. No paid or cloud provider fallback; no additional memory database.
- Discord Second Brain lookup is off by default and requires separate opt-in.
- No incoming public HTTP ports or privileged Message Content intent.

**Not built yet:** voice chat, voice recording, meeting transcription, Meeting Vault, notification forwarding, Pal selection, Discord text-message listening, or attachment support. Do not rely on this text-only bot to record meetings.

## Set up Discord

1. Open https://discord.com/developers/applications and create a **new application** for Pixel Pals. On its Bot tab, create the bot and keep its **token private**.
2. Invite the application to a **private Discord server** you control. In Installation or OAuth2, grant \`bot\` and \`applications.commands\` scopes. Do not grant Administrator permission. The bot needs no privileged Message Content intent.
3. Enable **Developer Mode** in Discord settings, then copy your **Discord User ID** and **Server ID**. Copy the **Application ID** from Developer Portal → General Information.
4. Update Pixel Pals \`beta\` on Unraid. Under **Settings → Integrations → Phone & reminders → Discord Companion**, enter the application ID, server ID, your user ID and the secret bot token. Save and switch **Enable Discord Companion** to \`on\`.
5. Press **Test**. This checks the token and server membership without posting anything. The bot should connect outbound to Discord and automatically register its guild slash commands.
6. On your private Discord server, try \`/ping\`, then \`/ask\`. Pixel Pals must have a configured, reachable local Ollama model for \`/ask\`.
7. If you deliberately want approved global Second Brain facts to appear in Discord answers, switch **Allow approved memory in Discord answers** to \`on\`. Leave it off for stronger privacy.

**Do not configure a public Interactions Endpoint URL** for this version. The bot receives commands via the Discord Gateway; it does not need port forwarding or Tailscale access on the phone for Discord chat.

## Troubleshooting

- If Test says the bot cannot see the server, check the invite and Server ID.
- If /ping doesn't appear, verify that the bot was installed with \`applications.commands\`, then check Unraid logs for “Discord Companion Gateway connected” and “slash commands registered.”
- If /ask fails, verify that General Chat and Ollama work inside Pixel Pals. Only one Discord question runs at a time.
- If you change Discord credentials in Pixel Pals settings, the bot reconnects. Turn the integration off to disable the bot.
- Token storage uses the existing \`app-secrets.json\` mechanism in \`BUDDY_DATA_DIR\`; credentials aren't returned to the browser or included in Pixel Pals backups. Don't share the token with anyone.
- Discord messages are **not locally private** just because the bot's response is ephemeral. Discord still processes them. Don't send sensitive employer, calendar, or meeting content without organizational approval.

## Future roadmap

After real Discord-account testing: favorite-Pal selection, ADHD quick-capture commands, secure Working Pals notifications, voice conversations, and opt-in voice recording feeding the reviewed Meeting Memory/Obsidian pipeline. These remain unimplemented.
