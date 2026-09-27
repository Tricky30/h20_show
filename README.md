# H2SHOW Prompt Activity

A dependency-free Chrome Extension (Manifest V3) that records the time and basic measurements of each prompt submitted to ChatGPT. Prompt text is never saved. All records and the panel's expanded/collapsed preference remain in `chrome.storage.local` on the user's computer.

## Load the extension

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** in the upper-right corner.
3. Click **Load unpacked**.
4. Select this `h2show-prompt-activity` folder (the folder containing `manifest.json`).
5. Open or refresh `https://chatgpt.com/`.

After changing extension source files, return to `chrome://extensions`, click the extension's **Reload** button, and refresh ChatGPT.

## End-to-end test checklist

1. **Load unpacked:** Follow the loading steps above and confirm **H2SHOW Prompt Activity** appears on `chrome://extensions` without errors.
2. **Initialization:** Open ChatGPT, press `F12`, select **Console**, and confirm `[H2SHOW] Extension initialized` appears.
3. **Normal sentence:** Submit `This is a normal sentence.` and confirm the row shows `5 words • 26 characters`.
4. **One word:** Submit `Hello` and confirm the row shows `1 word • 5 characters`.
5. **Multi-line:** Type multiple lines with `Shift+Enter`, then submit with `Enter`. Confirm line breaks count as characters and the whitespace-separated words are counted.
6. **Punctuation:** Submit `Hello, world!` and confirm the row shows `2 words • 13 characters`.
7. **Very long prompt:** Paste and submit a long prompt, then confirm one row appears with plausible measurements and the page remains responsive.
8. **Keyboard:** Type a prompt and press `Enter`. Confirm exactly one measured row appears.
9. **Send button:** Type a prompt and click ChatGPT's send button. Confirm exactly one measured row appears.
10. **Collapse:** Click the `×` in the H2SHOW panel. Click the small droplet tab at the right edge to reopen it.
11. **Refresh persistence:** Collapse or expand the panel, refresh ChatGPT, and confirm logs, measurements, and panel preference remain.
12. **Reopen persistence:** Close the ChatGPT tab, open ChatGPT again, and confirm the saved logs and measurements remain.
13. **Duplicate protection:** For each submitted prompt, confirm the Console shows one `Prompt detected`, one `Timestamp recorded`, and one `Log entry saved` sequence, and the UI adds exactly one row.
14. **Local data/privacy:** In the ChatGPT DevTools Console, use the execution-context dropdown near the top of the Console to choose the **H2SHOW Prompt Activity** content-script context, then run:

   ```js
   chrome.storage.local.get(null).then(console.log)
   ```

   Each new `promptLogs` entry contains only `id`, `timestamp`, `character_count`, and `word_count`. Confirm that no prompt-text field or submitted text appears. `panelExpanded` is stored separately.

## Files

- `manifest.json` — Manifest V3 configuration, ChatGPT URL matching, storage permission, icons, and content-script load order.
- `storage.js` — The only module that reads or writes `chrome.storage.local`. It validates, sorts, and saves log entries and panel preference.
- `ui.js` — Builds the H2SHOW panel, groups entries by local calendar day, formats local times, manages collapse/reopen behavior, and listens for storage updates.
- `measurements.js` — Calculates character and word counts from submission-time text and returns metadata only.
- `detector.js` — Watches delegated click, keyboard, and form-submit events and confirms that ChatGPT actually accepted the submission before reporting it.
- `content.js` — Initializes the extension, measures confirmed prompts, creates metadata-only records, and connects detection to storage.
- `styles.css` — Isolated H2SHOW overlay styling, responsive positioning, and light/dark theme support.
- `assets/` — Cropped H2SHOW logo artwork used inside ChatGPT.
- `icons/` — H2SHOW Chrome toolbar and extension-management icons.

## How prompt detection works

The detector listens at the document level, so its event handlers remain active when ChatGPT changes conversations or replaces parts of its interface. A click only becomes a candidate when it comes from ChatGPT's enabled send button. A keyboard event only becomes a candidate when it is an unmodified submission-style `Enter` in the composer (not `Shift+Enter`, key repeat, or IME composition). Form submission is a third compatibility signal.

Detection is intentionally two-stage. An event first *arms* a pending attempt; it does not create a log. Short follow-up checks then look for ChatGPT's successful-submission signals: a new user-message element, a cleared composer, or an active response paired with changed composer text. If those signals never arrive, nothing is stored. Click, key, and form events from the same action share one pending attempt, and a short post-confirmation deduplication window prevents the same prompt from being counted twice.

At submission time, the detector keeps the composer text in memory only long enough for confirmation. After confirmation, `measurements.js` counts Unicode code points as characters, including spaces and line breaks. It counts words as non-empty groups separated by whitespace; punctuation attached to a word does not create another word. The detector then clears its in-memory text reference.

`content.js` generates a unique ID and ISO timestamp and combines them with the two numeric measurements. Only that metadata object is passed to storage. The timestamp remains timezone-neutral in storage, while `ui.js` displays it in the user's local time and calendar day.
