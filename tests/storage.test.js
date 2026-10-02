"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

function optionalRequire(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") {
      return {};
    }
    throw error;
  }
}

test("storage exposes its constructor through CommonJS and PromptHelper", () => {
  const storageApi = optionalRequire("../storage.js");

  assert.equal(typeof storageApi.Storage, "function");
  assert.equal(globalThis.PromptHelper?.Storage, storageApi.Storage);
});

const { Storage } = require("../storage.js");
const constants = require("../constants.js");

const KEYS = Object.freeze({
  PROMPTS: "ph_prompts",
  PLACEHOLDER_HISTORY: "ph_placeholder_history",
  BUTTON_POSITION: "ph_button_pos",
  AUTO_SELECT_BRACKET_PLACEHOLDER: "ph_auto_select_bracket_placeholder",
});

function clone(value) {
  return structuredClone(value);
}

function selectKeys(data, keys) {
  const selected = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      selected[key] = clone(data[key]);
    }
  }
  return selected;
}

function createChangeEvent() {
  const listeners = new Set();
  return {
    listeners,
    api: {
      addListener(listener) {
        listeners.add(listener);
      },
      removeListener(listener) {
        listeners.delete(listener);
      },
    },
    emit(changes, areaName = "local") {
      for (const listener of [...listeners]) {
        listener(changes, areaName);
      }
    },
  };
}

function createCallbackChrome(initialData = {}) {
  const data = clone(initialData);
  const setCalls = [];
  const changeEvent = createChangeEvent();
  let nextGet = null;
  let nextSet = null;

  const chromeApi = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, callback) {
          const behavior = nextGet;
          nextGet = null;
          if (behavior?.type === "hang") {
            return undefined;
          }
          if (behavior?.type === "error") {
            chromeApi.runtime.lastError = { message: behavior.message };
            callback(undefined);
            chromeApi.runtime.lastError = null;
            return undefined;
          }

          callback(selectKeys(data, keys));
          return undefined;
        },
        set(items, callback) {
          const behavior = nextSet;
          nextSet = null;
          setCalls.push(clone(items));
          if (behavior?.type === "hang") {
            return undefined;
          }
          if (behavior?.type === "error") {
            chromeApi.runtime.lastError = { message: behavior.message };
            callback();
            chromeApi.runtime.lastError = null;
            return undefined;
          }

          Object.assign(data, clone(items));
          callback();
          return undefined;
        },
      },
      onChanged: changeEvent.api,
    },
  };

  return {
    chromeApi,
    data,
    setCalls,
    changeEvent,
    failNextGet(message) {
      nextGet = { type: "error", message };
    },
    failNextSet(message) {
      nextSet = { type: "error", message };
    },
    hangNextGet() {
      nextGet = { type: "hang" };
    },
    hangNextSet() {
      nextSet = { type: "hang" };
    },
  };
}

function createPromiseChrome(initialData = {}) {
  const data = clone(initialData);
  const setCalls = [];
  const changeEvent = createChangeEvent();
  const chromeApi = {
    runtime: {},
    storage: {
      local: {
        get(keys) {
          return Promise.resolve(selectKeys(data, keys));
        },
        set(items) {
          setCalls.push(clone(items));
          Object.assign(data, clone(items));
          return Promise.resolve();
        },
      },
      onChanged: changeEvent.api,
    },
  };

  return { chromeApi, data, setCalls, changeEvent };
}

async function captureRejection(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  assert.fail("Expected operation to reject");
}

test("storage instances expose load, save, and subscription methods", () => {
  const storage = new Storage({});

  assert.equal(typeof storage.load, "function");
  assert.equal(typeof storage.savePrompts, "function");
  assert.equal(typeof storage.saveButtonPosition, "function");
  assert.equal(typeof storage.saveAutoSelectBracketPlaceholder, "function");
  assert.equal(typeof storage.subscribe, "function");
});

test("constants preserve storage key names, defaults, and the three-second timeout", () => {
  assert.deepEqual(constants.STORAGE_KEYS, KEYS);
  assert.equal(constants.DEFAULT_AUTO_SELECT_BRACKET_PLACEHOLDER, true);
  assert.equal(constants.STORAGE_TIMEOUT_MS, 3000);
});

test("load returns safe defaults for missing values through the callback API", async () => {
  const fake = createCallbackChrome();
  const storage = new Storage(fake.chromeApi);

  assert.deepEqual(await storage.load(), {
    prompts: [],
    placeholderHistory: [],
    buttonPosition: null,
    autoSelectBracketPlaceholder: true,
  });
});

test("load normalizes valid data and filters corrupt records, history, and coordinates", async () => {
  const fake = createCallbackChrome({
    [KEYS.PROMPTS]: [
      {
        id: "keep",
        name: "  First prompt  ",
        prompt: "line one\nline two",
        placeholder: "  <slot>  ",
        extra: "discard",
      },
      {
        id: "empty-prompt",
        name: "Empty is valid",
        prompt: "",
        placeholder: "   ",
      },
      { id: "", name: "No id", prompt: "invalid" },
      { id: "bad-name", name: "   ", prompt: "invalid" },
      { id: "bad-prompt", name: "Bad prompt", prompt: 42 },
      { id: 42, name: "Bad id", prompt: "invalid" },
      null,
    ],
    [KEYS.PLACEHOLDER_HISTORY]: [
      "  <old>  ",
      "",
      null,
      "【光标】",
      "[光标]",
      "<old>",
      "<second>",
      "<third>",
      "<fourth>",
      "<fifth>",
      "<sixth>",
    ],
    [KEYS.BUTTON_POSITION]: { left: 12.5, top: 24, extra: true },
    [KEYS.AUTO_SELECT_BRACKET_PLACEHOLDER]: false,
  });
  const storage = new Storage(fake.chromeApi);

  assert.deepEqual(await storage.load(), {
    prompts: [
      {
        id: "keep",
        name: "First prompt",
        prompt: "line one\nline two",
        placeholder: "<slot>",
      },
      {
        id: "empty-prompt",
        name: "Empty is valid",
        prompt: "",
        placeholder: "【光标】",
      },
    ],
    placeholderHistory: ["<old>", "<second>", "<third>", "<fourth>", "<fifth>"],
    buttonPosition: { left: 12.5, top: 24 },
    autoSelectBracketPlaceholder: false,
  });
});

test("load and save keep only the first valid prompt for each normalized id", async () => {
  const fake = createCallbackChrome({
    [KEYS.PROMPTS]: [
      { id: " shared ", name: "First", prompt: "first", placeholder: "<first>" },
      { id: "shared", name: "Second", prompt: "second", placeholder: "<second>" },
      { id: "unique", name: "Unique", prompt: "unique", placeholder: "<unique>" },
    ],
  });
  const storage = new Storage(fake.chromeApi);

  assert.deepEqual((await storage.load()).prompts, [
    { id: "shared", name: "First", prompt: "first", placeholder: "<first>" },
    { id: "unique", name: "Unique", prompt: "unique", placeholder: "<unique>" },
  ]);

  await storage.savePrompts(
    [
      { id: "shared", name: "Saved first", prompt: "saved first", placeholder: "<first>" },
      { id: " shared ", name: "Saved second", prompt: "saved second", placeholder: "<second>" },
      { id: "unique", name: "Saved unique", prompt: "saved unique", placeholder: "<unique>" },
    ],
    [],
  );

  assert.deepEqual(fake.setCalls.at(-1)[KEYS.PROMPTS], [
    { id: "shared", name: "Saved first", prompt: "saved first", placeholder: "<first>" },
    { id: "unique", name: "Saved unique", prompt: "saved unique", placeholder: "<unique>" },
  ]);
});

test("load rejects invalid coordinate shapes while preserving other safe fallbacks", async () => {
  const fake = createCallbackChrome({
    [KEYS.PROMPTS]: { not: "an array" },
    [KEYS.PLACEHOLDER_HISTORY]: "not an array",
    [KEYS.BUTTON_POSITION]: { left: -1, top: Number.NaN },
    [KEYS.AUTO_SELECT_BRACKET_PLACEHOLDER]: "not a boolean",
  });
  const storage = new Storage(fake.chromeApi);

  assert.deepEqual(await storage.load(), {
    prompts: [],
    placeholderHistory: [],
    buttonPosition: null,
    autoSelectBracketPlaceholder: true,
  });
});

test("Promise-based Chrome storage is supported for reads and writes", async () => {
  const fake = createPromiseChrome({
    [KEYS.BUTTON_POSITION]: { left: 2, top: 3 },
    [KEYS.AUTO_SELECT_BRACKET_PLACEHOLDER]: false,
  });
  const storage = new Storage(fake.chromeApi);

  assert.deepEqual(await storage.load(), {
    prompts: [],
    placeholderHistory: [],
    buttonPosition: { left: 2, top: 3 },
    autoSelectBracketPlaceholder: false,
  });
  assert.deepEqual(await storage.saveButtonPosition({ left: 8, top: 13 }), {
    rollbackSnapshot: { buttonPosition: { left: 2, top: 3 } },
  });
  assert.deepEqual(fake.setCalls, [
    { [KEYS.BUTTON_POSITION]: { left: 8, top: 13 } },
  ]);
});

test("load rejects with a readable timeout error when callback storage stalls", async () => {
  const fake = createCallbackChrome();
  fake.hangNextGet();
  const storage = new Storage(fake.chromeApi, { timeoutMs: 20 });

  const error = await captureRejection(() => storage.load());
  assert.equal(error.code, "STORAGE_TIMEOUT");
  assert.match(error.message, /storage get timed out after 20 ms/i);
});

test("save timeout carries the unchanged rollback snapshot", async () => {
  const oldPrompt = {
    id: "old",
    name: "Old",
    prompt: "old text",
    placeholder: "【光标】",
  };
  const fake = createCallbackChrome({
    [KEYS.PROMPTS]: [oldPrompt],
    [KEYS.PLACEHOLDER_HISTORY]: ["<old>"],
  });
  const storage = new Storage(fake.chromeApi, { timeoutMs: 20 });
  await storage.load();
  fake.hangNextSet();

  const error = await captureRejection(() =>
    storage.savePrompts(
      [{ id: "new", name: "New", prompt: "new text", placeholder: "<new>" }],
      ["<new>"],
    ),
  );

  assert.equal(error.code, "STORAGE_TIMEOUT");
  assert.deepEqual(error.rollbackSnapshot, {
    prompts: [oldPrompt],
    placeholderHistory: ["<old>"],
  });
});

test("savePrompts writes only normalized keys and returns the previous state snapshot", async () => {
  const oldPrompt = {
    id: "old",
    name: "Old",
    prompt: "old text",
    placeholder: "【光标】",
  };
  const fake = createCallbackChrome({
    [KEYS.PROMPTS]: [oldPrompt],
    [KEYS.PLACEHOLDER_HISTORY]: ["<old>"],
  });
  const storage = new Storage(fake.chromeApi);
  await storage.load();

  const result = await storage.savePrompts(
    [
      {
        id: "new",
        name: "  New  ",
        prompt: "new text",
        placeholder: " ",
        extra: true,
      },
      { id: "bad", name: "", prompt: "discard" },
    ],
    [" <new> ", "<new>", "【光标】", null],
  );

  assert.deepEqual(fake.setCalls, [
    {
      [KEYS.PROMPTS]: [
        {
          id: "new",
          name: "New",
          prompt: "new text",
          placeholder: "【光标】",
        },
      ],
      [KEYS.PLACEHOLDER_HISTORY]: ["<new>"],
    },
  ]);
  assert.deepEqual(result, {
    rollbackSnapshot: {
      prompts: [oldPrompt],
      placeholderHistory: ["<old>"],
    },
  });
});

test("runtime.lastError rejects a write without advancing in-memory state", async () => {
  const oldPrompt = {
    id: "old",
    name: "Old",
    prompt: "old text",
    placeholder: "【光标】",
  };
  const nextPrompt = {
    id: "next",
    name: "Next",
    prompt: "next text",
    placeholder: "<next>",
  };
  const fake = createCallbackChrome({
    [KEYS.PROMPTS]: [oldPrompt],
    [KEYS.PLACEHOLDER_HISTORY]: ["<old>"],
  });
  const storage = new Storage(fake.chromeApi);
  await storage.load();
  fake.failNextSet("quota exceeded");

  const error = await captureRejection(() =>
    storage.savePrompts([nextPrompt], ["<next>"]),
  );
  assert.equal(error.code, "CHROME_RUNTIME_ERROR");
  assert.match(error.message, /storage set failed: quota exceeded/i);
  assert.deepEqual(error.rollbackSnapshot, {
    prompts: [oldPrompt],
    placeholderHistory: ["<old>"],
  });

  const retryResult = await storage.savePrompts([nextPrompt], ["<next>"]);
  assert.deepEqual(retryResult.rollbackSnapshot, {
    prompts: [oldPrompt],
    placeholderHistory: ["<old>"],
  });
});

test("saveButtonPosition accepts left/top or null and rejects invalid positions", async () => {
  const fake = createCallbackChrome({
    [KEYS.BUTTON_POSITION]: { left: 1, top: 2 },
  });
  const storage = new Storage(fake.chromeApi);
  await storage.load();

  assert.deepEqual(await storage.saveButtonPosition({ left: 3, top: 5, extra: true }), {
    rollbackSnapshot: { buttonPosition: { left: 1, top: 2 } },
  });
  assert.deepEqual(await storage.saveButtonPosition(null), {
    rollbackSnapshot: { buttonPosition: { left: 3, top: 5 } },
  });
  const error = await captureRejection(() =>
    storage.saveButtonPosition({ left: -1, top: 4 }),
  );
  assert.equal(error.name, "TypeError");
  assert.deepEqual(fake.setCalls, [
    { [KEYS.BUTTON_POSITION]: { left: 3, top: 5 } },
    { [KEYS.BUTTON_POSITION]: null },
  ]);
});

test("saveAutoSelectBracketPlaceholder persists a boolean with rollback state", async () => {
  const fake = createCallbackChrome({
    [KEYS.AUTO_SELECT_BRACKET_PLACEHOLDER]: false,
  });
  const storage = new Storage(fake.chromeApi);
  await storage.load();

  assert.deepEqual(await storage.saveAutoSelectBracketPlaceholder(true), {
    rollbackSnapshot: { autoSelectBracketPlaceholder: false },
  });
  assert.deepEqual(fake.setCalls, [
    { [KEYS.AUTO_SELECT_BRACKET_PLACEHOLDER]: true },
  ]);
  const error = await captureRejection(() =>
    storage.saveAutoSelectBracketPlaceholder("yes"),
  );
  assert.equal(error.name, "TypeError");
});

test("missing and invalidated extension contexts use one normalized error", async () => {
  const missingError = await captureRejection(() => new Storage(null).load());
  const fake = createCallbackChrome();
  fake.failNextGet("Extension context invalidated.");
  const invalidatedError = await captureRejection(() =>
    new Storage(fake.chromeApi).load(),
  );

  assert.equal(missingError.code, "EXTENSION_CONTEXT_INVALID");
  assert.equal(invalidatedError.code, "EXTENSION_CONTEXT_INVALID");
  assert.equal(invalidatedError.message, missingError.message);
});

test("subscribe relays relevant local changes and returned cleanup removes the listener", () => {
  const fake = createCallbackChrome();
  const storage = new Storage(fake.chromeApi);
  const observed = [];
  const listener = (changes, areaName) => observed.push({ changes, areaName });

  const unsubscribe = storage.subscribe(listener);
  assert.equal(fake.changeEvent.listeners.size, 1);

  fake.changeEvent.emit({ unrelated: { newValue: true } }, "local");
  fake.changeEvent.emit(
    { [KEYS.PROMPTS]: { oldValue: [], newValue: [] } },
    "sync",
  );
  const relevantChanges = {
    [KEYS.PROMPTS]: {
      oldValue: [],
      newValue: [
        { id: "external", name: "External", prompt: "text", placeholder: "" },
      ],
    },
  };
  fake.changeEvent.emit(relevantChanges, "local");

  assert.deepEqual(observed, [{ changes: relevantChanges, areaName: "local" }]);
  unsubscribe();
  unsubscribe();
  assert.equal(fake.changeEvent.listeners.size, 0);
  fake.changeEvent.emit(relevantChanges, "local");
  assert.equal(observed.length, 1);
});

test("subscribe treats the bracket auto-selection setting as relevant", () => {
  const fake = createCallbackChrome();
  const storage = new Storage(fake.chromeApi);
  const observed = [];
  const unsubscribe = storage.subscribe((changes) => observed.push(changes));
  const changes = {
    [KEYS.AUTO_SELECT_BRACKET_PLACEHOLDER]: {
      oldValue: true,
      newValue: false,
    },
  };

  fake.changeEvent.emit(changes, "local");

  assert.deepEqual(observed, [changes]);
  unsubscribe();
});
