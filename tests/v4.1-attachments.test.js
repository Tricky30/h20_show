const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function load(file, context) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, {
    filename: file
  });
}

async function main() {
  class FakeElement {
    constructor(label) {
      this.label = label;
      this.parentElement = { textContent: "" };
    }

    closest() {
      return this;
    }

    getAttribute(name) {
      return name === "aria-label" ? this.label : null;
    }
  }

  const context = vm.createContext({
    console,
    Element: FakeElement,
    document: { querySelectorAll: () => [] },
    createImageBitmap: async () => ({ width: 1920, height: 1080, close() {} })
  });
  load("attachments.js", context);
  load("detector.js", context);
  const attachments = context.H2ShowAttachments;
  assert.equal(context.H2ShowDetector.sanitizeComposerText("\uFFFC\u200B"), "");
  assert.equal(
    context.H2ShowDetector.sanitizeComposerText("Hello \uFFFCworld 👋"),
    "Hello world 👋"
  );

  assert.equal(attachments.extensionFromName("private.photo.JPG"), "jpg");
  assert.equal(attachments.extensionFromName("README"), null);
  assert.equal(
    attachments.classifyAttachment({ extension: "xlsx", mimeType: "" }),
    "data"
  );
  assert.equal(
    attachments.classifyAttachment({ extension: "pdf", mimeType: "" }),
    "document"
  );
  assert.equal(
    attachments.classifyAttachment({ extension: "bin", mimeType: "" }),
    "other"
  );
  assert.equal(attachments.isRemovalLabel("Remove photo.png"), true);
  assert.equal(attachments.isRemovalLabel("remove-file-button"), true);
  assert.equal(attachments.isRemovalLabel("Add files and more"), false);
  assert.equal(attachments.isRemovalLabel("Send"), false);

  const image = await attachments.metadataFromFile({
    name: "private-photo.JPG",
    type: "image/jpeg",
    size: 1842093
  });
  assert.deepEqual(JSON.parse(JSON.stringify(image)), {
    category: "image",
    extension: "jpg",
    mime_type: "image/jpeg",
    size_bytes: 1842093,
    width: 1920,
    height: 1080
  });
  assert.equal(Object.hasOwn(image, "name"), false);
  assert.equal(Object.hasOwn(image, "content"), false);

  const documentMetadata = await attachments.metadataFromFile({
    name: "confidential.pdf",
    type: "application/pdf",
    size: 3812931
  });
  assert.deepEqual(JSON.parse(JSON.stringify(documentMetadata)), {
    category: "document",
    extension: "pdf",
    mime_type: "application/pdf",
    size_bytes: 3812931
  });

  const noGuesses = await attachments.metadataFromFile({
    name: "unknown",
    type: "",
    size: undefined
  });
  assert.deepEqual(JSON.parse(JSON.stringify(noGuesses)), {
    category: "other"
  });

  const tracker = new attachments.AttachmentTracker();
  tracker.captureFiles([
    { name: "one.csv", type: "text/csv", size: 10 },
    { name: "two.pdf", type: "application/pdf", size: 20 }
  ]);
  const snapshot = tracker.captureSubmissionSnapshot();
  assert.equal(snapshot.records.length, 2);
  const submittedAttachments = await tracker.consumeSubmissionSnapshot(snapshot);
  assert.equal(submittedAttachments.length, 2);
  assert.equal(tracker.captureSubmissionSnapshot().records.length, 0);
  assert.equal(submittedAttachments[0].category, "data");
  assert.equal(submittedAttachments[1].category, "document");

  const removalTracker = new attachments.AttachmentTracker();
  removalTracker.captureFiles([
    { name: "keep.png", type: "image/png", size: 1 },
    { name: "remove.png", type: "image/png", size: 2 }
  ]);
  removalTracker.handleRemovalClick({
    target: new FakeElement("Remove remove.png")
  });
  const afterRemoval = removalTracker.captureSubmissionSnapshot();
  assert.equal(afterRemoval.records.length, 1);
  assert.equal(afterRemoval.records[0].name, "keep.png");

  const stored = {};
  const storageContext = vm.createContext({
    console,
    Date,
    chrome: {
      storage: {
        local: {
          async get(key) {
            return { [key]: stored[key] };
          },
          async set(values) {
            Object.assign(stored, values);
          }
        },
        onChanged: { addListener() {}, removeListener() {} }
      }
    }
  });
  load("storage.js", storageContext);
  await storageContext.H2ShowStorage.saveLogEntry({
    id: "attachment-event",
    timestamp: new Date().toISOString(),
    character_count: 0,
    word_count: 0,
    attachment_count: 2,
    attachments: [image, documentMetadata]
  });
  const saved = (await storageContext.H2ShowStorage.getLogs())[0];
  assert.equal(saved.attachment_count, 2);
  assert.equal(JSON.stringify(saved).includes("private-photo"), false);
  assert.equal(JSON.stringify(saved).includes("confidential"), false);
  await assert.rejects(
    storageContext.H2ShowStorage.saveLogEntry({
      id: "unsafe-attachment-event",
      timestamp: new Date().toISOString(),
      attachment_count: 1,
      attachments: [{ category: "document", filename: "secret.pdf" }]
    }),
    /valid id|non-negative measurements/
  );

  console.log("V4.1 attachment tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
