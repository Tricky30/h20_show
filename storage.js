(() => {
  "use strict";

  const LOGS_KEY = "promptLogs";
  const PANEL_EXPANDED_KEY = "panelExpanded";
  const RESPONSE_TRACKING_STATES = new Set([
    "waiting",
    "responding",
    "completed",
    "error",
    "interrupted"
  ]);

  function isValidOptionalTimestamp(value) {
    return value === undefined ||
      (typeof value === "string" && !Number.isNaN(Date.parse(value)));
  }

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
    const measurementsAreValid = [
      "character_count",
      "word_count",
      "response_character_count",
      "response_word_count"
    ].every(
      (field) =>
        entry[field] === undefined ||
        (Number.isInteger(entry[field]) && entry[field] >= 0)
    );

    const durationIsValid =
      entry.response_duration_ms === undefined ||
      (Number.isInteger(entry.response_duration_ms) &&
        entry.response_duration_ms >= 0);
    const stateIsValid =
      entry.response_tracking_state === undefined ||
      RESPONSE_TRACKING_STATES.has(entry.response_tracking_state);
    const reasonIsValid =
      entry.response_tracking_reason === undefined ||
      typeof entry.response_tracking_reason === "string";
    const attachmentsAreAbsent =
      entry.attachment_count === undefined && entry.attachments === undefined;
    const attachmentsAreValid =
      attachmentsAreAbsent ||
      (Number.isInteger(entry.attachment_count) &&
        entry.attachment_count >= 0 &&
        Array.isArray(entry.attachments) &&
        entry.attachment_count === entry.attachments.length &&
        entry.attachments.every(isValidAttachment));

    return Boolean(
      measurementsAreValid &&
        attachmentsAreValid &&
        durationIsValid &&
        stateIsValid &&
        reasonIsValid &&
        isValidOptionalTimestamp(entry.response_started_at) &&
        isValidOptionalTimestamp(entry.response_completed_at)
    );
  }

  function isValidAttachment(attachment) {
    if (!attachment || typeof attachment !== "object") return false;
    const allowedFields = new Set([
      "category",
      "extension",
      "mime_type",
      "size_bytes",
      "width",
      "height"
    ]);
    if (Object.keys(attachment).some((field) => !allowedFields.has(field))) {
      return false;
    }
    if (!["image", "document", "data", "other"].includes(attachment.category)) {
      return false;
    }
    if (
      attachment.extension !== undefined &&
      (typeof attachment.extension !== "string" ||
        !/^[a-z0-9]{1,16}$/.test(attachment.extension))
    ) {
      return false;
    }
    if (
      attachment.mime_type !== undefined &&
      (typeof attachment.mime_type !== "string" || !attachment.mime_type)
    ) {
      return false;
    }
    for (const field of ["size_bytes", "width", "height"]) {
      if (
        attachment[field] !== undefined &&
        (!Number.isInteger(attachment[field]) || attachment[field] < 0)
      ) {
        return false;
      }
    }
    if (attachment.width === 0 || attachment.height === 0) return false;
    if (
      attachment.category !== "image" &&
      (attachment.width !== undefined || attachment.height !== undefined)
    ) {
      return false;
    }
    return true;
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

  async function updateLogEntry(id, changes) {
    const logs = await getLogs();
    const index = logs.findIndex((entry) => entry.id === id);
    if (index === -1) return null;

    const updatedEntry = { ...logs[index], ...changes, id: logs[index].id };
    if (!isValidLogEntry(updatedEntry)) {
      throw new TypeError("The updated log entry contains invalid fields.");
    }

    const updatedLogs = [...logs];
    updatedLogs[index] = updatedEntry;
    await chrome.storage.local.set({ [LOGS_KEY]: updatedLogs });
    return updatedEntry;
  }

  async function prepareResponseTrackingRecovery(maxAgeMs = 10 * 60 * 1000) {
    const logs = await getLogs();
    const now = Date.now();
    let recoverableEntry = null;
    let changed = false;
    const updatedLogs = logs.map((entry) => {
      if (
        entry.response_tracking_state !== "waiting" &&
        entry.response_tracking_state !== "responding"
      ) {
        return entry;
      }

      const age = now - Date.parse(entry.timestamp);
      if (!recoverableEntry && age >= 0 && age <= maxAgeMs) {
        recoverableEntry = entry;
        return entry;
      }

      changed = true;
      return {
        ...entry,
        response_tracking_state: "interrupted",
        response_tracking_reason: "page-reload"
      };
    });

    if (changed) {
      await chrome.storage.local.set({ [LOGS_KEY]: updatedLogs });
    }
    return recoverableEntry;
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
    updateLogEntry,
    prepareResponseTrackingRecovery,
    getPanelExpanded,
    setPanelExpanded,
    subscribeToLogs
  });
})();
