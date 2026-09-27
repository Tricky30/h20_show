(() => {
  "use strict";

  const LOGS_KEY = "promptLogs";
  const PANEL_EXPANDED_KEY = "panelExpanded";

  function isValidLogEntry(entry) {
    const hasValidIdentity = Boolean(
      entry &&
        typeof entry.id === "string" &&
        typeof entry.timestamp === "string" &&
        !Number.isNaN(Date.parse(entry.timestamp))
    );

    if (!hasValidIdentity) return false;

    // Measurement fields are optional for backward compatibility with logs
    // created before version 0.2.0. When present, they must be whole numbers.
    return ["character_count", "word_count"].every(
      (field) =>
        entry[field] === undefined ||
        (Number.isInteger(entry[field]) && entry[field] >= 0)
    );
  }

  async function getLogs() {
    const stored = await chrome.storage.local.get(LOGS_KEY);
    const logs = Array.isArray(stored[LOGS_KEY]) ? stored[LOGS_KEY] : [];

    return logs
      .filter(isValidLogEntry)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  }

  async function saveLogEntry(entry) {
    if (!isValidLogEntry(entry)) {
      throw new TypeError(
        "A log entry needs a valid id, ISO timestamp, and non-negative measurements."
      );
    }

    const logs = await getLogs();

    if (logs.some((existing) => existing.id === entry.id)) {
      return logs;
    }

    const updatedLogs = [entry, ...logs];
    await chrome.storage.local.set({ [LOGS_KEY]: updatedLogs });
    return updatedLogs;
  }

  async function getPanelExpanded() {
    const stored = await chrome.storage.local.get(PANEL_EXPANDED_KEY);
    return stored[PANEL_EXPANDED_KEY] !== false;
  }

  async function setPanelExpanded(expanded) {
    await chrome.storage.local.set({ [PANEL_EXPANDED_KEY]: Boolean(expanded) });
  }

  function subscribeToLogs(listener) {
    const handleChange = (changes, areaName) => {
      if (areaName !== "local" || !changes[LOGS_KEY]) {
        return;
      }

      const nextLogs = Array.isArray(changes[LOGS_KEY].newValue)
        ? changes[LOGS_KEY].newValue.filter(isValidLogEntry)
        : [];

      listener(
        nextLogs.sort(
          (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)
        )
      );
    };

    chrome.storage.onChanged.addListener(handleChange);
    return () => chrome.storage.onChanged.removeListener(handleChange);
  }

  globalThis.H2ShowStorage = Object.freeze({
    LOGS_KEY,
    PANEL_EXPANDED_KEY,
    getLogs,
    saveLogEntry,
    getPanelExpanded,
    setPanelExpanded,
    subscribeToLogs
  });
})();
