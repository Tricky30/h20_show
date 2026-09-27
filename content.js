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
    const { measurePrompt } = globalThis.H2ShowMeasurements;
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
      onCompleted: ({ eventId, ...responseFields }) =>
        updateResponseEvent(eventId, responseFields),
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
