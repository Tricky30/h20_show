(() => {
  "use strict";

  const STOP_BUTTON_SELECTORS = [
    "button[data-testid='stop-button']",
    "button[data-testid='composer-stop-button']",
    "button[aria-label*='Stop generating' i]",
    "button[aria-label*='Stop responding' i]"
  ];
  const ASSISTANT_MESSAGE_SELECTOR = "[data-message-author-role='assistant']";
  const STREAMING_SELECTORS = [
    "[data-message-streaming='true']",
    "[data-is-streaming='true']",
    ".result-streaming"
  ];
  const ERROR_SELECTORS = [
    "[data-testid='conversation-turn-error']",
    "[data-testid*='response-error']",
    "[data-testid*='message-error']"
  ];
  const FALLBACK_QUIET_MS = 800;

  function findFirst(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function assistantMessages() {
    return Array.from(document.querySelectorAll(ASSISTANT_MESSAGE_SELECTOR));
  }

  function errorElements() {
    return ERROR_SELECTORS.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector))
    );
  }

  class ResponseTracker {
    constructor({ onStarted, onCompleted, onInterrupted }) {
      this.onStarted = onStarted;
      this.onCompleted = onCompleted;
      this.onInterrupted = onInterrupted;
      this.active = null;
      this.observer = null;
      this.checkScheduled = false;
      this.fallbackTimerId = null;

      this.handleMutations = this.handleMutations.bind(this);
      this.handlePageHide = this.handlePageHide.bind(this);
    }

    start() {
      if (this.observer) return;

      this.observer = new MutationObserver(this.handleMutations);
      this.observer.observe(document.documentElement, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-label", "data-testid", "disabled"]
      });
      window.addEventListener("pagehide", this.handlePageHide);
    }

    stop() {
      this.observer?.disconnect();
      this.observer = null;
      window.removeEventListener("pagehide", this.handlePageHide);
      this.clearFallbackTimer();
      this.active = null;
      this.checkScheduled = false;
    }

    track({ eventId, submittedAt, submittedPerformanceAt }) {
      if (this.active && !this.active.finished) {
        this.interruptActive("superseded");
      }

      const messages = assistantMessages();
      const errors = errorElements();
      this.active = {
        eventId,
        submittedAt,
        submittedPerformanceAt,
        conversationPath: location.pathname,
        initialAssistantCount: messages.length,
        initialLastAssistant: messages.at(-1) || null,
        initialErrorCount: errors.length,
        initialLastError: errors.at(-1) || null,
        started: false,
        sawGenerationControl: false,
        finished: false
      };

      console.info(`[H2SHOW] Response tracking started for event: ${eventId}`);
      this.scheduleCheck();
    }

    handleMutations() {
      this.scheduleCheck();
    }

    handlePageHide() {
      // Storage recovery on the next initialization marks this attempt as
      // interrupted. Async storage writes are intentionally avoided here
      // because browsers do not guarantee they finish during page teardown.
      this.active = null;
    }

    scheduleCheck() {
      if (!this.active || this.checkScheduled) return;
      this.checkScheduled = true;

      queueMicrotask(() => {
        this.checkScheduled = false;
        this.checkState();
      });
    }

    checkState() {
      const attempt = this.active;
      if (!attempt || attempt.finished) return;

      if (location.pathname !== attempt.conversationPath) {
        const isNewConversationRoute =
          !attempt.started &&
          (attempt.conversationPath === "/" ||
            attempt.conversationPath.startsWith("/g/"));
        if (isNewConversationRoute) {
          attempt.conversationPath = location.pathname;
        } else {
          this.interruptActive("navigation");
          return;
        }
      }

      const stopControlPresent = Boolean(findFirst(STOP_BUTTON_SELECTORS));
      const streamingMarkerPresent = Boolean(findFirst(STREAMING_SELECTORS));
      const generationActive = stopControlPresent || streamingMarkerPresent;
      if (generationActive) attempt.sawGenerationControl = true;

      const messages = assistantMessages();
      const lastAssistant = messages.at(-1) || null;
      const assistantAppeared =
        messages.length > attempt.initialAssistantCount ||
        (lastAssistant && lastAssistant !== attempt.initialLastAssistant);
      const errors = errorElements();
      const lastError = errors.at(-1) || null;
      const errorAppeared =
        errors.length > attempt.initialErrorCount ||
        (lastError && lastError !== attempt.initialLastError);

      if (!attempt.started && (generationActive || assistantAppeared)) {
        attempt.started = true;
        const detectedPerformanceAt = performance.now();
        const responseStartedAt = this.wallClockIso(
          attempt,
          detectedPerformanceAt
        );

        console.info("[H2SHOW] Response generation detected");
        Promise.resolve(
          this.onStarted({
            eventId: attempt.eventId,
            response_started_at: responseStartedAt
          })
        ).catch((error) => {
          console.error("[H2SHOW] Could not save response start", error);
        });
      }

      if (generationActive) this.clearFallbackTimer();

      const terminalSignal =
        !generationActive &&
        (errorAppeared || attempt.sawGenerationControl);

      if (attempt.started && terminalSignal) {
        this.completeActive(errorAppeared ? "error" : "completed");
      } else if (
        attempt.started &&
        assistantAppeared &&
        !generationActive &&
        !attempt.sawGenerationControl
      ) {
        // Very fast responses may add an assistant message without exposing a
        // stop control. In that fallback case, complete only after mutations
        // have gone quiet, resetting this timer whenever content changes.
        this.armFallbackCompletion(attempt);
      } else if (!attempt.started && errorAppeared) {
        // An error can occur before ChatGPT exposes a distinct generation-start
        // signal. Keep the start timestamp absent instead of fabricating one.
        this.completeActive("error");
      }
    }

    armFallbackCompletion(attempt) {
      this.clearFallbackTimer();
      this.fallbackTimerId = setTimeout(() => {
        this.fallbackTimerId = null;
        if (this.active !== attempt || attempt.finished) return;

        const generationActive = Boolean(
          findFirst(STOP_BUTTON_SELECTORS) || findFirst(STREAMING_SELECTORS)
        );
        if (!generationActive) this.completeActive("completed");
      }, FALLBACK_QUIET_MS);
    }

    clearFallbackTimer() {
      if (this.fallbackTimerId !== null) {
        clearTimeout(this.fallbackTimerId);
        this.fallbackTimerId = null;
      }
    }

    wallClockIso(attempt, performanceAt) {
      const elapsed = performanceAt - attempt.submittedPerformanceAt;
      return new Date(attempt.submittedAt + elapsed).toISOString();
    }

    completeActive(state) {
      const attempt = this.active;
      if (!attempt || attempt.finished) return;

      attempt.finished = true;
      this.clearFallbackTimer();
      const completedPerformanceAt = performance.now();
      const duration = Math.max(
        0,
        Math.round(completedPerformanceAt - attempt.submittedPerformanceAt)
      );
      const responseCompletedAt = this.wallClockIso(
        attempt,
        completedPerformanceAt
      );
      this.active = null;

      console.info("[H2SHOW] Response completed");
      console.info(`[H2SHOW] Response duration: ${duration} ms`);
      Promise.resolve(
        this.onCompleted({
          eventId: attempt.eventId,
          response_completed_at: responseCompletedAt,
          response_duration_ms: duration,
          response_tracking_state: state
        })
      ).catch((error) => {
        console.error("[H2SHOW] Could not save response completion", error);
      });
    }

    interruptActive(reason) {
      const attempt = this.active;
      if (!attempt || attempt.finished) return;

      attempt.finished = true;
      this.clearFallbackTimer();
      this.active = null;
      Promise.resolve(
        this.onInterrupted({
          eventId: attempt.eventId,
          response_tracking_state: "interrupted",
          response_tracking_reason: reason
        })
      ).catch((error) => {
        console.error("[H2SHOW] Could not save response interruption", error);
      });
    }
  }

  globalThis.H2ShowResponseTracker = Object.freeze({ ResponseTracker });
})();
