(() => {
  "use strict";

  const CONTENT_SELECTORS = [
    "[class*='MarkdownRoot']",
    ".markdown",
    "[data-message-content]",
    "[class*='markdown']",
    ".prose",
    "[class*='prose']"
  ];
  const RESPONSE_CONTAINER_SELECTORS = [
    "[data-message-author-role='assistant']",
    "[data-testid^='conversation-turn-']",
    "main article",
    "article"
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
    for (const selector of RESPONSE_CONTAINER_SELECTORS) {
      const containers = Array.from(root.querySelectorAll?.(selector) || []);
      for (let index = containers.length - 1; index >= 0; index -= 1) {
        const container = containers[index];
        if (CONTENT_SELECTORS.some((contentSelector) =>
          container.matches?.(contentSelector) ||
          container.querySelector?.(contentSelector)
        )) {
          return container;
        }
      }
    }

    // Some ChatGPT layouts omit a stable turn wrapper. In that case, use the
    // newest generated-content root itself rather than failing extraction.
    for (const selector of CONTENT_SELECTORS) {
      const contentRoots = Array.from(root.querySelectorAll?.(selector) || []);
      if (contentRoots.length) return contentRoots.at(-1);
    }
    return null;
  }

  globalThis.H2ShowResponseExtractor = Object.freeze({
    extractResponseText,
    findLatestResponseElement
  });
})();
