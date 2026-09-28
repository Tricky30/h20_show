# H2SHOW Prompt Activity

A dependency-free Chrome Extension (Manifest V3) that records prompt, attachment, and response metadata plus ChatGPT response duration. Prompt text, response text, filenames, and file contents are never saved. All records and the panel's expanded/collapsed preference remain in `chrome.storage.local` on the user's computer.

## Load the extension

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** in the upper-right corner.
3. Click **Load unpacked**.
4. Select this `h2show-prompt-activity` folder (the folder containing `manifest.json`).
5. Open or refresh `https://chatgpt.com/`.

After changing extension source files, return to `chrome://extensions`, click the extension's **Reload** button, and refresh ChatGPT.

## V4.1 attachment test checklist

After reloading the extension, close existing ChatGPT tabs and open a fresh one. This prevents Chrome's expected `Extension context invalidated` error after an unpacked extension reload.

1. **Text only:** Send a normal prompt without a file. Confirm the row has no attachment indicator and storage contains `attachment_count: 0` with `attachments: []`.
2. **One image:** Attach a JPG or PNG, add text, and submit. Confirm the row shows `📎 1 attachment`.
3. **Multiple images:** Attach two images and submit. Confirm the row shows `📎 2 attachments` and storage contains two metadata objects.
4. **PDF:** Attach a PDF. Confirm its category is `document`, its extension is `pdf`, and browser-provided size/MIME metadata appears when available.
5. **Another document:** Test a supported DOCX or TXT file and confirm the general `document` category.
6. **Data file:** If ChatGPT accepts it, attach CSV or XLSX and confirm the category is `data`.
7. **Attachment plus text:** Confirm prompt word/character measurements and the attachment indicator both appear on the same row.
8. **Several prompts:** Send multiple prompts where only one has a file. Confirm only that prompt row displays an attachment indicator.
9. **Remove before sending:** Select a file, remove it using ChatGPT's attachment-removal control, then submit. Confirm it is not associated with the event.
10. **Attachment-only prompt:** If ChatGPT permits it, send an attachment with no text. Confirm a prompt event is created with zero text measurements and the correct attachment count.
11. **Association:** Compare event IDs in the Console and stored records; each attachment must belong to the prompt that submitted it.
12. **Metadata accuracy:** Compare `extension`, `mime_type`, and `size_bytes` with the original file's browser/operating-system properties.
13. **Missing metadata:** For a file whose MIME type or extension is unavailable, confirm the field is omitted rather than invented and the category falls back to `other` when necessary.
14. **Image dimensions:** Compare stored `width` and `height` with the original image's pixel dimensions. If Chrome cannot decode the image, confirm those fields are omitted.
15. **Privacy:** Confirm no attachment content, image data, document text, prompt text, or response text exists in storage or H2SHOW Console messages.
16. **Filename privacy:** Confirm the original filename does not appear in the stored event.
17. **Older records:** Confirm existing V1–V4 rows still render normally without attachment indicators.
18. **V3 regression:** Confirm response timing still transitions from waiting/responding to a final duration.
19. **V4 regression:** Confirm completed responses still receive word and character measurements.
20. **Persistence:** Refresh and reopen ChatGPT. Confirm the attachment count and metadata remain on the same event.

To inspect all local records, open ChatGPT DevTools, choose the **H2SHOW Prompt Activity** execution context in the Console context dropdown, and run:

```js
chrome.storage.local.get("promptLogs").then(console.log)
```

An attachment-bearing event contains `attachment_count` and an `attachments` array. Each array item contains only observed metadata: `category`, optional `extension`, optional `mime_type`, optional `size_bytes`, and optional image `width`/`height`. There must be no filename or content field.

## V4 response-measurement test checklist

1. **Load unpacked:** Follow the loading steps above and confirm **H2SHOW Prompt Activity** appears on `chrome://extensions` without errors.
2. **Initialization:** Open ChatGPT, press `F12`, select **Console**, and confirm `[H2SHOW] Extension initialized` appears.
3. **Normal short response:** Ask a simple factual question. Confirm the row first shows `Waiting for response…`, then `Responding…`, then displays a Response section with word count, character count, and a duration.
4. **Multiple paragraphs:** Ask for three short paragraphs. Confirm all visible answer paragraphs are represented in the response measurements.
5. **Lists and headings:** Ask for a heading followed by a numbered and bulleted list. Confirm the response receives one set of measurements after completion.
6. **Response containing code:** Ask ChatGPT for a code example. Confirm code text is included, copy/action controls are excluded, and dynamic code-block rendering does not create extra log entries or finish timing early.
7. **Punctuation:** Ask for punctuation-heavy text. Punctuation counts as characters but does not become a separate word unless separated by whitespace.
8. **Long response:** Ask for a long explanation. Confirm `Responding…` remains visible during generation and measurements appear only after generation stops.
9. **Multiple prompts:** Submit several prompts in the same conversation, waiting for each response to finish. Confirm every prompt has one independent row containing its own prompt and response metadata.
10. **New conversation:** Start a new ChatGPT conversation and submit a first prompt. Confirm its timing and response measurements survive ChatGPT assigning the permanent conversation URL. Send a second prompt and verify it works too.
11. **Manual stop:** Submit a long request and click ChatGPT's stop control. Confirm the original row receives the elapsed duration and measurements for the answer content produced before the stop.
12. **ChatGPT error:** If possible, reproduce a ChatGPT response error. Confirm the row displays `Error after …` when an observable error state appears. Empty or unavailable answer text must not produce fabricated zero counts.
13. **Collapsed panel:** Collapse H2SHOW while ChatGPT is responding. Confirm it stays collapsed, then reopen it and verify the same row has its completed data.
14. **Refresh during generation:** Refresh while ChatGPT is responding. Confirm the newest recent event resumes tracking and updates the same row. The elapsed pre-refresh time is reconstructed from its submission timestamp.
15. **Exactly one entry:** Confirm one prompt adds exactly one row. In the Console, there should be one `Log entry saved` message for that prompt.
16. **Same-entry update:** Note the event ID in the Console. Confirm `Event updated: [same ID]` appears for response state changes and no second prompt row is added.
17. **Older entries:** Confirm V1/V2 entries still display normally and V3 entries still show their duration even though those records do not have response measurements.
18. **Persistence:** Refresh after a response completes and confirm its duration and response measurements remain.
19. **Local data/privacy:** In the ChatGPT DevTools Console, use the execution-context dropdown near the top of the Console to choose the **H2SHOW Prompt Activity** content-script context, then run:

   ```js
   chrome.storage.local.get(null).then(console.log)
   ```

   A completed V4 entry contains prompt metadata, timing fields, `response_character_count`, and `response_word_count`. Confirm that neither prompt text nor response text appears anywhere in storage. `panelExpanded` is stored separately.

To manually check a response count, copy only the visible assistant answer into a plain-text editor or a temporary Console string and apply the same rules: characters are Unicode code points (including whitespace), while words are non-empty groups separated by whitespace. Minor differences can occur if copied UI text includes controls that the extension intentionally excludes.

## Files

- `manifest.json` — Manifest V3 configuration, ChatGPT URL matching, storage permission, icons, and content-script load order.
- `storage.js` — The only module that reads or writes `chrome.storage.local`. It validates, sorts, and saves log entries and panel preference.
- `ui.js` — Builds the H2SHOW panel, groups entries by local calendar day, formats local times, manages collapse/reopen behavior, and listens for storage updates.
- `measurements.js` — Shared, text-source-agnostic character and word counting. It returns numeric metadata only.
- `attachments.js` — Captures browser `File` objects in memory, classifies general attachment type, extracts reliable metadata, tracks removal, and produces filename-free metadata for the submitted event.
- `detector.js` — Watches delegated click, keyboard, and form-submit events and confirms that ChatGPT actually accepted the submission before reporting it.
- `response-extractor.js` — Extracts visible answer content from the matched assistant-message subtree while excluding buttons, toolbars, scripts, icons, and other controls.
- `response-tracker.js` — Observes ChatGPT generation-state controls, assistant messages, and errors; calculates elapsed response duration and associates the matching assistant-message element with the original event.
- `content.js` — Initializes the modules, creates the initial event, measures extracted response text in memory, and coordinates response-state updates to that same event.
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

## How response measurement works

The response tracker retains the DOM element for the assistant message associated with the active event. That element is an in-memory reference only. When generation completes, `response-extractor.js` walks the answer-content subtree, preserving meaningful block boundaries for paragraphs, headings, lists, and code while ignoring controls and unrelated ChatGPT interface text.

`content.js` passes the extracted string directly to the shared `measureText` function. Character count uses Unicode code points and includes spaces and line breaks in the normalized extracted answer. Word count uses non-empty whitespace-separated groups; punctuation attached to a group remains part of the same word. Immediately after measurement, the temporary text variable is cleared, and only `response_character_count` and `response_word_count` are sent to storage alongside the existing timing fields.

The original prompt event is updated by ID; response measurement never creates a second event. If extraction cannot find answer text, the extension keeps any valid timing state but does not invent zero measurements. Older event versions remain valid because all response measurement fields are optional.

## How attachment tracking works

`attachments.js` listens for file-input changes, file drops, and pasted files without cancelling or modifying those events. When Chrome provides a `File`, the module reads only its browser-supplied name, MIME type, and byte size in memory. The name is used temporarily to obtain a lowercase extension and to recognize ChatGPT's remove-attachment control; the full filename is never returned to `content.js` or storage.

The category rules are centralized: common image types become `image`, common documents become `document`, spreadsheet/delimited formats become `data`, and uncertain types become `other`. MIME type and extension are stored only when the browser/file supplies them. File size comes directly from `File.size`. No missing field is guessed.

For an image, `createImageBitmap` locally decodes the browser `File` long enough to read its intrinsic pixel width and height, then immediately closes the bitmap. The image is not uploaded elsewhere, retained, analyzed, OCR'd, or converted. If decoding fails, dimensions are omitted.

When send is activated, the detector snapshots the currently pending attachment records at the same moment it snapshots prompt text. If submission is confirmed, only that snapshot is consumed and associated with the new event ID. Metadata resolution runs asynchronously so image decoding cannot delay response timing. Selecting and removing an attachment before submission removes it from the pending set. After confirmation, the same event is updated with `attachment_count` and the metadata array; no additional prompt event is created.
