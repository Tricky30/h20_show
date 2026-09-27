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

    const ui = new PromptActivityUI(storage);
    await ui.initialize();

    const detector = new PromptSubmissionDetector(async ({ source, promptText }) => {
      console.info(`[H2SHOW] Prompt detected (${source})`);

      const measurements = measurePrompt(promptText);

      const entry = {
        id: createUniqueId(),
        timestamp: new Date().toISOString(),
        ...measurements
      };
      console.info("[H2SHOW] Timestamp recorded", entry.timestamp);

      await storage.saveLogEntry(entry);
      console.info("[H2SHOW] Log entry saved", entry.id);
    });

    detector.start();
    globalThis[INSTANCE_KEY] = { detector, ui };
    console.info("[H2SHOW] Extension initialized");
  }

  initialize().catch((error) => {
    console.error("[H2SHOW] Extension failed to initialize", error);
  });
})();
