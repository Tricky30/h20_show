(() => {
  "use strict";

  const INSTANCE_KEY = "__h2showPromptActivityInstance";

  function createUniqueId() {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }

    return `${Date.now()}-${crypto.getRandomValues(new Uint32Array(2)).join("-")}`;
  }

  async function initialize() {
    if (globalThis[INSTANCE_KEY]) return;

    const storage = globalThis.H2ShowStorage;
    const { measureText, measurePrompt } = globalThis.H2ShowMeasurements;
    const { extractResponseText, findLatestResponseElement } =
      globalThis.H2ShowResponseExtractor;
    const { PromptActivityUI } = globalThis.H2ShowUI;
    const { PromptSubmissionDetector } = globalThis.H2ShowDetector;
    const { ResponseTracker } = globalThis.H2ShowResponseTracker;

    const recoveryEntry = await storage.prepareResponseTrackingRecovery();

    const ui = new PromptActivityUI(storage);
    await ui.initialize();

    let responseUpdateQueue = Promise.resolve();
    const updateResponseEvent = (eventId, changes) => {
      responseUpdateQueue = responseUpdateQueue
        .catch((error) => {
          console.error("[H2SHOW] Previous response update failed", error);
        })
        .then(async () => {
          const updatedEntry = await storage.updateLogEntry(eventId, changes);
          if (updatedEntry) {
            console.info(`[H2SHOW] Event updated: ${eventId}`);
          }
        });
      return responseUpdateQueue;
    };

    const responseTracker = new ResponseTracker({
      onStarted: ({ eventId, response_started_at }) =>
        updateResponseEvent(eventId, {
          response_started_at,
          response_tracking_state: "responding"
        }),
      onCompleted: async ({ eventId, responseElement, ...responseFields }) => {
        const fieldsToStore = { ...responseFields };
        let finalResponseElement = responseElement;
        let responseText = "";

        // ChatGPT can remove its streaming control one DOM update before the
        // final answer wrapper/content is queryable. Retry briefly so timing
        // completion and answer extraction do not race each other.
        for (const delay of [0, 100, 300, 700]) {
          if (delay) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          finalResponseElement =
            finalResponseElement || findLatestResponseElement();
          responseText = finalResponseElement
            ? extractResponseText(finalResponseElement)
            : "";
          if (responseText) break;
          finalResponseElement = null;
        }

        if (finalResponseElement) {
          console.info(`[H2SHOW] Response identified for event: ${eventId}`);
          if (responseText) {
            const measurements = measureText(responseText);
            responseText = "";

            fieldsToStore.response_character_count =
              measurements.character_count;
            fieldsToStore.response_word_count = measurements.word_count;

            console.info("[H2SHOW] Response measurements calculated");
            console.info(
              `[H2SHOW] Response characters: ${measurements.character_count}`
            );
            console.info(`[H2SHOW] Response words: ${measurements.word_count}`);
          } else {
            console.warn("[H2SHOW] Response text extraction was empty");
          }
        }

        await updateResponseEvent(eventId, fieldsToStore);
        if (fieldsToStore.response_character_count !== undefined) {
          console.info(
            `[H2SHOW] Event updated with response measurements: ${eventId}`
          );
        }
      },
      onInterrupted: ({ eventId, ...responseFields }) =>
        updateResponseEvent(eventId, responseFields)
    });
    responseTracker.start();

    if (recoveryEntry) {
      const submittedAt = Date.parse(recoveryEntry.timestamp);
      const elapsedSinceSubmission = Math.max(0, Date.now() - submittedAt);
      responseTracker.track({
        eventId: recoveryEntry.id,
        submittedAt,
        submittedPerformanceAt: performance.now() - elapsedSinceSubmission,
        responseStartedAt: recoveryEntry.response_started_at || null,
        resumed: true
      });
    }

    const detector = new PromptSubmissionDetector(async ({
      source,
      promptText,
      submittedAt,
      submittedPerformanceAt
    }) => {
      console.info(`[H2SHOW] Prompt detected (${source})`);

      const measurements = measurePrompt(promptText);

      const entry = {
        id: createUniqueId(),
        timestamp: new Date(submittedAt).toISOString(),
        response_tracking_state: "waiting",
        ...measurements
      };
      console.info("[H2SHOW] Timestamp recorded", entry.timestamp);

      // Start observing immediately. Response-state writes are queued behind
      // this save so very short responses cannot update a missing record.
      const savePromise = storage.saveLogEntry(entry);
      responseUpdateQueue = responseUpdateQueue.then(() => savePromise);
      responseTracker.track({
        eventId: entry.id,
        submittedAt,
        submittedPerformanceAt
      });

      await savePromise;
      console.info("[H2SHOW] Log entry saved", entry.id);
    });

    detector.start();
    globalThis[INSTANCE_KEY] = { detector, responseTracker, ui };
    console.info("[H2SHOW] Extension initialized");
  }

  initialize().catch((error) => {
    console.error("[H2SHOW] Extension failed to initialize", error);
  });
})();
