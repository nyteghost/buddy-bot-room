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

## Restaurant meal comparisons and shared targets

Implemented: separate Restaurant macros view, online menu search using configured SearXNG, official restaurant starting links, bounded public-HTTPS menu import, paste/manual nutrition review, Yes/No comparisons and browser-local saved orders. Shared meal targets appear at the top of Focus Food, with an optional daily-plan split helper. Cooking state stays separate. See [restaurant guide](FOCUS_FOOD_RESTAURANTS.md) for supported formats, privacy, tests and limitations.

## Find and import a recipe

In **Cook a recipe**, **Find a recipe** searches for meals by your own words (for example, high-protein chicken meal prep). Select **Use this recipe** to import its original ingredients, complete instructions, yield and any available source nutrition into **Review before cooking**. Check the source, then **Save recipe and get ready** starts ingredient prep and the existing Pal cook-along. No cooking progress starts from a search snippet. A current session remains protected: finish or explicitly clear it before choosing another recipe.

In-app search uses the existing configured SearXNG integration through the owner-authenticated backend. Only the query is sent, not macro targets or cooking data. **Open recipe web search** works as an external fallback; paste the resulting recipe link back into the import form. Some sites block importing or omit structured recipe data, so paste/manual entry remains available. Search descriptions are unverified and are never used as macro facts or cooking instructions. Selecting a result uses the existing public-HTTPS/DNS-pinned importer; it makes no AI call. Requests cancel when hidden or replaced, and late replies are ignored.

Regression checks cover owner access, bounded search input, private-link filtering, search-service errors, query privacy, cancellation, import-to-review, and prep only after explicit acceptance. Mobile browser smoke searches and selects a controlled recipe fixture before following the ordinary cooking flow; this does not verify every live recipe website or a real SearXNG deployment.

## Add protein powder before cooking

In **Review before cooking**, **Add protein powder** opens a label-based calculator. Enter the exact product/flavour, label serving weight in grams, and calories/protein/carbs/fat for that serving. **Remember my powder label** explicitly stores only these product fields in this browser; no dose or suitability confirmation is reused. **Forget powder label** removes the saved preference.

Enter the number of finished portions and the extra protein wanted per portion. Powder grams = extra protein × finished portions × label serving grams ÷ label protein. The amount is rounded upward to the next 0.1 g, and added calories/protein/carbs/fat are calculated from that actual rounded mass. Use a scale; displayed label servings are not assumed scoops. All inputs must be valid, finite, bounded values; missing nutrients are not zero.

Optionally confirm whether the original source nutrition is per serving or for the whole original recipe. For per-serving facts, enter the number of original source servings, which can differ from the number of new finished portions. Only complete explicit source facts and a confirmed basis permit a calculated new per-portion nutrition total. **Use my meal protein shortfall** uses the shared meal protein minimum minus the original protein per finished portion; it explains when the target is already met. It does not check that a powder addition fits the calorie budget or determine a dietary requirement.

Review the preview and confirm product allergens plus a suitable tested variation/mixing method before **Apply measured powder addition**. The button adds the weighed ingredient and updates the portion yield; it does not replace other ingredients or invent liquid amounts, mixing instructions, baking ratios, temperatures or cooking times. Review the existing instructions before starting. The calculation establishes an amount of protein powder, not whether adding it produces a workable dish.

Original ingredient lines, nutrition and yield are kept with the recipe for reference and reloads. If the original nutrition is incomplete/unconfirmed, modified recipe totals are cleared to unknown rather than reusing the unmodified recipe’s facts. Calculated totals are labelled as calculated and still need portion review in Macro Check. Edits to ingredients, instructions or yield after applying powder clear the calculated nutrition. A second powder addition is blocked until the first is removed. **Remove powder addition** removes the exact added ingredient; original facts/yield restore only when the recorded recipe values are otherwise unchanged, leaving other edits intact.

Tests cover weighed amounts, rounding, all added nutrients, original vs finished serving math, missing/invalid labels, source confirmation, remembering a label, shortfall selection, applying/removing, persistence, and 320/390/700px browser layouts. No AI call or external nutrition service is used.

## Ask about the current step

During prep, a cooking step or the completed checklist, **Ask about this step** opens an inline cooking conversation. Enter a question, then **Ask cooking assistant**. The assistant receives the complete reviewed recipe, its actual ingredient/customization list, all instructions, yield, any unverified nutrition, current stage/step and recent answered questions. Questions are labelled with the place at which they were asked. **Back to recipe** collapses the panel and focuses the current instruction. Chat never marks a step complete or changes ingredients, instructions, timers or other app data. Any cooking timer continues; use a separate alarm for critical timing.

Answers use `askPals({localOnly:true})` through the authenticated Pixel Pals backend and server-configured Ollama, including a remote host connected through Unraid. The owner’s saved engine settings must be synced as for the existing Local AI preparation cue. No browser-direct Ollama access, cloud fallback, paid provider, tool execution or automatic web lookup is used. A down/unconfigured Ollama, missing model or failed request gives a short retry/Connect Ollama message and keeps the typed question and recipe. **Stop answer**, Back, hiding Focus Food, changing steps or clearing the session aborts pending work; late replies cannot attach to a new step.

The latest six answered question/answer pairs save in the existing browser-local cooking session and restore with the recipe after reload. Only up to four recent pairs (8,000 JSON characters) are sent as context. Older answers remain labelled with their original step; a fresh question always sends the current step. Draft questions remain while the component is mounted, but are not saved across a page reload. Clearing the recipe clears its cooking chat. There is no Obsidian or cross-device chat sync.

Requests retain the 32KB endpoint limit. The client trims only older conversation to fit a 30KB UTF-8 body, never silently clips recipe instructions. An unusually long recipe that cannot fit is refused for chat while ordinary cooking remains available. Questions are limited to 1,000 characters and answers to 3,000; model requests can take up to 90 seconds and can be stopped. Every request checks owner access, recipe shape, current step/stage, history types/count/size and cancellation before inference. Provider failures never expose private addresses or raw model errors.

The assistant explains terms and context alongside the original recipe. It cannot see food, verify doneness or guarantee safety. Its prompt treats recipe/history/question text as untrusted data, preserves source quantities/times/temperatures, requests clarification when information is missing, and forbids inventing tested substitutions, added-powder methods or nutrition. These prompt boundaries cannot guarantee model accuracy; original instructions and source/product guidance remain authoritative. Replies are rendered as plain text, without executing links/HTML or applying model-generated changes.

Tests cover persistence, current-step updates, complete recipe context, history bounds, Unicode request size, owner access, Local-Only routing, readable failures, abort/late-reply handling, returning focus and preservation of timers/progress. Browser tests use controlled chat replies for the two-step UI flow/reload and a nonstreaming Ollama protocol fixture for the actual backend chat request under Local-Only mode. They do not verify the quality of a real model’s cooking advice or real-device background timer behavior.
