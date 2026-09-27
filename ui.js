(() => {
  "use strict";

  const ROOT_ID = "h2show-extension-root";

  function localDayKey(date) {
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join("-");
  }

  function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function dayLabel(date, now) {
    const dateDay = startOfLocalDay(date);
    const today = startOfLocalDay(now);
    const dayDifference = Math.round((today - dateDay) / 86_400_000);

    if (dayDifference === 0) return "Today";
    if (dayDifference === 1) return "Yesterday";

    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: date.getFullYear() === now.getFullYear() ? undefined : "numeric"
    }).format(date);
  }

  function makeElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function formatDuration(milliseconds) {
    if (milliseconds < 1000) return `${milliseconds} ms`;
    return `${(milliseconds / 1000).toFixed(1)} sec`;
  }

  function responseStatusText(entry) {
    if (Number.isInteger(entry.response_duration_ms)) {
      if (entry.response_tracking_state === "error") {
        return `Error after ${formatDuration(entry.response_duration_ms)}`;
      }
      return `Response: ${formatDuration(entry.response_duration_ms)}`;
    }
    if (entry.response_tracking_state === "responding") return "Responding…";
    if (entry.response_tracking_state === "waiting") return "Waiting for response…";
    if (entry.response_tracking_state === "interrupted") {
      return "Response timing unavailable";
    }
    return "";
  }

  class PromptActivityUI {
    constructor(storage) {
      this.storage = storage;
      this.logs = [];
      this.expanded = true;
      this.root = null;
      this.panel = null;
      this.collapsedButton = null;
      this.list = null;
      this.footer = null;
      this.badge = null;
      this.unsubscribe = null;
      this.mountObserver = null;
    }

    async initialize() {
      [this.logs, this.expanded] = await Promise.all([
        this.storage.getLogs(),
        this.storage.getPanelExpanded()
      ]);

      this.mount();
      this.unsubscribe = this.storage.subscribeToLogs((logs) => {
        this.logs = logs;
        this.renderLogs();
      });

      this.mountObserver = new MutationObserver(() => {
        if (!document.getElementById(ROOT_ID)) {
          this.mount();
        }
      });
      this.mountObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }

    mount() {
      const existing = document.getElementById(ROOT_ID);
      if (existing) {
        this.root = existing;
        return;
      }

      this.root = makeElement("div");
      this.root.id = ROOT_ID;
      this.root.setAttribute("data-h2show-ui", "true");

      this.panel = this.buildPanel();
      this.collapsedButton = this.buildCollapsedButton();
      this.root.append(this.panel, this.collapsedButton);
      document.body.append(this.root);

      this.applyExpandedState();
      this.renderLogs();
    }

    buildPanel() {
      const panel = makeElement("aside", "h2show-panel");
      panel.setAttribute("aria-label", "H2SHOW prompt activity");

      const header = makeElement("header", "h2show-header");
      const branding = makeElement("div", "h2show-branding");
      const brandRow = makeElement("div", "h2show-brand-row");

      const brandMark = makeElement("img", "h2show-brand-mark");
      brandMark.src = chrome.runtime.getURL("assets/logo-mark.png");
      brandMark.alt = "";

      const lightLogo = makeElement("img", "h2show-brand h2show-brand-light");
      lightLogo.src = chrome.runtime.getURL("assets/brand-light.png");
      lightLogo.alt = "H2SHOW";

      const darkLogo = makeElement("img", "h2show-brand h2show-brand-dark");
      darkLogo.src = chrome.runtime.getURL("assets/brand-dark.png");
      darkLogo.alt = "H2SHOW";

      const title = makeElement("div", "h2show-title", "Prompt Activity");
      brandRow.append(brandMark, lightLogo, darkLogo);
      branding.append(brandRow, title);

      const collapseButton = makeElement("button", "h2show-collapse-button", "×");
      collapseButton.type = "button";
      collapseButton.title = "Collapse prompt activity";
      collapseButton.setAttribute("aria-label", "Collapse prompt activity");
      collapseButton.addEventListener("click", () => this.setExpanded(false));

      header.append(branding, collapseButton);

      this.list = makeElement("div", "h2show-log-list");
      this.list.setAttribute("aria-live", "polite");
      this.list.setAttribute("aria-label", "Prompt submission history");

      this.footer = makeElement("footer", "h2show-footer");
      panel.append(header, this.list, this.footer);
      return panel;
    }

    buildCollapsedButton() {
      const button = makeElement("button", "h2show-collapsed-button");
      button.type = "button";
      button.title = "Open H2SHOW prompt activity";
      button.setAttribute("aria-label", "Open H2SHOW prompt activity");

      const logo = makeElement("img", "h2show-collapsed-logo");
      logo.src = chrome.runtime.getURL("assets/logo-mark.png");
      logo.alt = "";

      this.badge = makeElement("span", "h2show-count-badge", "0");
      this.badge.setAttribute("aria-hidden", "true");
      button.append(logo, this.badge);
      button.addEventListener("click", () => this.setExpanded(true));
      return button;
    }

    async setExpanded(expanded) {
      this.expanded = expanded;
      this.applyExpandedState();

      try {
        await this.storage.setPanelExpanded(expanded);
      } catch (error) {
        console.error("[H2SHOW] Could not save panel state", error);
      }
    }

    applyExpandedState() {
      if (!this.panel || !this.collapsedButton) return;

      this.panel.hidden = !this.expanded;
      this.collapsedButton.hidden = this.expanded;
    }

    renderLogs() {
      if (!this.list || !this.footer || !this.badge) return;

      this.list.replaceChildren();
      const now = new Date();
      const groupedLogs = new Map();

      for (const entry of this.logs) {
        const date = new Date(entry.timestamp);
        const key = localDayKey(date);
        if (!groupedLogs.has(key)) groupedLogs.set(key, []);
        groupedLogs.get(key).push({ entry, date });
      }

      if (groupedLogs.size === 0) {
        const empty = makeElement("div", "h2show-empty");
        empty.append(
          makeElement("strong", "", "No prompts recorded yet"),
          makeElement("span", "", "Your next submitted prompt will appear here.")
        );
        this.list.append(empty);
      } else {
        for (const dayEntries of groupedLogs.values()) {
          const section = makeElement("section", "h2show-day-group");
          section.append(makeElement("h2", "h2show-day-label", dayLabel(dayEntries[0].date, now)));

          for (const { entry, date } of dayEntries) {
            const row = makeElement("div", "h2show-log-row");
            row.dataset.logId = entry.id;

            const time = makeElement(
              "time",
              "h2show-log-time",
              new Intl.DateTimeFormat(undefined, {
                hour: "numeric",
                minute: "2-digit"
              }).format(date)
            );
            time.dateTime = entry.timestamp;

            const details = makeElement("div", "h2show-log-details");
            details.append(makeElement("span", "h2show-log-kind", "Prompt"));

            const hasMeasurements =
              Number.isInteger(entry.word_count) &&
              Number.isInteger(entry.character_count);
            const measurementText = hasMeasurements
              ? `${entry.word_count} ${entry.word_count === 1 ? "word" : "words"} • ${entry.character_count} ${entry.character_count === 1 ? "character" : "characters"}`
              : "Measurements unavailable";
            details.append(
              makeElement("span", "h2show-log-measurements", measurementText)
            );

            const responseText = responseStatusText(entry);
            if (responseText) {
              details.append(
                makeElement("span", "h2show-response-status", responseText)
              );
            }

            row.append(time, details);
            section.append(row);
          }

          this.list.append(section);
        }
      }

      const todayKey = localDayKey(now);
      const todayCount = this.logs.filter(
        (entry) => localDayKey(new Date(entry.timestamp)) === todayKey
      ).length;
      const noun = todayCount === 1 ? "prompt" : "prompts";

      this.footer.textContent = `${todayCount} ${noun} today`;
      this.badge.textContent = String(todayCount);
      this.badge.hidden = todayCount === 0;
    }
  }

  globalThis.H2ShowUI = Object.freeze({ PromptActivityUI });
})();
