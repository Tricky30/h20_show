# H2SHOW Prompt Activity

A dependency-free Chrome Extension (Manifest V3) that records prompt measurements and ChatGPT response duration. Prompt text is never saved. All records and the panel's expanded/collapsed preference remain in `chrome.storage.local` on the user's computer.

## Load the extension

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** in the upper-right corner.
3. Click **Load unpacked**.
4. Select this `h2show-prompt-activity` folder (the folder containing `manifest.json`).
5. Open or refresh `https://chatgpt.com/`.

After changing extension source files, return to `chrome://extensions`, click the extension's **Reload** button, and refresh ChatGPT.

## V3 response-timing test checklist

1. **Load unpacked:** Follow the loading steps above and confirm **H2SHOW Prompt Activity** appears on `chrome://extensions` without errors.
2. **Initialization:** Open ChatGPT, press `F12`, select **Console**, and confirm `[H2SHOW] Extension initialized` appears.
3. **Normal short response:** Ask a simple factual question. Confirm the row first shows `Waiting for response…`, then `Responding…`, then a duration such as `Response: 1.8 sec`.
4. **Long response:** Ask for a long explanation. Confirm `Responding…` remains visible during generation and changes to a duration only after generation stops.
5. **Response containing code:** Ask ChatGPT for a code example. Confirm dynamic code-block rendering does not create extra log entries or finish timing early.
6. **Multiple prompts:** Submit several prompts in the same conversation, waiting for each response to finish. Confirm every prompt has one independent row and duration.
7. **New conversation:** Start a new ChatGPT conversation and submit a first prompt. Confirm its timing survives ChatGPT assigning the permanent conversation URL. Send a second prompt and verify it works too.
8. **Manual stop:** Submit a long request and click ChatGPT's stop control. Confirm the original row receives the elapsed duration up to the stop.
9. **ChatGPT error:** If possible, reproduce a ChatGPT response error. Confirm the row displays `Error after …` when an observable error state appears.
10. **Collapsed panel:** Collapse H2SHOW while ChatGPT is responding. Confirm it stays collapsed, then reopen it and verify the same row has its completed duration.
11. **Refresh during generation:** Refresh while ChatGPT is responding. Confirm the newest recent event resumes tracking and updates the same row. The elapsed pre-refresh time is reconstructed from its submission timestamp.
12. **Exactly one entry:** Confirm one prompt adds exactly one row. In the Console, there should be one `Log entry saved` message for that prompt.
13. **Same-entry update:** Note the event ID in the Console. Confirm `Event updated: [same ID]` appears for response state changes and no second prompt row is added.
14. **Existing V2 entries:** Confirm entries created before V3 still display normally without response status or duration.
15. **Persistence:** Refresh after a response completes and confirm its duration remains.
16. **Local data/privacy:** In the ChatGPT DevTools Console, use the execution-context dropdown near the top of the Console to choose the **H2SHOW Prompt Activity** content-script context, then run:

   ```js
   chrome.storage.local.get(null).then(console.log)
   ```

   A completed V3 entry contains prompt metadata plus `response_started_at`, `response_completed_at`, `response_duration_ms`, and `response_tracking_state`. Confirm that no prompt-text field or submitted text appears. `panelExpanded` is stored separately.

## Files

- `manifest.json` — Manifest V3 configuration, ChatGPT URL matching, storage permission, icons, and content-script load order.
- `storage.js` — The only module that reads or writes `chrome.storage.local`. It validates, sorts, and saves log entries and panel preference.
- `ui.js` — Builds the H2SHOW panel, groups entries by local calendar day, formats local times, manages collapse/reopen behavior, and listens for storage updates.
- `measurements.js` — Calculates character and word counts from submission-time text and returns metadata only.
- `detector.js` — Watches delegated click, keyboard, and form-submit events and confirms that ChatGPT actually accepted the submission before reporting it.
- `response-tracker.js` — Observes ChatGPT generation-state controls, assistant messages, and errors; calculates elapsed response duration with `performance.now()`.
- `content.js` — Initializes the modules, creates the initial event, and coordinates response-state updates to that same event.
- `styles.css` — Isolated H2SHOW overlay styling, responsive positioning, and light/dark theme support.
- `assets/` — Cropped H2SHOW logo artwork used inside ChatGPT.
- `icons/` — H2SHOW Chrome toolbar and extension-management icons.

## How prompt detection works

The detector listens at the document level, so its event handlers remain active when ChatGPT changes conversations or replaces parts of its interface. A click only becomes a candidate when it comes from ChatGPT's enabled send button. A keyboard event only becomes a candidate when it is an unmodified submission-style `Enter` in the composer (not `Shift+Enter`, key repeat, or IME composition). Form submission is a third compatibility signal.

Detection is intentionally two-stage. An event first *arms* a pending attempt; it does not create a log. Short follow-up checks then look for ChatGPT's successful-submission signals: a new user-message element, a cleared composer, or an active response paired with changed composer text. If those signals never arrive, nothing is stored. Click, key, and form events from the same action share one pending attempt, and a short post-confirmation deduplication window prevents the same prompt from being counted twice.

At submission time, the detector keeps the composer text in memory only long enough for confirmation. After confirmation, `measurements.js` counts Unicode code points as characters, including spaces and line breaks. It counts words as non-empty groups separated by whitespace; punctuation attached to a word does not create another word. The detector then clears its in-memory text reference.

`content.js` generates a unique ID and ISO timestamp and combines them with the two numeric measurements. Only that metadata object is passed to storage. The timestamp remains timezone-neutral in storage, while `ui.js` displays it in the user's local time and calendar day.

## How response tracking works

The detector captures both the wall-clock submission time and a high-resolution `performance.now()` reading at the submit event. As the initial event is being saved, `response-tracker.js` immediately begins observing DOM mutations for ChatGPT's stop-generation control, streaming markers, newly added or changing assistant-message content, and response-error elements. ChatGPT may assign a new conversation URL through several immediate route transitions, so those transitions are accepted during a short five-second assignment window; later navigation is treated as leaving the tracked conversation.

When generation is first observed, the tracker updates the original event with `response_started_at`. When generation controls disappear, it records `response_completed_at` and calculates `response_duration_ms` from the original submission-time performance reading. Very fast responses that never expose a generation control use a mutation-driven quiet-period fallback. Storage updates for one response are serialized so a rapid start/completion sequence cannot overwrite either update.

`response_started_at` is the time the extension first observes generation in the DOM, not a network-level server timestamp. `response_duration_ms` measures from user submission through observed completion and is the primary timing value.

If the user manually stops generation, the observed stop is treated as completion and the elapsed duration is retained. If the user navigates away or a newer prompt supersedes an active tracker, the event is marked interrupted without a fabricated completion timestamp. After a page-context replacement or refresh, the newest pending event from the last ten minutes is resumed. Its pre-refresh elapsed time is reconstructed from the persistent submission timestamp, then high-resolution timing continues in the new page context. Older pending events are marked interrupted; completed events and V2 entries remain intact.
