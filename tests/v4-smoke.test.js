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

function element(tagName, attributes = {}, children = [], selectors = []) {
  return {
    nodeType: 1,
    tagName,
    childNodes: children,
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    matches(selector) {
      return selectors.includes(selector);
    },
    querySelector(selector) {
      if (selectors.includes(selector)) return this;
      for (const child of children) {
        if (child.nodeType !== 1) continue;
        if (child.matches(selector)) return child;
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    }
  };
}

function text(value) {
  return { nodeType: 3, nodeValue: value };
}

async function main() {
  const context = vm.createContext({ console });
  load("measurements.js", context);
  load("response-extractor.js", context);

  const measurements = context.H2ShowMeasurements.measureText(
    "Hello, world!\nSecond line."
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(measurements)),
    { character_count: 26, word_count: 4 }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.H2ShowMeasurements.measureText("Water"))),
    { character_count: 5, word_count: 1 }
  );

  const answer = element("DIV", {}, [
    element("H2", {}, [text("Heading")]),
    element("P", {}, [text("Hello, world!")]),
    element("UL", {}, [
      element("LI", {}, [text("First item")]),
      element("LI", {}, [text("Second item")])
    ]),
    element("PRE", {}, [text("const x = 1;\n  return x;")]),
    element("BUTTON", { "data-testid": "copy-turn-action-button" }, [
      text("Copy")
    ])
  ], [".markdown"]);
  const assistant = element("ARTICLE", {}, [answer]);
  const extracted = context.H2ShowResponseExtractor.extractResponseText(assistant);
  assert.equal(
    extracted,
    "Heading\n\nHello, world!\n\nFirst item\n\nSecond item\n\nconst x = 1;\n  return x;"
  );
  assert.equal(extracted.includes("Copy"), false);
  assert.equal(
    context.H2ShowResponseExtractor.findLatestResponseElement({
      querySelectorAll(selector) {
        return selector.includes("data-message-author-role") ? [assistant] : [];
      }
    }),
    assistant
  );
  const turnWithoutAuthorRole = element("ARTICLE", {}, [answer]);
  assert.equal(
    context.H2ShowResponseExtractor.findLatestResponseElement({
      querySelectorAll(selector) {
        if (selector === "[data-testid^='conversation-turn-']") {
          return [turnWithoutAuthorRole];
        }
        return [];
      }
    }),
    turnWithoutAuthorRole
  );
  const currentChatGptAnswer = element(
    "DIV",
    {},
    [element("P", {}, [text("Current response markup")])],
    ["[class*='MarkdownRoot']"]
  );
  assert.equal(
    context.H2ShowResponseExtractor.findLatestResponseElement({
      querySelectorAll(selector) {
        return selector === "[class*='MarkdownRoot']"
          ? [currentChatGptAnswer]
          : [];
      }
    }),
    currentChatGptAnswer
  );
  assert.equal(
    context.H2ShowResponseExtractor.extractResponseText(currentChatGptAnswer),
    "Current response markup"
  );

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
        onChanged: {
          addListener() {},
          removeListener() {}
        }
      }
    }
  });
  load("storage.js", storageContext);

  const event = {
    id: "event-v4",
    timestamp: new Date().toISOString(),
    character_count: 12,
    word_count: 2,
    response_tracking_state: "completed",
    response_duration_ms: 900,
    response_character_count: extracted.length,
    response_word_count: extracted.trim().split(/\s+/u).length
  };
  await storageContext.H2ShowStorage.saveLogEntry(event);
  const logs = await storageContext.H2ShowStorage.getLogs();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].id, event.id);
  assert.equal(Object.hasOwn(logs[0], "prompt_text"), false);
  assert.equal(Object.hasOwn(logs[0], "response_text"), false);

  await storageContext.H2ShowStorage.updateLogEntry(event.id, {
    response_word_count: event.response_word_count + 1
  });
  const updated = await storageContext.H2ShowStorage.getLogs();
  assert.equal(updated.length, 1);
  assert.equal(updated[0].response_word_count, event.response_word_count + 1);

  stored.promptLogs.unshift({
    id: "legacy-v1",
    timestamp: new Date(Date.now() - 1000).toISOString()
  });
  stored.promptLogs.unshift({
    id: "legacy-v3",
    timestamp: new Date(Date.now() - 500).toISOString(),
    character_count: 5,
    word_count: 1,
    response_tracking_state: "completed",
    response_duration_ms: 500
  });
  assert.equal((await storageContext.H2ShowStorage.getLogs()).length, 3);

  console.log("V4 smoke tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
