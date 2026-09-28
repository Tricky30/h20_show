(() => {
  "use strict";

  const IMAGE_EXTENSIONS = new Set([
    "avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "svg", "webp"
  ]);
  const DOCUMENT_EXTENSIONS = new Set([
    "doc", "docx", "md", "odt", "pdf", "ppt", "pptx", "rtf", "txt"
  ]);
  const DATA_EXTENSIONS = new Set([
    "csv", "json", "ods", "tsv", "xls", "xlsx", "xml"
  ]);
  const DATA_MIME_TYPES = new Set([
    "application/json",
    "application/vnd.ms-excel",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/xml",
    "text/csv",
    "text/tab-separated-values",
    "text/xml"
  ]);
  const REMOVAL_SELECTOR = [
    "button[aria-label]",
    "button[title]",
    "button[data-testid]",
    "[role='button'][aria-label]",
    "[role='button'][title]",
    "[role='button'][data-testid]"
  ].join(",");

  function extensionFromName(name) {
    if (typeof name !== "string") return null;
    const lastSegment = name.trim().split(/[\\/]/).at(-1) || "";
    const dotIndex = lastSegment.lastIndexOf(".");
    if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) return null;
    const extension = lastSegment.slice(dotIndex + 1).toLowerCase();
    return /^[a-z0-9]{1,16}$/.test(extension) ? extension : null;
  }

  function classifyAttachment({ extension, mimeType }) {
    const normalizedMime =
      typeof mimeType === "string" ? mimeType.toLowerCase() : "";
    if (normalizedMime.startsWith("image/")) return "image";
    if (extension && DATA_EXTENSIONS.has(extension)) return "data";
    if (DATA_MIME_TYPES.has(normalizedMime)) return "data";
    if (extension && DOCUMENT_EXTENSIONS.has(extension)) return "document";
    if (normalizedMime === "application/pdf" || normalizedMime.startsWith("text/")) {
      return "document";
    }
    if (extension && IMAGE_EXTENSIONS.has(extension)) return "image";
    return "other";
  }

  async function imageDimensions(file) {
    if (typeof createImageBitmap !== "function") return null;
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions =
        Number.isInteger(bitmap.width) && bitmap.width > 0 &&
        Number.isInteger(bitmap.height) && bitmap.height > 0
          ? { width: bitmap.width, height: bitmap.height }
          : null;
      bitmap.close?.();
      return dimensions;
    } catch {
      return null;
    }
  }

  async function metadataFromFile(file) {
    const extension = extensionFromName(file?.name);
    const mimeType =
      typeof file?.type === "string" && file.type.trim()
        ? file.type.trim().toLowerCase()
        : null;
    const category = classifyAttachment({ extension, mimeType });
    const metadata = { category };

    if (extension) metadata.extension = extension;
    if (mimeType) metadata.mime_type = mimeType;
    if (Number.isInteger(file?.size) && file.size >= 0) {
      metadata.size_bytes = file.size;
    }
    if (category === "image") {
      const dimensions = await imageDimensions(file);
      if (dimensions) Object.assign(metadata, dimensions);
    }
    return Object.freeze(metadata);
  }

  function removalLabel(element) {
    return [
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.getAttribute?.("data-testid")
    ].filter(Boolean).join(" ");
  }

  function isRemovalLabel(value) {
    return /^(?:remove|delete)(?:\b|[\s_-])/i.test(value || "");
  }

  class AttachmentTracker {
    constructor() {
      this.pending = [];
      this.seenFiles = new WeakSet();
      this.started = false;
      this.handleFileInput = this.handleFileInput.bind(this);
      this.handleDrop = this.handleDrop.bind(this);
      this.handlePaste = this.handlePaste.bind(this);
      this.handleRemovalClick = this.handleRemovalClick.bind(this);
      this.clear = this.clear.bind(this);
    }

    start() {
      if (this.started) return;
      this.started = true;
      document.addEventListener("change", this.handleFileInput, true);
      document.addEventListener("drop", this.handleDrop, true);
      document.addEventListener("paste", this.handlePaste, true);
      document.addEventListener("click", this.handleRemovalClick, true);
      window.addEventListener("pagehide", this.clear);
    }

    stop() {
      document.removeEventListener("change", this.handleFileInput, true);
      document.removeEventListener("drop", this.handleDrop, true);
      document.removeEventListener("paste", this.handlePaste, true);
      document.removeEventListener("click", this.handleRemovalClick, true);
      window.removeEventListener("pagehide", this.clear);
      this.clear();
      this.started = false;
    }

    handleFileInput(event) {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
      this.captureFiles(input.files);
    }

    handleDrop(event) {
      this.captureFiles(event.dataTransfer?.files);
    }

    handlePaste(event) {
      const files = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter(Boolean);
      this.captureFiles(files);
    }

    captureFiles(fileList) {
      for (const file of Array.from(fileList || [])) {
        if (!file || this.seenFiles.has(file)) continue;
        this.seenFiles.add(file);
        this.pending.push({
          name: typeof file.name === "string" ? file.name : "",
          metadataPromise: metadataFromFile(file)
        });
        console.info("[H2SHOW] Attachment detected");
      }
      if (fileList?.length) {
        console.info(`[H2SHOW] Attachment count: ${this.pending.length}`);
      }
    }

    handleRemovalClick(event) {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest(REMOVAL_SELECTOR);
      if (!button) return;
      const label = removalLabel(button);
      if (!isRemovalLabel(label)) return;

      const nearbyText = [label, button.parentElement?.textContent || ""].join(
        " "
      );
      let index = this.pending.findIndex(
        (record) => record.name && nearbyText.includes(record.name)
      );

      if (index === -1) {
        const removalButtons = Array.from(document.querySelectorAll(REMOVAL_SELECTOR))
          .filter((candidate) => isRemovalLabel(removalLabel(candidate)));
        const buttonIndex = removalButtons.indexOf(button);
        if (removalButtons.length === this.pending.length && buttonIndex >= 0) {
          index = buttonIndex;
        } else if (this.pending.length === 1) {
          index = 0;
        }
      }

      if (index >= 0) {
        this.pending.splice(index, 1);
        console.info("[H2SHOW] Attachment removed");
        console.info(`[H2SHOW] Attachment count: ${this.pending.length}`);
      }
    }

    captureSubmissionSnapshot() {
      const records = [...this.pending];
      return Object.freeze({ records });
    }

    async consumeSubmissionSnapshot(snapshot) {
      const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
      const submitted = new Set(records);
      this.pending = this.pending.filter((record) => !submitted.has(record));
      const attachments = await Promise.all(
        records.map((record) => record.metadataPromise)
      );
      console.info("[H2SHOW] Attachment metadata captured");
      console.info(`[H2SHOW] Attachment count: ${attachments.length}`);
      return attachments;
    }

    clear() {
      this.pending = [];
      this.seenFiles = new WeakSet();
    }
  }

  globalThis.H2ShowAttachments = Object.freeze({
    AttachmentTracker,
    classifyAttachment,
    extensionFromName,
    isRemovalLabel,
    metadataFromFile
  });
})();
