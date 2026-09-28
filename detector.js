(() => {
  "use strict";

  const COMPOSER_SELECTORS = [
    "#prompt-textarea",
    "[contenteditable='true'][id='prompt-textarea']",
    "textarea[data-id='root']",
    "textarea[placeholder*='Message' i]",
    "div[contenteditable='true'][data-placeholder*='Message' i]",
    "div[contenteditable='true'][aria-label*='Message' i]",
    "div.ProseMirror[contenteditable='true']",
    "form textarea",
    "form [contenteditable='true'][data-lexical-editor='true']",
    "form [contenteditable='true']"
  ];

  const SEND_BUTTON_SELECTORS = [
    "button[data-testid='send-button']",
    "button[data-testid='composer-send-button']",
    "button[data-testid='fruitjuice-send-button']",
    "button[aria-label*='Send' i]",
    "button[aria-label*='Send prompt' i]",
    "button[aria-label*='Send message' i]",
    "button[title*='Send' i]"
  ];

  const STOP_BUTTON_SELECTORS = [
    "button[data-testid='stop-button']",
    "button[aria-label*='Stop generating' i]",
    "button[aria-label*='Stop responding' i]"
  ];

  const USER_MESSAGE_SELECTOR = "[data-message-author-role='user']";
  const CONFIRMATION_DELAYS = [50, 180, 500, 1200, 2500];
  const DUPLICATE_WINDOW_MS = 1000;

  function findFirst(selectors, root = document) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function findComposer() {
    return findFirst(COMPOSER_SELECTORS);
  }

  function findSendButton() {
    return findFirst(SEND_BUTTON_SELECTORS);
  }

  function findComposerNear(target) {
    if (!(target instanceof Element)) return findComposer();

    const form = target.closest("form");
    if (form) {
      const composer = findFirst(COMPOSER_SELECTORS, form);
      if (composer) return composer;
    }

    return findComposer();
  }

  function elementMatchesOrContains(target, selectors) {
    if (!(target instanceof Element)) return null;
    return target.closest(selectors.join(","));
  }

  function getComposerText(composer) {
    if (!composer) return "";

    const text = "value" in composer ? composer.value : composer.innerText;
    return typeof text === "string" ? text : "";
  }

  function composerHasText(composer) {
    return getComposerText(composer).trim().length > 0;
  }

  function buttonIsEnabled(button) {
    return Boolean(
      button &&
        !button.disabled &&
        button.getAttribute("aria-disabled") !== "true"
    );
  }

  function countUserMessages() {
    return document.querySelectorAll(USER_MESSAGE_SELECTOR).length;
  }

  function targetBelongsToComposer(target, composer) {
    return Boolean(
      composer &&
        target instanceof Node &&
        (target === composer || composer.contains(target))
    );
  }

  class PromptSubmissionDetector {
    constructor(onConfirmedSubmission, captureSubmissionContext = null) {
      this.onConfirmedSubmission = onConfirmedSubmission;
      this.captureSubmissionContext = captureSubmissionContext;
      this.activeAttempt = null;
      this.lastConfirmedAt = 0;
      this.timeoutIds = new Set();
      this.started = false;

      this.handleClick = this.handleClick.bind(this);
      this.handleKeyDown = this.handleKeyDown.bind(this);
      this.handleSubmit = this.handleSubmit.bind(this);
    }

    start() {
      if (this.started) return;
      this.started = true;

      // Delegated listeners survive ChatGPT's client-side navigation and DOM updates.
      document.addEventListener("click", this.handleClick, true);
      document.addEventListener("keydown", this.handleKeyDown, true);
      document.addEventListener("submit", this.handleSubmit, true);
    }

    stop() {
      document.removeEventListener("click", this.handleClick, true);
      document.removeEventListener("keydown", this.handleKeyDown, true);
      document.removeEventListener("submit", this.handleSubmit, true);
      for (const timeoutId of this.timeoutIds) clearTimeout(timeoutId);
      this.timeoutIds.clear();
      if (this.activeAttempt) this.activeAttempt.beforeComposerText = "";
      this.activeAttempt = null;
      this.started = false;
    }

    handleClick(event) {
      const sendButton = elementMatchesOrContains(event.target, SEND_BUTTON_SELECTORS);
      if (!sendButton || !buttonIsEnabled(sendButton)) return;

      this.armConfirmation("send button", event.target);
    }

    handleKeyDown(event) {
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.defaultPrevented
      ) {
        return;
      }

      const composer = findComposerNear(event.target);
      if (!targetBelongsToComposer(event.target, composer)) return;

      this.armConfirmation("keyboard", event.target);
    }

    handleSubmit(event) {
      const composer = findComposer();
      if (!(event.target instanceof HTMLFormElement) || !composer) return;
      if (!event.target.contains(composer)) return;

      this.armConfirmation("form submission", event.target);
    }

    armConfirmation(source, eventTarget = null) {
      const now = Date.now();
      if (this.activeAttempt || now - this.lastConfirmedAt < DUPLICATE_WINDOW_MS) {
        return;
      }

      const composer = eventTarget ? findComposerNear(eventTarget) : findComposer();
      const sendButton = findSendButton();
      const hadText = composerHasText(composer);
      const submissionContext = this.captureSubmissionContext?.() || null;
      const hadAttachments = Boolean(submissionContext?.records?.length);

      // An enabled send button also covers prompts containing attachments only.
      if (
        !composer ||
        (!hadText && !hadAttachments && !buttonIsEnabled(sendButton))
      ) {
        return;
      }

      const attempt = {
        source,
        composer,
        hadText,
        hadAttachments,
        beforeComposerText: getComposerText(composer),
        beforeUserMessageCount: countUserMessages(),
        startedAt: now,
        startedPerformanceAt: performance.now(),
        submissionContext,
        confirmed: false
      };
      this.activeAttempt = attempt;
      console.info(`[H2SHOW] Prompt submission candidate detected (${source})`);

      for (const delay of CONFIRMATION_DELAYS) {
        const timeoutId = setTimeout(() => {
          this.timeoutIds.delete(timeoutId);
          this.checkAttempt(attempt, delay === CONFIRMATION_DELAYS.at(-1));
        }, delay);
        this.timeoutIds.add(timeoutId);
      }
    }

    checkAttempt(attempt, isFinalCheck) {
      if (this.activeAttempt !== attempt || attempt.confirmed) return;

      const userMessageAppeared =
        countUserMessages() > attempt.beforeUserMessageCount;
      const currentComposer = document.contains(attempt.composer)
        ? attempt.composer
        : findComposer();
      const currentComposerText = getComposerText(currentComposer);
      const composerWasCleared =
        attempt.hadText && currentComposerText.trim().length === 0;
      const composerTextChanged =
        attempt.hadText && currentComposerText !== attempt.beforeComposerText;
      const responseStarted = Boolean(findFirst(STOP_BUTTON_SELECTORS));
      const attachmentSubmissionStarted =
        attempt.hadAttachments && responseStarted;
      const attachmentSubmissionAction =
        attempt.hadAttachments &&
        ["send button", "keyboard", "form submission"].includes(
          attempt.source
        );

      // A new user message is the strongest signal. Composer clearing is the
      // fallback ChatGPT signal for current and virtualized ChatGPT screens.
      if (
        userMessageAppeared ||
        composerWasCleared ||
        attachmentSubmissionStarted ||
        attachmentSubmissionAction ||
        (responseStarted && composerTextChanged)
      ) {
        this.confirm(attempt);
        return;
      }

      if (isFinalCheck) {
        attempt.beforeComposerText = "";
        this.activeAttempt = null;
      }
    }

    async confirm(attempt) {
      if (attempt.confirmed) return;
      attempt.confirmed = true;
      this.lastConfirmedAt = Date.now();
      this.activeAttempt = null;

      // The prompt text is held only in memory until measurements are created.
      // It is never included in the stored log entry.
      const promptText = attempt.beforeComposerText;
      attempt.beforeComposerText = "";

      try {
        await this.onConfirmedSubmission({
          source: attempt.source,
          promptText,
          submittedAt: attempt.startedAt,
          submittedPerformanceAt: attempt.startedPerformanceAt,
          submissionContext: attempt.submissionContext
        });
      } catch (error) {
        console.error("[H2SHOW] Could not record prompt submission", error);
      }
    }
  }

  globalThis.H2ShowDetector = Object.freeze({ PromptSubmissionDetector });
})();
