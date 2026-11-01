# Focus Food beta

Open **Focus Food** in the desktop sidebar or **More → Focus Food** on a phone. Development and testing stay on `beta`; this does not change ShowPilot or the ordinary Focus Assist checkpoint.

## First cooking session

1. Paste a public HTTPS recipe link and choose **Import recipe link**. The server reads Recipe JSON-LD, including HowToStep/HowToSection instructions; it does not execute page scripts or fetch images. Not all sites provide complete data or allow automated access.
2. If blocked, paste text using `Ingredients` and `Instructions` headings, enter the fields manually, or explicitly ask configured **Local AI** to organize pasted text. AI organization must copy ingredient/instruction strings verbatim; otherwise it is rejected. It can still omit information, so compare with the original.
3. Review the title, original yield, ingredient quantities and full instructions. Separate editable steps with a blank line. Check allergies, equipment, cooking times, temperatures, advance preparation, doneness and storage details against the source. Missing information is not invented.
4. **Save recipe and get ready** starts a browser-local session. Check off ingredients and optionally write a portion plan. The plan does not change ingredient quantities or nutrition.
5. Choose **I’m ready**. One original step is shown at a time. Only **Done with this step** advances; Previous returns to the prior instruction. **I’m stuck** offers an immediate offline preparation cue. Optional Local AI coaching appears separately and cannot update the recipe or advance progress.
6. Pause or close the window to keep your place. Progress, ingredient checks, portion note and a timer deadline are saved in this browser. Reopen Focus Food after a reload to continue. There is no cross-device or Obsidian synchronization in this version. Storage errors are shown; private browsing or clearing site data can remove progress.

## Timers and completion

The finished-recipe screen now includes **Nutrition facts & Macro Check**: confirm source facts and your portion, enter meal targets, then see **Yes** or **No** against those targets. Missing information prevents a forced verdict. A No offers ingredient alternatives to review without changing the recipe or inventing revised nutrition. See [FOCUS_FOOD_MACROS.md](FOCUS_FOOD_MACROS.md) for criteria, storage, sources and limitations.

### Cook-along Pal

After saving a recipe, a kitchen buddy joins ingredient preparation and follows the current instruction with pretend gathering, chopping, stirring, heating, waiting or plating props. It celebrates only when you mark the recipe checklist complete. It cannot see your food or determine doneness; animations never advance steps, change instructions or start/stop a timer. No model calls, camera or microphone access are involved. The companion stays near the top while scrolling on mobile and uses a compact scene on short screens. **Calm Pal** pauses decorative animation for the mounted cooking window. Reduced-motion, low-power, hidden-tab and hidden-window preferences also stop decorative movement. Pausing the cooking screen gives the Pal a resting pose while the timer continues. Returning or reloading derives the scene from saved recipe progress.

One named timer can run at a time. Enter its duration yourself from the source recipe. It remains active across steps, pauses and reloads. Pausing the screen **does not pause cooking or the timer**. Browsers may delay updates while sleeping/backgrounded; use a kitchen or phone alarm for critical timing. This release does not send background notifications or play an alarm sound. Marking all steps complete does not establish safe cooking/doneness. The final screen asks you to check the source before eating or portioning.

Source nutrition is displayed only if provided, with its serving basis explicitly unverified. No calorie/protein estimates, quantity scaling, dietary guarantees or food-safety values are generated.

## Boundaries

- No paid/cloud AI fallback. Recipe import, manual review, ingredient checks, cooking progress and timer need no AI. Importing contacts the selected recipe site; explicitly selected Local AI organization/coaching sends only the pasted text/current instruction to configured server Local AI. Model processing is cancellable with a 15-second signal budget.
- `/api/focus-food` is owner-only when accounts are enabled and remains behind the existing self-hosted gate. There is no machine/app action, email send, automatic memory write or background import.
- URL import accepts HTTPS on port 443 without credentials. Only public IPv4 DNS results are supported in this version; all returned IPv4 addresses must be public. Requests connect directly to a validated IP while preserving TLS SNI/certificate checks and the HTTP Host header. Redirects are revalidated, with a four-request ceiling. Private, loopback, link-local, special-use and Tailscale addresses are refused. IPv6-only sites require paste/manual entry. Cookies and credentials are never forwarded. Downloads are bounded to 1.5 MB and a 15-second overall signal budget; failed imports give a generic paste fallback without logging recipe bodies or network details.
- Original source links remain available. Recipe text is rendered as text, never executable HTML. AI-generated organization is always review-first; coaching is advisory and separate from original instructions.

## Validation and next work

A mobile Today-panel hydration mismatch exposed by the cooking reload test is also fixed: the initial server/client render now agrees before phone cards collapse.

Automated checks cover structured schema extraction, verbatim AI organization, private/redirect address rejection, pinned transport, streaming limits, owner access, offline fallback, cooking progress recovery, and mobile navigation at 320/390/700 pixels. Smoke data is isolated, not real food preparation. Owner checks should exercise a familiar recipe on iPhone, blocked imports, reload recovery and timer behavior on Unraid.

Future work: multiple recipes, consolidated groceries, safe quantity scaling, favorites/Obsidian export after explicit review, richer equipment parsing, verified nutrition data, and opt-in reliable timer notifications. A weekly planner is intentionally deferred until the single-recipe flow is tested.

Implementation references: [Schema.org Recipe](https://schema.org/Recipe), [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).
