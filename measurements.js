(() => {
  "use strict";

  /**
   * Measures prompt text without retaining it.
   *
   * Characters are counted as Unicode code points, including spaces and line
   * breaks. Words are non-empty groups separated by whitespace, so punctuation
   * attached to a word remains part of that word.
   */
  function measurePrompt(promptText) {
    const text = typeof promptText === "string" ? promptText : "";
    const trimmedText = text.trim();

    return Object.freeze({
      character_count: Array.from(text).length,
      word_count: trimmedText ? trimmedText.split(/\s+/u).length : 0
    });
  }

  globalThis.H2ShowMeasurements = Object.freeze({ measurePrompt });
})();
