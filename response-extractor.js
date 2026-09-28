(() => {
  "use strict";

  const CONTENT_SELECTORS = [
    ".markdown",
    "[data-message-content]",
    "[class*='markdown']",
    ".prose"
  ];
  const SKIPPED_TAGS = new Set([
    "BUTTON",
    "NAV",
    "SVG",
    "SCRIPT",
    "STYLE",
    "NOSCRIPT"
  ]);
  const BLOCK_TAGS = new Set([
    "ADDRESS",
    "ARTICLE",
    "BLOCKQUOTE",
    "DIV",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "LI",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "TR",
    "UL"
  ]);

  function normalizeExtractedText(text) {
    return text
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+\n/g, "\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function shouldSkipElement(element) {
    if (SKIPPED_TAGS.has(element.tagName)) return true;
    if (element.getAttribute?.("aria-hidden") === "true") return true;
    if (element.getAttribute?.("role") === "button") return true;

    const testId = element.getAttribute?.("data-testid") || "";
    return /copy|action|feedback|toolbar/i.test(testId);
  }

  function fallbackVisibleText(root) {
    const pieces = [];

    function walk(node) {
      if (node.nodeType === 3) {
        pieces.push(node.nodeValue || "");
        return;
      }
      if (node.nodeType !== 1 || shouldSkipElement(node)) return;

      if (node.tagName === "BR") {
        pieces.push("\n");
        return;
      }

      const isBlock = BLOCK_TAGS.has(node.tagName);
      if (isBlock) pieces.push("\n");
      for (const child of node.childNodes || []) walk(child);
      if (isBlock) pieces.push("\n");
    }

    walk(root);
    return normalizeExtractedText(pieces.join(""));
  }

  function findContentRoot(assistantElement) {
    if (!assistantElement) return null;

    for (const selector of CONTENT_SELECTORS) {
      if (assistantElement.matches?.(selector)) return assistantElement;
      const match = assistantElement.querySelector?.(selector);
      if (match) return match;
    }
    return assistantElement;
  }

  function extractResponseText(assistantElement) {
    const contentRoot = findContentRoot(assistantElement);
    if (!contentRoot) return "";

    // The scoped walker preserves semantic block/code whitespace while
    // deliberately excluding buttons and other response-adjacent controls.
    return fallbackVisibleText(contentRoot);
  }

  function findLatestResponseElement(root = document) {
    const assistantMessages = Array.from(
      root.querySelectorAll?.("[data-message-author-role='assistant']") || []
    );
    if (assistantMessages.length) return assistantMessages.at(-1);

    // ChatGPT occasionally changes or delays the author-role wrapper while
    // keeping the generated answer in a markdown content root. At response
    // completion, the last such root is the answer for the active prompt.
    const markdownRoots = Array.from(
      root.querySelectorAll?.("main .markdown, main [class*='markdown']") || []
    );
    return markdownRoots.at(-1) || null;
  }

  globalThis.H2ShowResponseExtractor = Object.freeze({
    extractResponseText,
    findLatestResponseElement
  });
})();
