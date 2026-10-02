"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { DEFAULT_PLACEHOLDER } = require("../constants.js");
const engine = require("../prompt-engine.js");
const uiApi = require("../ui.js");

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

const contentApi = optionalRequire("../content.js");

function clone(value) {
  return structuredClone(value);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeStorage {
  constructor(initialState = {}) {
    this.state = {
      prompts: clone(initialState.prompts || []),
      placeholderHistory: clone(initialState.placeholderHistory || []),
      buttonPosition: initialState.buttonPosition
        ? clone(initialState.buttonPosition)
        : null,
      autoSelectBracketPlaceholder:
        initialState.autoSelectBracketPlaceholder !== false,
    };
    this.loadCalls = 0;
    this.promptSaves = [];
    this.positionSaves = [];
    this.settingSaves = [];
    this.listeners = new Set();
    this.nextLoadError = null;
    this.nextSaveError = null;
    this.nextPositionError = null;
    this.nextSettingError = null;
    this.nextSaveGate = null;
    this.unsubscribeCalls = 0;
  }

  async load() {
    this.loadCalls += 1;
    if (this.nextLoadError) {
      const error = this.nextLoadError;
      this.nextLoadError = null;
      throw error;
    }
    return clone(this.state);
  }

  async savePrompts(prompts, placeholderHistory) {
    this.promptSaves.push({
      prompts: clone(prompts),
      placeholderHistory: clone(placeholderHistory),
    });
    if (this.nextSaveGate) {
      const gate = this.nextSaveGate;
      this.nextSaveGate = null;
      await gate.promise;
    }
    if (this.nextSaveError) {
      const error = this.nextSaveError;
      this.nextSaveError = null;
      throw error;
    }
    this.state.prompts = clone(prompts);
    this.state.placeholderHistory = clone(placeholderHistory);
    return { rollbackSnapshot: null };
  }

  async saveButtonPosition(position) {
    this.positionSaves.push(clone(position));
    if (this.nextPositionError) {
      const error = this.nextPositionError;
      this.nextPositionError = null;
      throw error;
    }
    this.state.buttonPosition = clone(position);
    return { rollbackSnapshot: null };
  }

  async saveAutoSelectBracketPlaceholder(enabled) {
    this.settingSaves.push(enabled);
    if (this.nextSettingError) {
      const error = this.nextSettingError;
      this.nextSettingError = null;
      throw error;
    }
    this.state.autoSelectBracketPlaceholder = enabled;
    return { rollbackSnapshot: null };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      this.unsubscribeCalls += 1;
      this.listeners.delete(listener);
    };
  }

  async emitExternal(nextState) {
    this.state = clone(nextState);
    await Promise.all(
      [...this.listeners].map((listener) =>
        Promise.resolve(listener({ ph_prompts: { newValue: nextState.prompts } }, "local")),
      ),
    );
  }
}

class FakeView {
  constructor() {
    this.renders = [];
    this.statuses = [];
    this.panelCloses = [];
  }

  render(state) {
    this.renders.push(clone(state));
  }

  showStatus(message, kind) {
    this.statuses.push({ message, kind });
  }

  closePanel(options) {
    this.panelCloses.push(clone(options));
  }
}

function createController(options = {}) {
  const storage = options.storage || new FakeStorage(options.initialState);
  const view = options.view || new FakeView();
  const editor = options.editor || {
    bookmarks: 0,
    insertCalls: [],
    captureBookmark() {
      this.bookmarks += 1;
      return { offset: 1 };
    },
    insert(text, caretOffset, selectionEndOffset) {
      const call = { text, caretOffset };
      if (Number.isFinite(selectionEndOffset)) {
        call.selectionEndOffset = selectionEndOffset;
      }
      this.insertCalls.push(call);
      return { ok: true, code: "INSERTED" };
    },
  };
  const Controller = uiApi.PromptHelperController;
  const controller = new Controller({
    storage,
    editor,
    view,
    extractPromptSlots: engine.extractPromptSlots,
    prepareInsertion: engine.prepareInsertion,
    updatePlaceholderHistory: engine.updatePlaceholderHistory,
    idFactory: options.idFactory || (() => "generated-id"),
  });
  return { controller, storage, editor, view };
}

test("controller is exposed and instances provide the task actions", () => {
  assert.equal(typeof uiApi.PromptHelperController, "function");
  assert.equal(
    globalThis.PromptHelper?.PromptHelperController,
    uiApi.PromptHelperController,
  );
  const { controller } = createController();
  for (const method of [
    "initialize",
    "getState",
    "savePrompt",
    "deletePrompt",
    "deletePlaceholderHistory",
    "getPromptSlotPlan",
    "insertPrompt",
    "reorderPrompts",
    "saveButtonPosition",
    "setAutoSelectBracketPlaceholder",
    "captureBookmark",
    "destroy",
  ]) {
    assert.equal(typeof controller[method], "function", method);
  }
});

test("initialize loads and renders persistent state before subscribing", async () => {
  const prompt = {
    id: "one",
    name: "示例",
    prompt: "正文",
    placeholder: DEFAULT_PLACEHOLDER,
  };
  const { controller, storage, view } = createController({
    initialState: {
      prompts: [prompt],
      placeholderHistory: ["<旧>"],
      buttonPosition: { left: 20, top: 30 },
    },
  });

  const result = await controller.initialize();

  assert.equal(result.ok, true);
  assert.deepEqual(controller.getState(), {
    prompts: [prompt],
    placeholderHistory: ["<旧>"],
    buttonPosition: { left: 20, top: 30 },
    autoSelectBracketPlaceholder: true,
    loading: false,
    busy: false,
  });
  assert.equal(storage.listeners.size, 1);
  assert.deepEqual(view.renders.at(-1), controller.getState());
});

test("initialize keeps an empty prompt list empty and does not write storage", async () => {
  const { controller, storage, view } = createController({
    initialState: { prompts: [] },
  });

  const result = await controller.initialize();

  assert.equal(result.ok, true);
  assert.deepEqual(storage.promptSaves, []);
  assert.deepEqual(controller.getState().prompts, []);
  assert.deepEqual(view.renders.at(-1).prompts, []);
});

test("load failure renders a safe empty state and a visible Chinese error", async () => {
  const storage = new FakeStorage();
  storage.nextLoadError = Object.assign(new Error("context gone"), {
    code: "EXTENSION_CONTEXT_INVALID",
  });
  const { controller, view } = createController({ storage });

  const result = await controller.initialize();

  assert.equal(result.ok, false);
  assert.deepEqual(controller.getState(), {
    prompts: [],
    placeholderHistory: [],
    buttonPosition: null,
    autoSelectBracketPlaceholder: true,
    loading: false,
    busy: false,
  });
  assert.match(view.statuses.at(-1).message, /加载失败/u);
  assert.equal(view.statuses.at(-1).kind, "error");
});

test("load failure remains visible when storage subscription is also unavailable", async () => {
  const storage = new FakeStorage();
  storage.nextLoadError = Object.assign(new Error("context gone"), {
    code: "EXTENSION_CONTEXT_INVALID",
  });
  storage.subscribe = () => {
    throw new Error("context gone");
  };
  const { controller, view } = createController({ storage });

  await controller.initialize();

  assert.match(view.statuses.at(-1).message, /加载失败/u);
  assert.doesNotMatch(view.statuses.at(-1).message, /跨标签页/u);
});

test("add, edit, and delete commit only persisted candidate states", async () => {
  const { controller, storage } = createController();
  await controller.initialize();

  assert.deepEqual(
    await controller.savePrompt({
      name: "  新提示词  ",
      prompt: "前<位置>后",
      placeholder: "  <位置>  ",
    }),
    { ok: true, id: "generated-id" },
  );
  const added = {
    id: "generated-id",
    name: "新提示词",
    prompt: "前<位置>后",
    placeholder: "<位置>",
  };
  assert.deepEqual(controller.getState().prompts, [added]);
  assert.deepEqual(controller.getState().placeholderHistory, ["<位置>"]);
  assert.deepEqual(storage.promptSaves[0], {
    prompts: [added],
    placeholderHistory: ["<位置>"],
  });

  await controller.savePrompt({
    ...added,
    name: "已编辑",
    prompt: "新正文",
    placeholder: DEFAULT_PLACEHOLDER,
  });
  assert.deepEqual(controller.getState().prompts, [
    {
      id: "generated-id",
      name: "已编辑",
      prompt: "新正文",
      placeholder: DEFAULT_PLACEHOLDER,
    },
  ]);
  assert.deepEqual(storage.promptSaves[1].placeholderHistory, ["<位置>"]);

  assert.deepEqual(await controller.deletePrompt("generated-id"), { ok: true });
  assert.deepEqual(controller.getState().prompts, []);
  assert.deepEqual(storage.promptSaves[2], {
    prompts: [],
    placeholderHistory: ["<位置>"],
  });
});

test("reorder persists a new prompt order and ignores identical or invalid ids", async () => {
  const prompts = [
    { id: "a", name: "甲", prompt: "一", placeholder: DEFAULT_PLACEHOLDER },
    { id: "b", name: "乙", prompt: "二", placeholder: DEFAULT_PLACEHOLDER },
    { id: "c", name: "丙", prompt: "三", placeholder: DEFAULT_PLACEHOLDER },
  ];
  const { controller, storage, view } = createController({
    initialState: { prompts, placeholderHistory: ["<旧>"] },
  });
  await controller.initialize();

  assert.deepEqual(await controller.reorderPrompts(["a", "b", "c"]), { ok: true });
  assert.equal(storage.promptSaves.length, 0);

  const rendersBeforeReorder = view.renders.length;
  assert.deepEqual(await controller.reorderPrompts(["c", "a", "b"]), { ok: true });
  assert.equal(
    view.renders.slice(rendersBeforeReorder).some((state) => state.busy),
    false,
  );
  assert.deepEqual(
    controller.getState().prompts.map((record) => record.id),
    ["c", "a", "b"],
  );
  assert.deepEqual(storage.promptSaves.at(-1), {
    prompts: [prompts[2], prompts[0], prompts[1]],
    placeholderHistory: ["<旧>"],
  });

  const invalid = await controller.reorderPrompts(["c", "missing"]);
  assert.deepEqual(invalid, { ok: false, code: "INVALID_ORDER" });
  assert.deepEqual(
    controller.getState().prompts.map((record) => record.id),
    ["c", "a", "b"],
  );
  assert.match(view.statuses.at(-1).message, /无法调整提示词顺序/u);
});

test("failed reorder restores the previous prompt order", async () => {
  const prompts = [
    { id: "a", name: "甲", prompt: "一", placeholder: DEFAULT_PLACEHOLDER },
    { id: "b", name: "乙", prompt: "二", placeholder: DEFAULT_PLACEHOLDER },
  ];
  const { controller, storage, view } = createController({
    initialState: { prompts },
  });
  await controller.initialize();
  storage.nextSaveError = new Error("quota");

  const result = await controller.reorderPrompts(["b", "a"]);

  assert.equal(result.ok, false);
  assert.deepEqual(
    controller.getState().prompts.map((record) => record.id),
    ["a", "b"],
  );
  assert.match(view.statuses.at(-1).message, /调整顺序失败/u);
});

test("failed prompt writes restore the full list and history and remain retryable", async () => {
  const original = {
    id: "one",
    name: "原始",
    prompt: "旧正文",
    placeholder: "<旧>",
  };
  const { controller, storage, view } = createController({
    initialState: { prompts: [original], placeholderHistory: ["<旧>"] },
  });
  await controller.initialize();
  storage.nextSaveError = new Error("quota");

  const failed = await controller.savePrompt({
    id: "one",
    name: "候选",
    prompt: "新正文",
    placeholder: "<新>",
  });

  assert.equal(failed.ok, false);
  assert.deepEqual(controller.getState().prompts, [original]);
  assert.deepEqual(controller.getState().placeholderHistory, ["<旧>"]);
  assert.deepEqual(storage.promptSaves[0].placeholderHistory, ["<新>", "<旧>"]);
  assert.match(view.statuses.at(-1).message, /保存失败.*重试/u);
  assert.equal(controller.getState().busy, false);

  const retried = await controller.savePrompt({
    id: "one",
    name: "候选",
    prompt: "新正文",
    placeholder: "<新>",
  });
  assert.equal(retried.ok, true);
  assert.equal(controller.getState().prompts[0].name, "候选");
  assert.deepEqual(controller.getState().placeholderHistory, ["<新>", "<旧>"]);
});

test("failed history deletion rolls back history and its persisted payload", async () => {
  const prompt = {
    id: "one",
    name: "提示词",
    prompt: "正文",
    placeholder: DEFAULT_PLACEHOLDER,
  };
  const { controller, storage, view } = createController({
    initialState: {
      prompts: [prompt],
      placeholderHistory: ["<一>", "<二>"],
    },
  });
  await controller.initialize();
  storage.nextSaveError = new Error("disk full");

  const result = await controller.deletePlaceholderHistory("<一>");

  assert.equal(result.ok, false);
  assert.deepEqual(controller.getState().placeholderHistory, ["<一>", "<二>"]);
  assert.deepEqual(storage.promptSaves.at(-1), {
    prompts: [prompt],
    placeholderHistory: ["<二>"],
  });
  assert.match(view.statuses.at(-1).message, /删除历史失败/u);
});

test("slot plans are generic and follow the existing bracket-processing switch", async () => {
  const prompt = {
    id: "slots",
    name: "任意模板",
    prompt: "为【对象】写【语气】内容，再提到【对象】。【光标】",
    placeholder: DEFAULT_PLACEHOLDER,
  };
  const { controller } = createController({
    initialState: { prompts: [prompt] },
  });
  await controller.initialize();

  const plan = controller.getPromptSlotPlan("slots");
  assert.equal(plan.ok, true);
  assert.equal(plan.prompt, prompt.prompt);
  assert.deepEqual(
    plan.slots.map(({ key, count }) => ({ key, count })),
    [
      { key: "对象", count: 2 },
      { key: "语气", count: 1 },
    ],
  );

  await controller.setAutoSelectBracketPlaceholder(false);
  assert.deepEqual(controller.getPromptSlotPlan("slots").slots, []);
  assert.deepEqual(controller.getPromptSlotPlan("missing"), {
    ok: false,
    code: "PROMPT_NOT_FOUND",
  });
});

test("insertion applies transient slot values without writing storage", async () => {
  const prompt = {
    id: "slots",
    name: "填写后插入",
    prompt: "给【对象】写【语气】内容，再称呼【对象】。",
    placeholder: DEFAULT_PLACEHOLDER,
  };
  const { controller, editor, storage } = createController({
    initialState: { prompts: [prompt] },
  });
  await controller.initialize();

  assert.deepEqual(
    await controller.insertPrompt("slots", {
      expectedPrompt: prompt.prompt,
      slotValues: new Map([["对象", "开发者"]]),
    }),
    { ok: true, code: "INSERTED" },
  );
  const expectedText = "给开发者写【语气】内容，再称呼开发者。";
  assert.deepEqual(editor.insertCalls, [
    {
      text: expectedText,
      caretOffset: expectedText.indexOf("【语气】"),
      selectionEndOffset:
        expectedText.indexOf("【语气】") + "【语气】".length,
    },
  ]);
  assert.equal(storage.promptSaves.length, 0);
});

test("a changed prompt snapshot is not inserted with stale wizard answers", async () => {
  const prompt = {
    id: "slots",
    name: "会更新",
    prompt: "旧【主题】",
    placeholder: DEFAULT_PLACEHOLDER,
  };
  const { controller, editor, view } = createController({
    initialState: { prompts: [prompt] },
  });
  await controller.initialize();

  const result = await controller.insertPrompt("slots", {
    expectedPrompt: "更旧【主题】",
    slotValues: new Map([["主题", "内容"]]),
  });

  assert.deepEqual(result, { ok: false, code: "PROMPT_CHANGED" });
  assert.equal(editor.insertCalls.length, 0);
  assert.match(view.statuses.at(-1).message, /已在其他页面更新/u);
});

test("insertion uses the engine, closes without stealing focus, and reports exact failures", async () => {
  const prompt = {
    id: "one",
    name: "插入",
    prompt: "前<位置>后",
    placeholder: "<位置>",
  };
  const editor = {
    insertCalls: [],
    captureBookmark() {
      return { offset: 2 };
    },
    insert(text, caretOffset) {
      this.insertCalls.push({ text, caretOffset });
      return { ok: true, code: "INSERTED" };
    },
  };
  const { controller, view } = createController({
    initialState: { prompts: [prompt] },
    editor,
  });
  await controller.initialize();

  assert.deepEqual(await controller.insertPrompt("one"), {
    ok: true,
    code: "INSERTED",
  });
  assert.deepEqual(editor.insertCalls, [{ text: "前后", caretOffset: 1 }]);
  assert.deepEqual(view.panelCloses, [{ restoreFocus: false }]);

  editor.insert = () => ({ ok: false, code: "EDITOR_NOT_FOUND" });
  assert.deepEqual(await controller.insertPrompt("one"), {
    ok: false,
    code: "EDITOR_NOT_FOUND",
  });
  assert.match(view.statuses.at(-1).message, /未找到.*输入框/u);

  editor.insert = () => ({ ok: false, code: "INSERTION_FAILED" });
  await controller.insertPrompt("one");
  assert.match(view.statuses.at(-1).message, /插入失败/u);
  assert.equal(view.panelCloses.length, 1);
});

test("bracket selection range reaches the editor and the global switch disables it", async () => {
  const prompt = {
    id: "bracket",
    name: "可填写",
    prompt: "前【主题】后",
    placeholder: DEFAULT_PLACEHOLDER,
  };
  const editor = {
    insertCalls: [],
    insert(text, caretOffset, selectionEndOffset) {
      const call = { text, caretOffset };
      if (Number.isFinite(selectionEndOffset)) {
        call.selectionEndOffset = selectionEndOffset;
      }
      this.insertCalls.push(call);
      return { ok: true, code: "INSERTED" };
    },
  };
  const { controller, storage } = createController({
    initialState: { prompts: [prompt] },
    editor,
  });
  await controller.initialize();

  await controller.insertPrompt("bracket");
  assert.deepEqual(editor.insertCalls[0], {
    text: prompt.prompt,
    caretOffset: 1,
    selectionEndOffset: 5,
  });

  assert.deepEqual(await controller.setAutoSelectBracketPlaceholder(false), {
    ok: true,
  });
  assert.equal(controller.getState().autoSelectBracketPlaceholder, false);
  assert.deepEqual(storage.settingSaves, [false]);

  await controller.insertPrompt("bracket");
  assert.deepEqual(editor.insertCalls[1], {
    text: prompt.prompt,
    caretOffset: prompt.prompt.length,
  });
});

test("failed bracket selection setting writes restore the previous value", async () => {
  const { controller, storage, view } = createController({
    initialState: { autoSelectBracketPlaceholder: false },
  });
  await controller.initialize();
  storage.nextSettingError = Object.assign(new Error("quota"), {
    code: "CHROME_RUNTIME_ERROR",
  });

  const result = await controller.setAutoSelectBracketPlaceholder(true);

  assert.deepEqual(result, { ok: false, code: "CHROME_RUNTIME_ERROR" });
  assert.equal(controller.getState().autoSelectBracketPlaceholder, false);
  assert.match(view.statuses.at(-1).message, /设置保存失败/u);
});

test("concurrent writes are rejected while the candidate remains uncommitted", async () => {
  const storage = new FakeStorage();
  const gate = deferred();
  storage.nextSaveGate = gate;
  const { controller, view } = createController({ storage });
  await controller.initialize();

  const first = controller.savePrompt({ name: "第一条", prompt: "一" });
  assert.equal(controller.getState().busy, true);
  assert.deepEqual(controller.getState().prompts, []);
  const duplicate = await controller.savePrompt({ name: "第二条", prompt: "二" });

  assert.deepEqual(duplicate, { ok: false, code: "BUSY" });
  assert.equal(storage.promptSaves.length, 1);
  assert.match(view.statuses.at(-1).message, /正在保存/u);
  gate.resolve();
  assert.deepEqual(await first, { ok: true, id: "generated-id" });
  assert.equal(controller.getState().prompts[0].name, "第一条");
});

test("external storage changes reload prompts, history, and button position", async () => {
  const { controller, storage } = createController();
  await controller.initialize();
  const external = {
    prompts: [
      {
        id: "remote",
        name: "外部",
        prompt: "同步",
        placeholder: DEFAULT_PLACEHOLDER,
      },
    ],
    placeholderHistory: ["<外部>"],
    buttonPosition: { left: 90, top: 40 },
    autoSelectBracketPlaceholder: false,
  };

  await storage.emitExternal(external);

  assert.deepEqual(controller.getState(), {
    ...external,
    loading: false,
    busy: false,
  });
  assert.equal(storage.loadCalls, 2);
});

test("button position stays at the safe local coordinates when persistence fails", async () => {
  const { controller, storage, view } = createController();
  await controller.initialize();
  storage.nextPositionError = new Error("quota");

  const result = await controller.saveButtonPosition({ left: 80, top: 60 });

  assert.equal(result.ok, false);
  assert.deepEqual(controller.getState().buttonPosition, { left: 80, top: 60 });
  assert.deepEqual(storage.positionSaves, [{ left: 80, top: 60 }]);
  assert.match(view.statuses.at(-1).message, /位置保存失败/u);
});

test("captureBookmark delegates before UI focus and destroy removes synchronization", async () => {
  const { controller, storage, editor } = createController();
  await controller.initialize();

  assert.deepEqual(controller.captureBookmark(), { offset: 1 });
  assert.equal(editor.bookmarks, 1);
  controller.destroy();
  controller.destroy();

  assert.equal(storage.listeners.size, 0);
  assert.equal(storage.unsubscribeCalls, 1);
  await storage.emitExternal({
    prompts: [],
    placeholderHistory: ["<ignored>"],
    buttonPosition: null,
  });
  assert.deepEqual(controller.getState().placeholderHistory, []);
});

function createContentHarness(options = {}) {
  const scheduled = [];
  const staleRoot = options.staleRoot || null;
  const documentObject = {
    documentElement: { id: "document-element" },
    readyState: "complete",
    getElementById(id) {
      return id === "phg-root" ? staleRoot : null;
    },
  };
  const windowObject = { document: documentObject };
  const instances = {
    storage: [],
    editor: [],
    ui: [],
    controller: [],
    observer: [],
  };

  class HarnessStorage {
    constructor(chromeApi) {
      this.chromeApi = chromeApi;
      instances.storage.push(this);
    }
  }

  class HarnessEditor {
    constructor(constructorOptions) {
      this.options = constructorOptions;
      this.rebindCalls = 0;
      instances.editor.push(this);
    }

    rebind() {
      this.rebindCalls += 1;
      return null;
    }
  }

  class HarnessUI {
    constructor(constructorOptions) {
      this.options = constructorOptions;
      this.root = { id: "phg-root", isConnected: true };
      this.mountCalls = [];
      this.ensureMountedCalls = 0;
      this.destroyCalls = 0;
      instances.ui.push(this);
    }

    mount(controller) {
      this.mountCalls.push(controller);
      return this.root;
    }

    ensureMounted() {
      this.ensureMountedCalls += 1;
      return this.root;
    }

    destroy() {
      this.destroyCalls += 1;
    }
  }

  class HarnessController {
    constructor(constructorOptions) {
      this.options = constructorOptions;
      this.initializeCalls = 0;
      this.destroyCalls = 0;
      instances.controller.push(this);
    }

    async initialize() {
      this.initializeCalls += 1;
      return options.initializeResult || { ok: true };
    }

    destroy() {
      this.destroyCalls += 1;
    }
  }

  class HarnessMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.observeCalls = [];
      this.disconnectCalls = 0;
      instances.observer.push(this);
    }

    observe(target, observerOptions) {
      this.observeCalls.push({ target, options: clone(observerOptions) });
    }

    disconnect() {
      this.disconnectCalls += 1;
    }

    trigger() {
      this.callback([{ type: "childList" }], this);
    }
  }

  return {
    scheduled,
    instances,
    documentObject,
    windowObject,
    initializeOptions: {
      document: documentObject,
      window: windowObject,
      chrome: { name: "chrome-api" },
      Storage: HarnessStorage,
      GrokComposerAdapter: HarnessEditor,
      PromptHelperUI: HarnessUI,
      PromptHelperController: HarnessController,
      extractPromptSlots: engine.extractPromptSlots,
      prepareInsertion: engine.prepareInsertion,
      updatePlaceholderHistory: engine.updatePlaceholderHistory,
      MutationObserver: HarnessMutationObserver,
      schedule(callback) {
        scheduled.push(callback);
      },
    },
  };
}

test("content exposes initialization and teardown through CommonJS and PromptHelper", () => {
  assert.equal(typeof contentApi.initializePromptHelper, "function");
  assert.equal(typeof contentApi.destroyPromptHelper, "function");
  assert.equal(
    globalThis.PromptHelper?.initializePromptHelper,
    contentApi.initializePromptHelper,
  );
});

test("content initialization wires one runtime and removes a stale orphan root", async () => {
  await contentApi.destroyPromptHelper?.();
  const staleRoot = {
    removeCalls: 0,
    remove() {
      this.removeCalls += 1;
    },
  };
  const harness = createContentHarness({ staleRoot });

  const first = await contentApi.initializePromptHelper(harness.initializeOptions);
  const second = await contentApi.initializePromptHelper(harness.initializeOptions);

  assert.equal(first, second);
  assert.equal(staleRoot.removeCalls, 1);
  assert.equal(harness.instances.storage.length, 1);
  assert.equal(harness.instances.editor.length, 1);
  assert.equal(harness.instances.ui.length, 1);
  assert.equal(harness.instances.controller.length, 1);
  assert.equal(harness.instances.ui[0].mountCalls[0], harness.instances.controller[0]);
  assert.equal(harness.instances.controller[0].options.storage, harness.instances.storage[0]);
  assert.equal(harness.instances.controller[0].options.editor, harness.instances.editor[0]);
  assert.equal(harness.instances.controller[0].options.view, harness.instances.ui[0]);
  assert.equal(
    harness.instances.controller[0].options.extractPromptSlots,
    engine.extractPromptSlots,
  );
  assert.equal(harness.instances.controller[0].initializeCalls, 1);
  assert.equal(harness.instances.editor[0].rebindCalls, 1);
  assert.equal(first.root, harness.instances.ui[0].root);
  assert.deepEqual(harness.instances.observer[0].observeCalls, [
    {
      target: harness.documentObject.documentElement,
      options: { childList: true, subtree: true },
    },
  ]);

  first.destroy();
});

test("MutationObserver coalesces SPA rebinds and keeps the UI singleton mounted", async () => {
  await contentApi.destroyPromptHelper?.();
  const harness = createContentHarness();
  const runtime = await contentApi.initializePromptHelper(harness.initializeOptions);
  const observer = harness.instances.observer[0];
  const editor = harness.instances.editor[0];
  const ui = harness.instances.ui[0];

  observer.trigger();
  observer.trigger();
  observer.trigger();
  assert.equal(harness.scheduled.length, 1);
  assert.equal(editor.rebindCalls, 1);

  harness.scheduled.shift()();
  assert.equal(editor.rebindCalls, 2);
  assert.equal(ui.ensureMountedCalls, 1);

  observer.trigger();
  assert.equal(harness.scheduled.length, 1);
  runtime.destroy();
  harness.scheduled.shift()();
  assert.equal(editor.rebindCalls, 2);
  assert.equal(observer.disconnectCalls, 1);
  assert.equal(harness.instances.controller[0].destroyCalls, 1);
  assert.equal(ui.destroyCalls, 1);
});

test("destroyPromptHelper is idempotent and permits a fresh later initialization", async () => {
  await contentApi.destroyPromptHelper?.();
  const firstHarness = createContentHarness();
  await contentApi.initializePromptHelper(firstHarness.initializeOptions);

  await contentApi.destroyPromptHelper();
  await contentApi.destroyPromptHelper();
  assert.equal(firstHarness.instances.observer[0].disconnectCalls, 1);
  assert.equal(firstHarness.instances.controller[0].destroyCalls, 1);
  assert.equal(firstHarness.instances.ui[0].destroyCalls, 1);

  const secondHarness = createContentHarness();
  const second = await contentApi.initializePromptHelper(secondHarness.initializeOptions);
  assert.equal(secondHarness.instances.controller.length, 1);
  second.destroy();
});
