# Read-only ICS calendar subscriptions — beta

Subscribe to an approved calendar through Settings → Calendar & mail → Calendar feeds. Up to six links are accepted. URLs must use public HTTPS; a webcal link is converted to HTTPS. Only import employer information if authorized.

Select Test to verify your feed or use the Calendar refresh icon to sync again immediately. The feed status shows the last successful sync and whether you are seeing an offline copy. Refresh interval defaults to 30 minutes and may be configured (5–1440 minutes).

The server rejects local/reserved address results, IP-literal addresses, URLs with embedded credentials, redirects and non-HTTPS links. It limits streamed downloads to 8 MB and 12 seconds. These checks mitigate SSRF but do not fully eliminate DNS rebinding risk; egress firewall rules provide additional protection.

Each successful feed body is saved under BUDDY_DATA_DIR/calendar-cache using a hashed filename and restrictive file permissions. The file contains private calendar events and may be included in backups. Protect or encrypt the data and backups appropriately. Last good copies remain usable for up to 30 days when offline; expired and unsubscribed copies are deleted.

Existing EXDATE, RECURRENCE-ID and time-zone handling remain; RDATE adds explicitly included recurrence instances. Some complex recurrence rules, PERIOD dates and custom time zones are not fully supported.

Not built yet: uploaded local ICS files, individually named/color-coded subscriptions, a dedicated per-feed manager, full week/month views, or calendar event editing. Work calendar and recording data still require organizational authorization.

When an event looks old, press Refresh. If it still shows Offline copy, check the feed link and provider. Never post a private feed URL in support chats or screenshots.