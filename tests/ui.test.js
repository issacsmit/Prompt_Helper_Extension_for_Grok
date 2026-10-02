"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

const uiApi = optionalRequire("../ui.js");

test("ui exposes pure layout helpers through CommonJS and PromptHelper", () => {
  assert.equal(typeof uiApi.clampFloatingPosition, "function");
  assert.equal(typeof uiApi.calculatePanelPosition, "function");
  assert.equal(typeof uiApi.getFocusCycleTarget, "function");
  assert.equal(typeof uiApi.isDragGesture, "function");
  assert.equal(typeof uiApi.dropIndexFromDisplacement, "function");
  assert.equal(typeof uiApi.clampDragDelta, "function");
  assert.equal(typeof uiApi.listDragShift, "function");
  assert.equal(typeof uiApi.reorderRecords, "function");
  assert.equal(
    globalThis.PromptHelper?.clampFloatingPosition,
    uiApi.clampFloatingPosition,
  );
});

test("floating positions default to the lower-right and stay recoverable", () => {
  const viewport = { width: 320, height: 240 };
  const size = { width: 48, height: 48 };

  assert.deepEqual(
    uiApi.clampFloatingPosition(null, viewport, size, 12),
    { left: 248, top: 168 },
  );
  assert.deepEqual(
    uiApi.clampFloatingPosition(
      { left: -500, top: 999 },
      viewport,
      size,
      12,
    ),
    { left: 12, top: 180 },
  );
  assert.deepEqual(
    uiApi.clampFloatingPosition(
      { left: 50, top: 50 },
      { width: 30, height: 20 },
      { width: 48, height: 48 },
      12,
    ),
    { left: 0, top: 0 },
  );
});

test("panel positioning chooses available sides and clamps to the viewport", () => {
  const viewport = { width: 500, height: 400 };
  const panel = { width: 240, height: 220 };

  assert.deepEqual(
    uiApi.calculatePanelPosition(
      { left: 430, top: 330, right: 478, bottom: 378, width: 48, height: 48 },
      panel,
      viewport,
      { gap: 8, margin: 12 },
    ),
    { left: 238, top: 102, placement: "above" },
  );
  assert.deepEqual(
    uiApi.calculatePanelPosition(
      { left: 14, top: 14, right: 62, bottom: 62, width: 48, height: 48 },
      panel,
      viewport,
      { gap: 8, margin: 12 },
    ),
    { left: 14, top: 70, placement: "below" },
  );
  assert.deepEqual(
    uiApi.calculatePanelPosition(
      { left: 20, top: 130, right: 68, bottom: 178, width: 48, height: 48 },
      { width: 180, height: 280 },
      { width: 500, height: 300 },
      { gap: 8, margin: 12 },
    ),
    { left: 76, top: 14, placement: "right" },
  );
});

test("focus cycling skips unusable entries and wraps in either direction", () => {
  const first = { id: "first" };
  const disabled = { id: "disabled", disabled: true };
  const hidden = { id: "hidden", hidden: true };
  const last = { id: "last" };
  const entries = [first, disabled, hidden, last];

  assert.equal(uiApi.getFocusCycleTarget(entries, first, false), last);
  assert.equal(uiApi.getFocusCycleTarget(entries, last, false), first);
  assert.equal(uiApi.getFocusCycleTarget(entries, first, true), last);
  assert.equal(uiApi.getFocusCycleTarget([], first, false), null);
});

test("dragging begins only after pointer movement exceeds the threshold", () => {
  const start = { x: 10, y: 10 };

  assert.equal(uiApi.isDragGesture(start, { x: 13, y: 14 }, 5), false);
  assert.equal(uiApi.isDragGesture(start, { x: 16, y: 10 }, 5), true);
  assert.equal(uiApi.isDragGesture(start, { x: 99, y: 99 }, -1), true);
  assert.equal(uiApi.isDragGesture(null, { x: 20, y: 20 }, 5), false);
});

test("list drag shifts neighbors out of the moving card's path", () => {
  assert.equal(uiApi.listDragShift(0, 2, 0, 71), 0);
  assert.equal(uiApi.listDragShift(0, 2, 1, 71), -71);
  assert.equal(uiApi.listDragShift(0, 2, 2, 71), -71);
  assert.equal(uiApi.listDragShift(2, 0, 0, 71), 71);
  assert.equal(uiApi.listDragShift(2, 0, 1, 71), 71);
  assert.equal(uiApi.listDragShift(2, 0, 2, 71), 0);
  assert.equal(uiApi.listDragShift(1, 1, 0, 71), 0);
});

test("drag translation stops at the first and last slots", () => {
  assert.equal(uiApi.clampDragDelta(0, 160, 71, 3), 142);
  assert.equal(uiApi.clampDragDelta(0, 999, 71, 3), 142);
  assert.equal(uiApi.clampDragDelta(2, -999, 71, 3), -142);
  assert.equal(uiApi.clampDragDelta(1, 20, 71, 3), 20);
  assert.equal(uiApi.clampDragDelta(0, -40, 71, 3), 0);
});

test("drop index follows card travel to the nearest slot, not pointer midpoints", () => {
  assert.equal(uiApi.dropIndexFromDisplacement(0, 0, 71, 3), 0);
  assert.equal(uiApi.dropIndexFromDisplacement(0, 35, 71, 3), 0);
  assert.equal(uiApi.dropIndexFromDisplacement(0, 36, 71, 3), 1);
  assert.equal(uiApi.dropIndexFromDisplacement(1, -36, 71, 3), 0);
  assert.equal(uiApi.dropIndexFromDisplacement(1, 36, 71, 3), 2);
  assert.equal(uiApi.dropIndexFromDisplacement(0, 160, 71, 3), 2);
  assert.equal(uiApi.dropIndexFromDisplacement(2, -160, 71, 3), 0);
  assert.equal(uiApi.dropIndexFromDisplacement(0, 999, 71, 3), 2);
  assert.equal(uiApi.dropIndexFromDisplacement(0, 10, 0, 3), 0);
});

test("reorderRecords rebuilds the same records in the requested id order", () => {
  const records = [
    { id: "a", name: "甲" },
    { id: "b", name: "乙" },
    { id: "c", name: "丙" },
  ];

  assert.deepEqual(uiApi.reorderRecords(records, ["c", "a", "b"]).map((entry) => entry.id), [
    "c",
    "a",
    "b",
  ]);
  assert.equal(uiApi.reorderRecords(records, ["a", "b"]), null);
  assert.equal(uiApi.reorderRecords(records, ["a", "b", "a"]), null);
  assert.equal(uiApi.reorderRecords(records, ["a", "b", "missing"]), null);
  assert.deepEqual(uiApi.reorderRecords([], []), []);
});

class FakeEventTarget {
  constructor() {
    this._listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this._listeners.get(type) || [];
    listeners.push(listener);
    this._listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this._listeners.get(type) || [];
    this._listeners.set(
      type,
      listeners.filter((candidate) => candidate !== listener),
    );
  }

  _invoke(event) {
    for (const listener of [...(this._listeners.get(event.type) || [])]) {
      event.currentTarget = this;
      listener.call(this, event);
    }
  }
}

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = init.bubbles !== false;
    this.cancelable = init.cancelable !== false;
    this.defaultPrevented = false;
    this.propagationStopped = false;
    Object.assign(this, init);
  }

  preventDefault() {
    if (this.cancelable) {
      this.defaultPrevented = true;
    }
  }

  stopPropagation() {
    this.propagationStopped = true;
  }
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  _values() {
    return this.element.className.split(/\s+/u).filter(Boolean);
  }

  contains(value) {
    return this._values().includes(value);
  }

  add(...values) {
    this.element.className = [...new Set([...this._values(), ...values])].join(" ");
  }

  remove(...values) {
    this.element.className = this._values()
      .filter((value) => !values.includes(value))
      .join(" ");
  }

  toggle(value, force) {
    const shouldAdd = force === undefined ? !this.contains(value) : Boolean(force);
    if (shouldAdd) {
      this.add(value);
    } else {
      this.remove(value);
    }
    return shouldAdd;
  }
}

class FakeElement extends FakeEventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.required = false;
    this.value = "";
    this.type = "";
    this._textContent = "";
    this._capturedPointers = new Set();
    this.scrollTop = 0;
  }

  get parentElement() {
    return this.parentNode?.nodeType === 1 ? this.parentNode : null;
  }

  get childNodes() {
    return this.children;
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get id() {
    return this.getAttribute("id") || "";
  }

  set id(value) {
    this.setAttribute("id", value);
  }

  get className() {
    return this.getAttribute("class") || "";
  }

  set className(value) {
    this.setAttribute("class", value);
  }

  get classList() {
    return new FakeClassList(this);
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children = [];
  }

  get isConnected() {
    let current = this;
    while (current) {
      if (current.nodeType === 9) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(String(name)) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(String(name));
  }

  removeAttribute(name) {
    this.attributes.delete(String(name));
  }

  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  append(...children) {
    for (const child of children) {
      this.appendChild(child);
    }
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  insertBefore(node, referenceNode) {
    if (node === referenceNode) {
      return node;
    }
    if (node?.parentNode) {
      node.parentNode.removeChild(node);
    }
    if (referenceNode == null) {
      this.children.push(node);
    } else {
      const index = this.children.indexOf(referenceNode);
      this.children.splice(index < 0 ? this.children.length : index, 0, node);
    }
    if (node) {
      node.parentNode = this;
    }
    return node;
  }

  before(node) {
    this.parentNode?.insertBefore(node, this);
  }

  after(node) {
    const parent = this.parentNode;
    if (!parent) {
      return;
    }
    const next = parent.children[parent.children.indexOf(this) + 1] || null;
    parent.insertBefore(node, next);
  }

  replaceChildren(...children) {
    for (const child of this.children) {
      child.parentNode = null;
    }
    this.children = [];
    this._textContent = "";
    this.append(...children);
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  contains(candidate) {
    let current = candidate;
    while (current) {
      if (current === this) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  }

  matches(selector) {
    return String(selector)
      .split(",")
      .some((part) => matchesFakeSelector(this, part.trim()));
  }

  closest(selector) {
    let current = this;
    while (current?.nodeType === 1) {
      if (current.matches(selector)) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  querySelectorAll(selector) {
    return fakeDescendants(this).filter((element) =>
      selector.split(",").some((part) => matchesFakeSelector(element, part.trim())),
    );
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  click() {
    this.dispatchEvent(new FakeEvent("click", { bubbles: true }));
  }

  dispatchEvent(event) {
    if (!event.target) {
      event.target = this;
    }
    let current = this;
    while (current) {
      current._invoke?.(event);
      if (!event.bubbles || event.propagationStopped) {
        break;
      }
      current = current.parentNode;
    }
    return !event.defaultPrevented;
  }

  setPointerCapture(pointerId) {
    this._capturedPointers.add(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this._capturedPointers.has(pointerId);
  }

  releasePointerCapture(pointerId) {
    this._capturedPointers.delete(pointerId);
  }

  getBoundingClientRect() {
    if (this.classList.contains("phg-prompt-card") && this.parentNode?.children) {
      const siblings = this.parentNode.children.filter((child) =>
        child.classList?.contains("phg-prompt-card"),
      );
      const index = Math.max(0, siblings.indexOf(this));
      const height = 64;
      const gap = 7;
      const top = index * (height + gap);
      return {
        left: 0,
        top,
        right: 320,
        bottom: top + height,
        width: 320,
        height,
      };
    }
    const width = this.id === "phg-launcher" ? 50 : this.id === "phg-panel" ? 360 : 400;
    const height = this.id === "phg-launcher" ? 52 : this.id === "phg-panel" ? 300 : 320;
    const left = Number.parseFloat(this.style.left) || 0;
    const top = Number.parseFloat(this.style.top) || 0;
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    };
  }
}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.nodeType = 9;
    this.parentNode = null;
    this.activeElement = null;
    this.documentElement = new FakeElement("html", this);
    this.documentElement.parentNode = this;
    this.body = new FakeElement("body", this);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  getElementById(id) {
    return [this.documentElement, ...fakeDescendants(this.documentElement)].find(
      (element) => element.id === id,
    ) || null;
  }

  querySelectorAll(selector) {
    return [this.documentElement, ...fakeDescendants(this.documentElement)].filter(
      (element) =>
        selector.split(",").some((part) => matchesFakeSelector(element, part.trim())),
    );
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  dispatchEvent(event) {
    if (!event.target) {
      event.target = this;
    }
    this._invoke(event);
    return !event.defaultPrevented;
  }
}

class FakeWindow extends FakeEventTarget {
  constructor(documentObject) {
    super();
    this.document = documentObject;
    this.innerWidth = 900;
    this.innerHeight = 700;
    this.Event = FakeEvent;
    this.PointerEvent = FakeEvent;
  }

  dispatchEvent(event) {
    if (!event.target) {
      event.target = this;
    }
    this._invoke(event);
    return !event.defaultPrevented;
  }
}

function fakeDescendants(root) {
  const descendants = [];
  for (const child of root.children || []) {
    descendants.push(child, ...fakeDescendants(child));
  }
  return descendants;
}

function matchesFakeSelector(element, selector) {
  if (!selector) {
    return false;
  }
  const notTabMinusOne = selector.includes(":not([tabindex=\"-1\"])");
  const base = selector.replace(":not([tabindex=\"-1\"])", "");
  if (notTabMinusOne && element.getAttribute("tabindex") === "-1") {
    return false;
  }
  if (base.startsWith("#")) {
    return element.id === base.slice(1);
  }
  if (base.startsWith(".")) {
    return element.classList.contains(base.slice(1));
  }
  const attributeMatch = /^\[([^=]+?)(?:="([^"]*)")?\]$/u.exec(base);
  if (attributeMatch) {
    return attributeMatch[2] === undefined
      ? element.hasAttribute(attributeMatch[1])
      : element.getAttribute(attributeMatch[1]) === attributeMatch[2];
  }
  const tagAttributeMatch = /^([a-z]+)\[([^=]+)="([^"]*)"\]$/u.exec(base);
  if (tagAttributeMatch) {
    return (
      element.tagName === tagAttributeMatch[1].toUpperCase() &&
      element.getAttribute(tagAttributeMatch[2]) === tagAttributeMatch[3]
    );
  }
  return element.tagName === base.toUpperCase();
}

function createFakeDom() {
  const documentObject = new FakeDocument();
  const windowObject = new FakeWindow(documentObject);
  documentObject.defaultView = windowObject;
  return { documentObject, windowObject };
}

function createControllerStub() {
  return {
    bookmarkCalls: 0,
    insertCalls: [],
    insertOptionCalls: [],
    slotPlanCalls: [],
    saveCalls: [],
    reorderCalls: [],
    deleteCalls: [],
    historyDeleteCalls: [],
    positionCalls: [],
    settingCalls: [],
    nextSaveResult: { ok: true },
    nextDeleteResult: { ok: true },
    nextSettingResult: { ok: true },
    nextInsertResult: { ok: true },
    nextSlotPlan: { ok: true, slots: [] },
    captureBookmark() {
      this.bookmarkCalls += 1;
      return { offset: 2 };
    },
    getPromptSlotPlan(id) {
      this.slotPlanCalls.push(id);
      return cloneValue(this.nextSlotPlan);
    },
    async insertPrompt(id, options = {}) {
      this.insertCalls.push(id);
      this.insertOptionCalls.push(cloneValue(options));
      return this.nextInsertResult;
    },
    async savePrompt(record) {
      this.saveCalls.push(cloneValue(record));
      return this.nextSaveResult;
    },
    async reorderPrompts(orderedIds) {
      this.reorderCalls.push(cloneValue(orderedIds));
      return { ok: true };
    },
    async deletePrompt(id) {
      this.deleteCalls.push(id);
      return this.nextDeleteResult;
    },
    async deletePlaceholderHistory(value) {
      this.historyDeleteCalls.push(value);
      return { ok: true };
    },
    async saveButtonPosition(position) {
      this.positionCalls.push(cloneValue(position));
      return { ok: true };
    },
    async setAutoSelectBracketPlaceholder(enabled) {
      this.settingCalls.push(enabled);
      return this.nextSettingResult;
    },
  };
}

function cloneValue(value) {
  return structuredClone(value);
}

function flushTasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function mountUi() {
  const { documentObject, windowObject } = createFakeDom();
  const controller = createControllerStub();
  const ui = new uiApi.PromptHelperUI({
    document: documentObject,
    window: windowObject,
  });
  const root = ui.mount(controller);
  return { ui, root, controller, documentObject, windowObject };
}

const emptyState = Object.freeze({
  prompts: [],
  placeholderHistory: [],
  buttonPosition: null,
  autoSelectBracketPlaceholder: true,
  loading: false,
  busy: false,
});

test("PromptHelperUI mounts the Steel Mist launcher and three-part panel", () => {
  const { ui, root, documentObject } = mountUi();
  const launcher = documentObject.getElementById("phg-launcher");
  const panel = documentObject.getElementById("phg-panel");

  assert.equal(root.id, "phg-root");
  assert.equal(documentObject.querySelectorAll("#phg-root").length, 1);
  assert.equal(launcher.tagName, "BUTTON");
  assert.doesNotMatch(launcher.textContent, /提示词/u);
  assert.ok(launcher.querySelector(".phg-launcher-mark"));
  const launcherSvg = launcher.querySelector("svg");
  assert.ok(launcherSvg);
  assert.equal(launcherSvg.getAttribute("viewBox"), "0 0 100 104.586");
  const launcherOrbit = launcher.querySelector(".phg-launcher-orbit");
  assert.ok(launcherOrbit);
  assert.equal(launcherOrbit.tagName, "ELLIPSE");
  assert.equal(launcherOrbit.getAttribute("cx"), "50");
  assert.equal(launcherOrbit.getAttribute("cy"), "52.3");
  assert.equal(launcherOrbit.getAttribute("rx"), "33");
  assert.equal(launcherOrbit.getAttribute("ry"), "20");
  assert.equal(launcherOrbit.getAttribute("transform"), "rotate(-18 50 52.3)");
  assert.equal(
    launcher.querySelector(".phg-launcher-caret").getAttribute("d"),
    "M50 37.5V67",
  );
  const launcherDot = launcher.querySelector(".phg-launcher-dot");
  assert.deepEqual(
    [
      launcherDot.getAttribute("cx"),
      launcherDot.getAttribute("cy"),
      launcherDot.getAttribute("r"),
    ],
    ["65.4", "31.2", "4.4"],
  );
  assert.equal(launcher.querySelector(".phg-launcher-badge"), null);
  assert.doesNotMatch(launcher.textContent, /P/u);
  assert.equal(launcher.getAttribute("aria-controls"), "phg-panel");

  assert.equal(panel.getAttribute("data-phg-state"), "closed");
  assert.equal(panel.getAttribute("aria-hidden"), "true");
  assert.equal(panel.hidden, false);
  assert.equal(panel.inert, true);
  assert.ok(panel.querySelector(".phg-panel-header"));
  assert.ok(panel.querySelector(".phg-panel-body"));
  assert.ok(panel.querySelector(".phg-panel-footer"));
  assert.ok(documentObject.getElementById("phg-add-prompt"));
  assert.ok(documentObject.getElementById("phg-open-settings"));

  ui.openPanel();
  assert.equal(panel.getAttribute("data-phg-state"), "open");
  assert.equal(panel.getAttribute("aria-hidden"), "false");
  assert.equal(panel.inert, false);
  assert.equal(launcher.getAttribute("aria-expanded"), "true");

  ui.closePanel({ restoreFocus: false });
  assert.equal(panel.getAttribute("data-phg-state"), "closed");
  assert.equal(panel.getAttribute("aria-hidden"), "true");
  assert.equal(panel.inert, true);
  assert.equal(launcher.getAttribute("aria-expanded"), "false");
});

test("panel positioning uses untransformed layout size during its opening transition", () => {
  const { ui, documentObject, windowObject } = mountUi();
  const panel = documentObject.getElementById("phg-panel");
  windowObject.innerWidth = 1280;
  ui.render({
    ...emptyState,
    buttonPosition: { left: 1216, top: 12 },
  });

  panel.getBoundingClientRect = () => ({
    left: Number.parseFloat(panel.style.left) || 0,
    top: Number.parseFloat(panel.style.top) || 0,
    right: (Number.parseFloat(panel.style.left) || 0) + 332.34,
    bottom: (Number.parseFloat(panel.style.top) || 0) + 286.5,
    width: 332.34,
    height: 286.5,
  });
  Object.defineProperties(panel, {
    offsetWidth: { value: 348 },
    offsetHeight: { value: 300 },
  });

  ui.openPanel();

  const panelRight = Number.parseFloat(panel.style.left) + panel.offsetWidth;
  assert.ok(
    panelRight <= windowObject.innerWidth - 12,
    `expected panel right ${panelRight} to stay within ${windowObject.innerWidth - 12}`,
  );
});

test("render restores the default launcher position when stored position is cleared", () => {
  const { ui, documentObject, windowObject } = mountUi();
  const launcher = documentObject.getElementById("phg-launcher");
  windowObject.innerWidth = 900;
  windowObject.innerHeight = 700;

  ui.render({
    ...emptyState,
    buttonPosition: { left: 120, top: 160 },
  });
  assert.deepEqual(
    { left: launcher.style.left, top: launcher.style.top },
    { left: "120px", top: "160px" },
  );

  ui.render({ ...emptyState, buttonPosition: null });
  assert.deepEqual(
    { left: launcher.style.left, top: launcher.style.top },
    { left: "826px", top: "624px" },
  );
});

test("render shows empty state or accessible prompt cards and dispatches CRUD actions", async () => {
  const { ui, controller, documentObject } = mountUi();
  ui.render(emptyState);
  assert.equal(documentObject.getElementById("phg-empty").hidden, false);

  const prompt = {
    id: "one",
    name: "代码审查",
    prompt: "请检查这段代码并给出改进建议。",
    placeholder: "【光标】",
  };
  ui.render({ ...emptyState, prompts: [prompt] });
  assert.equal(documentObject.getElementById("phg-empty").hidden, true);
  assert.equal(documentObject.querySelectorAll(".phg-prompt-card").length, 1);
  const card = documentObject.querySelector(".phg-prompt-card");
  const mainButton = card.querySelector(".phg-card-main");
  assert.ok(mainButton);
  assert.equal(mainButton.getAttribute("title"), "填写后插入");
  assert.match(mainButton.getAttribute("aria-label"), /填写后插入提示词/u);
  assert.ok(card.querySelector(".phg-card-actions"));
  assert.equal(card.querySelectorAll(".phg-card-action").length, 1);
  assert.equal(card.querySelector(".phg-card-action-danger"), null);
  assert.match(documentObject.getElementById("phg-prompt-list").textContent, /代码审查/u);

  const dragButton = card.querySelector('[data-phg-action="reorder"]');
  assert.ok(dragButton);
  assert.equal(dragButton.getAttribute("title"), "拖动调整顺序");
  assert.match(dragButton.getAttribute("aria-label"), /拖动调整顺序/u);
  const dragIcon = dragButton.querySelector("svg");
  assert.equal(dragIcon.getAttribute("data-phg-icon"), "reorder");
  assert.equal(dragIcon.getAttribute("viewBox"), "0 0 20 20");
  assert.equal(dragIcon.querySelector(".phg-card-drag-orbit").tagName, "ELLIPSE");
  assert.equal(
    dragIcon.querySelector(".phg-card-drag-orbit").getAttribute("transform"),
    "rotate(-16 10 10)",
  );
  assert.equal(dragIcon.querySelector(".phg-card-drag-dot").tagName, "CIRCLE");
  assert.equal(dragIcon.querySelectorAll("circle").length, 1);

  const directInsertButton = card.querySelector(
    '[data-phg-action="direct-insert"]',
  );
  assert.ok(directInsertButton);
  assert.equal(directInsertButton.getAttribute("title"), "直接插入");
  assert.match(directInsertButton.getAttribute("aria-label"), /直接插入提示词/u);
  const directInsertIcon = directInsertButton.querySelector("svg");
  assert.ok(directInsertIcon);
  assert.equal(
    directInsertIcon.getAttribute("data-phg-icon"),
    "direct-insert",
  );
  assert.equal(directInsertIcon.getAttribute("aria-hidden"), "true");
  assert.equal(directInsertButton.textContent, "");

  const menuTrigger = card.querySelector('[data-phg-action="menu"]');
  assert.ok(menuTrigger);
  assert.equal(menuTrigger.getAttribute("title"), "更多操作");
  assert.equal(menuTrigger.getAttribute("aria-haspopup"), "menu");
  assert.equal(menuTrigger.getAttribute("aria-expanded"), "false");
  assert.match(menuTrigger.getAttribute("aria-label"), /管理提示词/u);
  assert.equal(
    menuTrigger.querySelector("svg").getAttribute("data-phg-icon"),
    "more",
  );

  documentObject.querySelector('[data-phg-action="insert"]').click();
  await flushTasks();
  assert.deepEqual(controller.insertCalls, ["one"]);

  menuTrigger.click();
  assert.equal(menuTrigger.getAttribute("aria-expanded"), "true");
  documentObject.querySelector('[data-phg-menu-action="edit"]').click();
  const dialog = documentObject.querySelector('[aria-modal="true"]');
  assert.ok(dialog);
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.equal(documentObject.getElementById("phg-prompt-name").value, "代码审查");
  assert.equal(documentObject.getElementById("phg-prompt-body").value, prompt.prompt);
  ui.render({ ...emptyState, prompts: [prompt], busy: true });
  ui.render({ ...emptyState, prompts: [prompt], busy: false });
  ui.closeDialog();
  assert.equal(
    documentObject.activeElement,
    documentObject.querySelector('[data-phg-action="menu"]'),
  );

  documentObject.querySelector('[data-phg-action="menu"]').click();
  documentObject.querySelector('[data-phg-menu-action="delete"]').click();
  assert.match(documentObject.getElementById("phg-dialog-title").textContent, /删除/u);
  assert.equal(
    documentObject.getElementById("phg-dialog").getAttribute("data-phg-kind"),
    "delete",
  );
  documentObject.getElementById("phg-confirm-delete").click();
  await flushTasks();
  assert.deepEqual(controller.deleteCalls, ["one"]);
});

test("slot wizard walks arbitrary parsed fields, preserves answers, and inserts once", async () => {
  const { ui, controller, documentObject } = mountUi();
  const prompt = {
    id: "generic",
    name: "任意提示词",
    prompt: "给【对象】写【语气】内容，再称呼【对象】。",
    placeholder: "【光标】",
  };
  controller.nextSlotPlan = {
    ok: true,
    id: prompt.id,
    name: prompt.name,
    prompt: prompt.prompt,
    slots: [
      {
        key: "对象",
        label: "对象",
        displayLabel: "对象",
        token: "【对象】",
        count: 2,
        context: "给【对象】写【语气】内容",
      },
      {
        key: "语气",
        label: "语气",
        displayLabel: "语气",
        token: "【语气】",
        count: 1,
        context: "给【对象】写【语气】内容",
      },
    ],
  };
  ui.render({ ...emptyState, prompts: [prompt] });

  const insertButton = documentObject.querySelector('[data-phg-action="insert"]');
  insertButton.click();

  const dialog = documentObject.getElementById("phg-dialog");
  assert.equal(dialog.getAttribute("data-phg-kind"), "slot-wizard");
  assert.deepEqual(controller.slotPlanCalls, ["generic"]);
  assert.deepEqual(controller.insertCalls, []);
  assert.match(documentObject.getElementById("phg-slot-progress").textContent, /1 \/ 2/u);
  assert.match(documentObject.getElementById("phg-slot-question").textContent, /对象/u);
  assert.match(documentObject.getElementById("phg-slot-occurrence").textContent, /出现 2 次/u);
  const input = documentObject.getElementById("phg-slot-value");
  assert.equal(documentObject.activeElement, input);

  input.value = "开发者";
  input.dispatchEvent(
    new FakeEvent("keydown", { key: "Enter", bubbles: true }),
  );
  assert.match(documentObject.getElementById("phg-slot-question").textContent, /对象/u);
  input.dispatchEvent(
    new FakeEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
    }),
  );
  assert.match(documentObject.getElementById("phg-slot-question").textContent, /语气/u);
  assert.match(documentObject.getElementById("phg-slot-progress").textContent, /已填写 1 项/u);
  input.value = "简洁";
  documentObject.getElementById("phg-slot-back").click();
  assert.equal(input.value, "开发者");
  documentObject.getElementById("phg-slot-next").click();
  assert.equal(input.value, "简洁");
  assert.equal(documentObject.getElementById("phg-slot-next").textContent, "插入提示词");
  documentObject.getElementById("phg-slot-next").click();
  await flushTasks();

  assert.deepEqual(controller.insertCalls, ["generic"]);
  assert.equal(controller.insertOptionCalls[0].expectedPrompt, prompt.prompt);
  assert.deepEqual(
    Array.from(controller.insertOptionCalls[0].slotValues.entries()),
    [
      ["对象", "开发者"],
      ["语气", "简洁"],
    ],
  );
  assert.equal(documentObject.getElementById("phg-dialog-layer"), null);
});

test("closing the slot wizard does not leave pointer-restored card focus styling active", () => {
  const { ui, controller, documentObject } = mountUi();
  const prompt = {
    id: "generic",
    name: "任意提示词",
    prompt: "处理【内容】",
    placeholder: "【光标】",
  };
  controller.nextSlotPlan = {
    ok: true,
    prompt: prompt.prompt,
    slots: [{ key: "内容", label: "内容", token: "【内容】", count: 1 }],
  };
  ui.render({ ...emptyState, prompts: [prompt] });
  const insertButton = documentObject.querySelector('[data-phg-action="insert"]');

  insertButton.click();
  documentObject.getElementById("phg-close-slot-wizard").click();

  assert.equal(documentObject.getElementById("phg-dialog-layer"), null);
  assert.equal(documentObject.activeElement, insertButton);

  const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");
  assert.doesNotMatch(css, /\.phg-prompt-card:focus-within/u);
  assert.match(css, /\.phg-prompt-card:has\(:focus-visible\)/u);
});

test("slot wizard can bypass filling and retains input after insertion failure", async () => {
  const { ui, controller, documentObject } = mountUi();
  const prompt = {
    id: "generic",
    name: "任意提示词",
    prompt: "处理【内容】",
    placeholder: "【光标】",
  };
  controller.nextSlotPlan = {
    ok: true,
    prompt: prompt.prompt,
    slots: [{ key: "内容", label: "内容", token: "【内容】", count: 1 }],
  };
  ui.render({ ...emptyState, prompts: [prompt] });
  const insertButton = documentObject.querySelector('[data-phg-action="insert"]');

  insertButton.click();
  documentObject.getElementById("phg-slot-direct-insert").click();
  await flushTasks();
  assert.deepEqual(controller.insertCalls, ["generic"]);
  assert.deepEqual(controller.insertOptionCalls[0], {
    expectedPrompt: prompt.prompt,
  });

  controller.nextInsertResult = { ok: false, code: "EDITOR_NOT_FOUND" };
  insertButton.click();
  const input = documentObject.getElementById("phg-slot-value");
  input.value = "不会丢失";
  documentObject.getElementById("phg-slot-next").click();
  await flushTasks();
  assert.ok(documentObject.getElementById("phg-dialog-layer"));
  assert.equal(documentObject.getElementById("phg-slot-value").value, "不会丢失");
  assert.equal(documentObject.getElementById("phg-slot-next").disabled, false);
});

test("every prompt card exposes the same explicit direct-insert action", async () => {
  const { ui, controller, documentObject } = mountUi();
  const prompts = [
    {
      id: "with-slots",
      name: "带填写项",
      prompt: "处理【内容】",
      placeholder: "【光标】",
    },
    {
      id: "plain",
      name: "普通提示词",
      prompt: "直接处理内容",
      placeholder: "【光标】",
    },
  ];
  controller.nextSlotPlan = {
    ok: true,
    prompt: prompts[0].prompt,
    slots: [{ key: "内容", label: "内容", token: "【内容】", count: 1 }],
  };
  ui.render({ ...emptyState, prompts });

  const directButtons = documentObject.querySelectorAll(
    '[data-phg-action="direct-insert"]',
  );
  assert.equal(directButtons.length, 2);
  assert.deepEqual(
    directButtons.map((button) => button.getAttribute("data-phg-id")),
    ["with-slots", "plain"],
  );
  assert.match(directButtons[0].getAttribute("aria-label"), /带填写项/u);
  assert.match(directButtons[1].getAttribute("aria-label"), /普通提示词/u);

  directButtons[0].dispatchEvent(
    new FakeEvent("pointerdown", {
      pointerId: 27,
      pointerType: "mouse",
      button: 0,
      clientX: 280,
      clientY: 20,
      bubbles: true,
    }),
  );
  documentObject.getElementById("phg-prompt-list").dispatchEvent(
    new FakeEvent("pointermove", {
      pointerId: 27,
      clientX: 280,
      clientY: 150,
      bubbles: true,
    }),
  );
  documentObject.getElementById("phg-prompt-list").dispatchEvent(
    new FakeEvent("pointerup", {
      pointerId: 27,
      clientX: 280,
      clientY: 150,
      bubbles: true,
    }),
  );
  directButtons[0].click();
  await flushTasks();

  assert.deepEqual(controller.reorderCalls, []);
  assert.deepEqual(controller.slotPlanCalls, []);
  assert.deepEqual(controller.insertCalls, ["with-slots"]);
  assert.deepEqual(controller.insertOptionCalls, [{}]);
  assert.equal(documentObject.getElementById("phg-dialog-layer"), null);

  documentObject
    .querySelector('[data-phg-action="insert"]')
    .click();

  assert.deepEqual(controller.slotPlanCalls, ["with-slots"]);
  assert.equal(
    documentObject.getElementById("phg-dialog").getAttribute("data-phg-kind"),
    "slot-wizard",
  );
});

test("prompt rows use the two-line card anatomy without extra chrome", () => {
  const { ui, documentObject } = mountUi();
  ui.render({
    ...emptyState,
    prompts: [
      { id: "one", name: "示例说明", prompt: "请检查这段说明：【光标】。", placeholder: "" },
    ],
  });
  const card = documentObject.querySelector(".phg-prompt-card");
  const main = card.querySelector(".phg-card-main");

  assert.equal(
    card.querySelector(".phg-card-tile"),
    null,
    "no leading avatar tile on prompt rows",
  );
  assert.equal(
    card.querySelector(".phg-card-chip"),
    null,
    "no placeholder chip on prompt rows",
  );
  assert.equal(
    card.querySelector(".phg-card-detail"),
    null,
    "preview is always visible, not collapsible",
  );

  const name = main.querySelector(".phg-card-name");
  const preview = main.querySelector(".phg-card-preview");
  assert.equal(name.textContent, "示例说明");
  assert.match(preview.textContent, /请检查这段说明/u);
});

test("panel search filters cards by name and body without changing stored order", () => {
  const { ui, documentObject } = mountUi();
  const prompts = [
    { id: "a", name: "晨间回顾", prompt: "逐项清单", placeholder: "" },
    { id: "b", name: "清单改写", prompt: "口语和书面", placeholder: "" },
    { id: "c", name: "来源核对", prompt: "核对依据是否充分", placeholder: "" },
  ];
  ui.render({ ...emptyState, prompts });
  const search = documentObject.getElementById("phg-search");
  const count = documentObject.getElementById("phg-list-count");
  const noMatch = documentObject.getElementById("phg-no-match");
  const cards = () => Array.from(documentObject.querySelectorAll(".phg-prompt-card"));
  const cardState = () =>
    cards().map((card) => ({
      id: card.getAttribute("data-phg-record-id"),
      hidden: card.hidden,
    }));

  assert.equal(count.textContent, "· 3");
  assert.equal(noMatch.hidden, true);

  search.value = "改";
  search.dispatchEvent(new FakeEvent("input", {}));
  assert.deepEqual(cardState(), [
    { id: "b", hidden: false },
    { id: "a", hidden: true },
    { id: "c", hidden: true },
  ]);
  assert.equal(count.textContent, "· 1");
  assert.equal(noMatch.hidden, true);

  search.value = "依据";
  search.dispatchEvent(new FakeEvent("input", {}));
  assert.deepEqual(cardState(), [
    { id: "c", hidden: false },
    { id: "a", hidden: true },
    { id: "b", hidden: true },
  ]);

  search.value = "单";
  search.dispatchEvent(new FakeEvent("input", {}));
  assert.deepEqual(cardState(), [
    { id: "b", hidden: false },
    { id: "a", hidden: false },
    { id: "c", hidden: true },
  ]);

  search.value = "不存在";
  search.dispatchEvent(new FakeEvent("input", {}));
  assert.deepEqual(
    cards().map((card) => card.hidden),
    [true, true, true],
  );
  assert.equal(count.textContent, "· 0");
  assert.equal(noMatch.hidden, false);

  search.value = "  ";
  search.dispatchEvent(new FakeEvent("input", {}));
  assert.deepEqual(cardState(), [
    { id: "a", hidden: false },
    { id: "b", hidden: false },
    { id: "c", hidden: false },
  ]);
  assert.equal(count.textContent, "· 3");
  assert.equal(noMatch.hidden, true);
  assert.deepEqual(
    ui._state.prompts.map((record) => record.id),
    ["a", "b", "c"],
  );

  ui.render({ ...emptyState, prompts: prompts.slice(0, 1) });
  assert.equal(count.textContent, "· 1");
});

test("filtered search does not reorder from handle drag, body drag, or arrow keys", async () => {
  const { ui, controller, documentObject } = mountUi();
  const prompts = [
    { id: "a", name: "晨间回顾", prompt: "逐项清单" },
    { id: "b", name: "清单改写", prompt: "口语和书面" },
    { id: "c", name: "来源核对", prompt: "核对依据是否充分" },
  ];
  ui.render({ ...emptyState, prompts });
  const search = documentObject.getElementById("phg-search");
  search.value = "改";
  search.dispatchEvent(new FakeEvent("input", {}));
  const cards = Array.from(documentObject.querySelectorAll(".phg-prompt-card"));
  const visible = cards.find((card) => !card.hidden);
  const handle = visible.querySelector('[data-phg-action="reorder"]');
  const main = visible.querySelector('[data-phg-action="insert"]');
  const list = documentObject.getElementById("phg-prompt-list");

  assert.equal(handle.disabled, true);

  handle.dispatchEvent(
    new FakeEvent("pointerdown", {
      pointerId: 31,
      clientX: 20,
      clientY: 20,
      button: 0,
      bubbles: true,
    }),
  );
  list.dispatchEvent(
    new FakeEvent("pointermove", {
      pointerId: 31,
      clientX: 20,
      clientY: 180,
      bubbles: true,
    }),
  );
  list.dispatchEvent(
    new FakeEvent("pointerup", {
      pointerId: 31,
      clientX: 20,
      clientY: 180,
      bubbles: true,
    }),
  );

  main.dispatchEvent(
    new FakeEvent("pointerdown", {
      pointerId: 32,
      clientX: 40,
      clientY: 20,
      button: 0,
      pointerType: "mouse",
      bubbles: true,
    }),
  );
  list.dispatchEvent(
    new FakeEvent("pointermove", {
      pointerId: 32,
      clientX: 40,
      clientY: 180,
      bubbles: true,
    }),
  );
  list.dispatchEvent(
    new FakeEvent("pointerup", {
      pointerId: 32,
      clientX: 40,
      clientY: 180,
      bubbles: true,
    }),
  );

  handle.dispatchEvent(
    new FakeEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  await flushTasks();

  assert.deepEqual(controller.reorderCalls, []);
  assert.equal(list.getAttribute("data-phg-reordering"), null);
  assert.deepEqual(
    ui._state.prompts.map((record) => record.id),
    ["a", "b", "c"],
  );
});

test("dragging a prompt handle past the threshold reorders without inserting", async () => {
  const { ui, controller, documentObject } = mountUi();
  const prompts = [
    { id: "a", name: "甲", prompt: "一" },
    { id: "b", name: "乙", prompt: "二" },
    { id: "c", name: "丙", prompt: "三" },
  ];
  ui.render({ ...emptyState, prompts });
  const handle = documentObject.querySelector('[data-phg-action="reorder"]');

  handle.dispatchEvent(
    new FakeEvent("pointerdown", {
      pointerId: 11,
      clientX: 20,
      clientY: 20,
      button: 0,
      bubbles: true,
    }),
  );
  documentObject.getElementById("phg-prompt-list").dispatchEvent(
    new FakeEvent("pointermove", {
      pointerId: 11,
      clientX: 20,
      clientY: 180,
      bubbles: true,
    }),
  );
  const cards = documentObject.querySelectorAll(".phg-prompt-card");
  assert.equal(
    documentObject.getElementById("phg-prompt-list").getAttribute("data-phg-reordering"),
    "true",
  );
  assert.equal(cards[0].style.transform, "translate3d(0, 142px, 0)");
  assert.equal(cards[1].style.transform, "translate3d(0, -71px, 0)");
  assert.equal(cards[2].style.transform, "translate3d(0, -71px, 0)");
  documentObject.getElementById("phg-prompt-list").dispatchEvent(
    new FakeEvent("pointermove", {
      pointerId: 11,
      clientX: 20,
      clientY: 800,
      bubbles: true,
    }),
  );
  assert.equal(cards[0].style.transform, "translate3d(0, 142px, 0)");
  documentObject.getElementById("phg-prompt-list").dispatchEvent(
    new FakeEvent("pointerup", {
      pointerId: 11,
      clientX: 20,
      clientY: 180,
      bubbles: true,
    }),
  );
  await flushTasks();

  assert.deepEqual(controller.reorderCalls, [["b", "c", "a"]]);
  assert.deepEqual(controller.insertCalls, []);
  assert.equal(
    documentObject.getElementById("phg-prompt-list").getAttribute("data-phg-reordering"),
    null,
  );
  assert.equal(cards[0].style.transform, "");
});

test("dragging a prompt card body reorders and suppresses the following insert click", async () => {
  const { ui, controller, documentObject } = mountUi();
  ui.render({
    ...emptyState,
    prompts: [
      { id: "a", name: "甲", prompt: "一" },
      { id: "b", name: "乙", prompt: "二" },
      { id: "c", name: "丙", prompt: "三" },
    ],
  });
  const main = documentObject.querySelector('[data-phg-action="insert"]');
  main.dispatchEvent(
    new FakeEvent("pointerdown", {
      pointerId: 13,
      clientX: 40,
      clientY: 20,
      button: 0,
      pointerType: "mouse",
      bubbles: true,
    }),
  );
  documentObject.getElementById("phg-prompt-list").dispatchEvent(
    new FakeEvent("pointermove", {
      pointerId: 13,
      clientX: 40,
      clientY: 180,
      bubbles: true,
    }),
  );
  documentObject.getElementById("phg-prompt-list").dispatchEvent(
    new FakeEvent("pointerup", {
      pointerId: 13,
      clientX: 40,
      clientY: 180,
      bubbles: true,
    }),
  );
  main.click();
  await flushTasks();

  assert.deepEqual(controller.reorderCalls, [["b", "c", "a"]]);
  assert.deepEqual(controller.insertCalls, []);
});

test("touch pointers on a prompt body do not start reordering", async () => {
  const { ui, controller, documentObject } = mountUi();
  ui.render({
    ...emptyState,
    prompts: [
      { id: "a", name: "甲", prompt: "一" },
      { id: "b", name: "乙", prompt: "二" },
    ],
  });
  const main = documentObject.querySelector('[data-phg-action="insert"]');
  main.dispatchEvent(
    new FakeEvent("pointerdown", {
      pointerId: 14,
      clientX: 40,
      clientY: 20,
      button: 0,
      pointerType: "touch",
      bubbles: true,
    }),
  );
  documentObject.getElementById("phg-prompt-list").dispatchEvent(
    new FakeEvent("pointermove", {
      pointerId: 14,
      clientX: 40,
      clientY: 180,
      bubbles: true,
    }),
  );
  documentObject.getElementById("phg-prompt-list").dispatchEvent(
    new FakeEvent("pointerup", {
      pointerId: 14,
      clientX: 40,
      clientY: 180,
      bubbles: true,
    }),
  );
  await flushTasks();

  assert.deepEqual(controller.reorderCalls, []);
  assert.equal(
    documentObject.getElementById("phg-prompt-list").getAttribute("data-phg-reordering"),
    null,
  );
});

test("a sub-threshold pointer gesture on a card still inserts", async () => {
  const { ui, controller, documentObject } = mountUi();
  ui.render({
    ...emptyState,
    prompts: [
      { id: "a", name: "甲", prompt: "一" },
      { id: "b", name: "乙", prompt: "二" },
    ],
  });
  const main = documentObject.querySelector('[data-phg-action="insert"]');
  main.dispatchEvent(
    new FakeEvent("pointerdown", {
      pointerId: 12,
      clientX: 40,
      clientY: 20,
      button: 0,
      pointerType: "mouse",
      bubbles: true,
    }),
  );
  documentObject.getElementById("phg-prompt-list").dispatchEvent(
    new FakeEvent("pointermove", {
      pointerId: 12,
      clientX: 42,
      clientY: 22,
      bubbles: true,
    }),
  );
  documentObject.getElementById("phg-prompt-list").dispatchEvent(
    new FakeEvent("pointerup", {
      pointerId: 12,
      clientX: 42,
      clientY: 22,
      bubbles: true,
    }),
  );
  main.click();
  await flushTasks();

  assert.deepEqual(controller.reorderCalls, []);
  assert.deepEqual(controller.insertCalls, ["a"]);
});

test("card pointer capture stays on the insert button so a retargeted click still inserts", async () => {
  const { ui, controller, documentObject } = mountUi();
  ui.render({
    ...emptyState,
    prompts: [
      { id: "a", name: "甲", prompt: "一" },
      { id: "b", name: "乙", prompt: "二" },
    ],
  });
  const main = documentObject.querySelector('[data-phg-action="insert"]');
  const list = documentObject.getElementById("phg-prompt-list");
  main.dispatchEvent(
    new FakeEvent("pointerdown", {
      pointerId: 21,
      clientX: 40,
      clientY: 20,
      button: 0,
      pointerType: "mouse",
      bubbles: true,
    }),
  );

  assert.equal(main.hasPointerCapture(21), true);
  assert.equal(list.hasPointerCapture(21), false);

  const clickTarget = [main, list].find((element) =>
    element.hasPointerCapture(21),
  );
  list.dispatchEvent(
    new FakeEvent("pointermove", {
      pointerId: 21,
      clientX: 41,
      clientY: 21,
      bubbles: true,
    }),
  );
  list.dispatchEvent(
    new FakeEvent("pointerup", {
      pointerId: 21,
      clientX: 41,
      clientY: 21,
      bubbles: true,
    }),
  );
  clickTarget.click();
  await flushTasks();

  assert.deepEqual(controller.reorderCalls, []);
  assert.deepEqual(controller.insertCalls, ["a"]);
});

test("arrow keys on the drag handle move a prompt by one slot", async () => {
  const { ui, controller, documentObject } = mountUi();
  ui.render({
    ...emptyState,
    prompts: [
      { id: "a", name: "甲", prompt: "一" },
      { id: "b", name: "乙", prompt: "二" },
      { id: "c", name: "丙", prompt: "三" },
    ],
  });
  const handle = documentObject.querySelector('[data-phg-action="reorder"]');
  handle.focus();
  handle.dispatchEvent(
    new FakeEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  await flushTasks();

  assert.deepEqual(controller.reorderCalls, [["b", "a", "c"]]);
  assert.deepEqual(controller.insertCalls, []);
});

test("card management menu keeps edit and delete out of the insertion path", async () => {
  const { ui, controller, documentObject } = mountUi();
  ui.render({
    ...emptyState,
    prompts: [{ id: "one", name: "Review", prompt: "Inspect this" }],
  });
  const bubbledActions = [];
  documentObject.body.addEventListener("click", (event) => {
    bubbledActions.push(
      event.target?.closest?.("[data-phg-action]")?.getAttribute("data-phg-action"),
    );
  });

  const insertEvent = new FakeEvent("click", { bubbles: true });
  documentObject
    .querySelector('[data-phg-action="insert"]')
    .dispatchEvent(insertEvent);
  await flushTasks();
  assert.equal(insertEvent.propagationStopped, false);
  assert.deepEqual(bubbledActions, ["insert"]);
  assert.deepEqual(controller.insertCalls, ["one"]);

  const menuTrigger = documentObject.querySelector('[data-phg-action="menu"]');
  const menuEvent = new FakeEvent("click", { bubbles: true });
  menuTrigger.dispatchEvent(menuEvent);
  assert.equal(menuEvent.propagationStopped, true);
  assert.deepEqual(bubbledActions, ["insert"]);
  const menu = documentObject.getElementById("phg-card-menu");
  assert.equal(menu.getAttribute("role"), "menu");
  assert.equal(menuTrigger.getAttribute("aria-expanded"), "true");
  const editItem = menu.querySelector('[data-phg-menu-action="edit"]');
  const deleteItem = menu.querySelector('[data-phg-menu-action="delete"]');
  assert.equal(documentObject.activeElement, editItem);

  editItem.dispatchEvent(
    new FakeEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  assert.equal(documentObject.activeElement, deleteItem);
  deleteItem.dispatchEvent(
    new FakeEvent("keydown", { key: "Escape", bubbles: true }),
  );
  assert.equal(documentObject.getElementById("phg-card-menu"), null);
  assert.equal(documentObject.activeElement, menuTrigger);
  assert.equal(menuTrigger.getAttribute("aria-expanded"), "false");

  menuTrigger.click();
  documentObject.querySelector('[data-phg-menu-action="edit"]').click();
  assert.ok(documentObject.getElementById("phg-prompt-form"));
  assert.deepEqual(bubbledActions, ["insert"]);
  assert.deepEqual(controller.insertCalls, ["one"]);
  ui.closeDialog({ restoreFocus: false });

  menuTrigger.click();
  documentObject.querySelector('[data-phg-menu-action="delete"]').click();
  assert.equal(
    documentObject.getElementById("phg-dialog").getAttribute("data-phg-kind"),
    "delete",
  );
  assert.deepEqual(bubbledActions, ["insert"]);
  assert.deepEqual(controller.insertCalls, ["one"]);
});

test("card management menu closes on surrounding panel activity", () => {
  const { ui, documentObject } = mountUi();
  const prompt = { id: "one", name: "甲", prompt: "处理内容" };
  ui.render({ ...emptyState, prompts: [prompt] });
  ui.openPanel();
  const menuTrigger = documentObject.querySelector('[data-phg-action="menu"]');
  const openMenu = () => {
    menuTrigger.click();
    const menu = documentObject.getElementById("phg-card-menu");
    assert.ok(menu);
    assert.match(menu.style.left, /^\d+(?:\.\d+)?px$/u);
    assert.match(menu.style.top, /^\d+(?:\.\d+)?px$/u);
    const cardRect = menuTrigger.closest(".phg-prompt-card").getBoundingClientRect();
    const menuTop = Number.parseFloat(menu.style.top);
    if (menu.getAttribute("data-phg-placement") === "below") {
      assert.equal(menuTop >= cardRect.bottom, true);
    } else {
      assert.equal(menuTop + 106 <= cardRect.top, true);
    }
    return menu;
  };

  openMenu();
  documentObject.getElementById("phg-search").dispatchEvent(
    new FakeEvent("pointerdown", { bubbles: true }),
  );
  assert.equal(documentObject.getElementById("phg-card-menu"), null);
  assert.equal(
    documentObject.getElementById("phg-panel").getAttribute("data-phg-state"),
    "open",
  );

  openMenu();
  documentObject.querySelector(".phg-panel-body").dispatchEvent(
    new FakeEvent("scroll", { bubbles: false }),
  );
  assert.equal(documentObject.getElementById("phg-card-menu"), null);

  openMenu();
  ui.render({ ...emptyState, prompts: [prompt], busy: true });
  assert.equal(documentObject.getElementById("phg-card-menu"), null);
});

test("add/edit dialog uses defaults, history actions, retry retention, and focus restore", async () => {
  const { ui, controller, documentObject } = mountUi();
  ui.render({
    ...emptyState,
    placeholderHistory: ["<最近>", "<旧值>"],
  });
  ui.openPanel();
  const addButton = documentObject.getElementById("phg-add-prompt");
  addButton.focus();
  addButton.click();

  const dialog = documentObject.getElementById("phg-dialog");
  assert.equal(dialog.getAttribute("data-phg-kind"), "prompt");
  assert.ok(dialog.querySelector(".phg-dialog-header"));
  assert.ok(dialog.querySelector(".phg-dialog-body"));
  assert.ok(dialog.querySelector(".phg-dialog-footer"));

  const name = documentObject.getElementById("phg-prompt-name");
  const body = documentObject.getElementById("phg-prompt-body");
  const placeholder = documentObject.getElementById("phg-prompt-placeholder");
  assert.equal(name.required, true);
  assert.equal(placeholder.value, "【光标】");
  assert.equal(documentObject.activeElement, name);
  assert.equal(documentObject.querySelectorAll(".phg-history-row").length, 2);
  assert.match(dialog.querySelector(".phg-field-help").textContent, /优先/u);

  documentObject.querySelector('[data-phg-history-value="<最近>"]').click();
  assert.equal(placeholder.value, "<最近>");
  assert.equal(documentObject.activeElement, placeholder);
  documentObject.querySelector('[data-phg-history-delete="<旧值>"]').click();
  await flushTasks();
  assert.deepEqual(controller.historyDeleteCalls, ["<旧值>"]);

  name.value = "新提示词";
  body.value = "正文";
  controller.nextSaveResult = { ok: false, code: "SAVE_FAILED" };
  documentObject.getElementById("phg-prompt-form").dispatchEvent(
    new FakeEvent("submit", { bubbles: true }),
  );
  await flushTasks();
  assert.ok(documentObject.getElementById("phg-dialog-layer"));
  assert.deepEqual(controller.saveCalls.at(-1), {
    id: undefined,
    name: "新提示词",
    prompt: "正文",
    placeholder: "<最近>",
  });

  controller.nextSaveResult = { ok: true, id: "new" };
  documentObject.getElementById("phg-prompt-form").dispatchEvent(
    new FakeEvent("submit", { bubbles: true }),
  );
  await flushTasks();
  assert.equal(documentObject.getElementById("phg-dialog-layer"), null);
  assert.equal(documentObject.activeElement, addButton);
});

test("settings dialog explains wizard precedence and persists the bracket-processing switch", async () => {
  const { ui, controller, documentObject } = mountUi();
  ui.render({
    ...emptyState,
    autoSelectBracketPlaceholder: false,
  });
  ui.openPanel();
  const settingsButton = documentObject.getElementById("phg-open-settings");
  settingsButton.focus();
  settingsButton.click();

  const dialog = documentObject.getElementById("phg-dialog");
  const checkbox = documentObject.getElementById(
    "phg-auto-select-bracket-placeholder",
  );
  assert.equal(dialog.getAttribute("data-phg-kind"), "settings");
  assert.equal(checkbox.getAttribute("role"), "switch");
  assert.equal(checkbox.checked, false);
  assert.equal(documentObject.activeElement, checkbox);
  assert.match(dialog.querySelector(".phg-setting-note").textContent, /自定义光标/u);
  assert.match(
    dialog.querySelector(".phg-setting-note").textContent,
    /首次出现顺序逐项填写/u,
  );

  checkbox.checked = true;
  controller.nextSettingResult = { ok: false, code: "SAVE_FAILED" };
  documentObject.getElementById("phg-settings-form").dispatchEvent(
    new FakeEvent("submit", { bubbles: true }),
  );
  await flushTasks();
  assert.deepEqual(controller.settingCalls, [true]);
  assert.ok(documentObject.getElementById("phg-dialog-layer"));

  controller.nextSettingResult = { ok: true };
  documentObject.getElementById("phg-settings-form").dispatchEvent(
    new FakeEvent("submit", { bubbles: true }),
  );
  await flushTasks();
  assert.deepEqual(controller.settingCalls, [true, true]);
  assert.equal(documentObject.getElementById("phg-dialog-layer"), null);
  assert.equal(documentObject.activeElement, settingsButton);
});

test("settings update check shows GitHub release link only when a newer version exists", async () => {
  const previousCheck = globalThis.PromptHelper.checkForUpdate;
  globalThis.PromptHelper.checkForUpdate = async () => ({
    status: "available",
    current: "1.0.0",
    latest: "1.1.0",
    htmlUrl:
      "https://github.com/issacsmit/Prompt_Helper_Extension_for_Grok/releases/tag/v1.1.0",
  });
  try {
    const { ui, documentObject } = mountUi();
    ui.render(emptyState);
    ui.openPanel();
    documentObject.getElementById("phg-open-settings").click();

    const checkButton = documentObject.getElementById("phg-check-update");
    const status = documentObject.getElementById("phg-update-status");
    const link = documentObject.getElementById("phg-open-release");
    assert.ok(checkButton);
    assert.equal(status.hidden, true);
    assert.equal(link.hidden, true);
    checkButton.click();
    await flushTasks();

    assert.match(status.textContent, /发现新版本 v1\.1\.0/u);
    assert.equal(link.hidden, false);
    assert.equal(
      link.getAttribute("href"),
      "https://github.com/issacsmit/Prompt_Helper_Extension_for_Grok/releases/tag/v1.1.0",
    );
    assert.match(
      documentObject.getElementById("phg-update-howto").textContent,
      /重新加载/u,
    );
  } finally {
    globalThis.PromptHelper.checkForUpdate = previousCheck;
  }
});

test("dialogs trap focus, Escape closes by layer, and status is visibly announced", () => {
  const { ui, documentObject } = mountUi();
  ui.render(emptyState);
  ui.openPanel();
  const addButton = documentObject.getElementById("phg-add-prompt");
  addButton.click();

  const dialog = documentObject.querySelector('[aria-modal="true"]');
  const focusables = dialog.querySelectorAll(
    'button,input,textarea,select,[tabindex]:not([tabindex="-1"])',
  ).filter((element) => !element.disabled && !element.hidden);
  focusables.at(-1).focus();
  dialog.dispatchEvent(new FakeEvent("keydown", { key: "Tab", bubbles: true }));
  assert.equal(documentObject.activeElement, focusables[0]);
  focusables[0].focus();
  dialog.dispatchEvent(
    new FakeEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
  );
  assert.equal(documentObject.activeElement, focusables.at(-1));

  dialog.dispatchEvent(new FakeEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(documentObject.getElementById("phg-dialog-layer"), null);
  assert.equal(documentObject.activeElement, addButton);
  documentObject.getElementById("phg-launcher").dispatchEvent(
    new FakeEvent("keydown", { key: "Escape", bubbles: true }),
  );
  assert.equal(
    documentObject.getElementById("phg-panel").getAttribute("data-phg-state"),
    "closed",
  );
  assert.equal(documentObject.activeElement, documentObject.getElementById("phg-launcher"));

  ui.showStatus("保存失败，请重试。", "error");
  const status = documentObject.getElementById("phg-status");
  assert.equal(status.hidden, false);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.textContent, "保存失败，请重试。");
  assert.equal(status.getAttribute("data-phg-kind"), "error");
});

test("pointer drag captures bookmark, persists clamped coordinates, and suppresses toggle", async () => {
  const { ui, controller, documentObject } = mountUi();
  ui.render(emptyState);
  const launcher = documentObject.getElementById("phg-launcher");
  launcher.dispatchEvent(
    new FakeEvent("pointerdown", {
      pointerId: 7,
      clientX: 850,
      clientY: 650,
      button: 0,
      bubbles: true,
    }),
  );
  launcher.dispatchEvent(
    new FakeEvent("pointermove", {
      pointerId: 7,
      clientX: 700,
      clientY: 500,
      bubbles: true,
    }),
  );
  assert.equal(launcher.getAttribute("data-phg-dragging"), "true");
  launcher.dispatchEvent(
    new FakeEvent("pointerup", {
      pointerId: 7,
      clientX: 700,
      clientY: 500,
      bubbles: true,
    }),
  );
  launcher.click();
  await flushTasks();

  assert.equal(controller.bookmarkCalls >= 1, true);
  assert.equal(controller.positionCalls.length, 1);
  assert.deepEqual(controller.positionCalls[0], {
    left: Number.parseFloat(launcher.style.left),
    top: Number.parseFloat(launcher.style.top),
  });
  assert.equal(
    documentObject.getElementById("phg-panel").getAttribute("data-phg-state"),
    "closed",
  );
  assert.equal(launcher.hasPointerCapture(7), false);
  assert.equal(launcher.getAttribute("data-phg-dragging"), null);

  launcher.click();
  assert.equal(
    documentObject.getElementById("phg-panel").getAttribute("data-phg-state"),
    "open",
  );
});

test("visible status stays anchored and clamped while the launcher moves", () => {
  const { ui, documentObject } = mountUi();
  ui.render(emptyState);
  const launcher = documentObject.getElementById("phg-launcher");
  launcher.focus();

  ui.showStatus("保存失败，请重试。", "error");
  const status = documentObject.getElementById("phg-status");
  assert.equal(Number.isFinite(Number.parseFloat(status.style.left)), true);
  assert.equal(Number.isFinite(Number.parseFloat(status.style.top)), true);
  assert.equal(documentObject.activeElement, launcher);
  const initialStatusPosition = {
    left: status.style.left,
    top: status.style.top,
  };

  launcher.dispatchEvent(
    new FakeEvent("pointerdown", {
      pointerId: 8,
      clientX: 850,
      clientY: 650,
      button: 0,
      bubbles: true,
    }),
  );
  launcher.dispatchEvent(
    new FakeEvent("pointermove", {
      pointerId: 8,
      clientX: 700,
      clientY: 500,
      bubbles: true,
    }),
  );
  launcher.dispatchEvent(
    new FakeEvent("pointerup", {
      pointerId: 8,
      clientX: 700,
      clientY: 500,
      bubbles: true,
    }),
  );

  const statusRect = status.getBoundingClientRect();
  assert.notDeepEqual(
    { left: status.style.left, top: status.style.top },
    initialStatusPosition,
  );
  assert.equal(statusRect.left >= 12, true);
  assert.equal(statusRect.top >= 12, true);
  assert.equal(statusRect.right <= 900 - 12, true);
  assert.equal(statusRect.bottom <= 700 - 12, true);
  assert.equal(documentObject.activeElement, launcher);
});

test("outside pointerdown closes only the panel layer and destroy removes the listener", () => {
  const { ui, documentObject } = mountUi();
  ui.render(emptyState);
  ui.openPanel();

  documentObject.body.dispatchEvent(
    new FakeEvent("pointerdown", { bubbles: true }),
  );
  assert.equal(
    documentObject.getElementById("phg-panel").getAttribute("data-phg-state"),
    "closed",
  );

  ui.openPanel();
  documentObject.getElementById("phg-add-prompt").click();
  documentObject.body.dispatchEvent(
    new FakeEvent("pointerdown", { bubbles: true }),
  );
  assert.equal(
    documentObject.getElementById("phg-panel").getAttribute("data-phg-state"),
    "open",
  );
  assert.ok(documentObject.getElementById("phg-dialog-layer"));

  const listenerCount = (documentObject._listeners.get("pointerdown") || []).length;
  assert.equal(listenerCount, 1);
  ui.destroy();
  assert.equal((documentObject._listeners.get("pointerdown") || []).length, 0);
});

test("content stylesheet encodes the monochrome ink visuals and interaction states", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");

  assert.match(css, /--phg-panel:\s*#151619/u);
  assert.match(css, /--phg-card:\s*#1c1d21/u);
  assert.match(css, /--phg-accent-start:\s*#26272d/u);
  assert.match(css, /--phg-accent-end:\s*#060608/u);
  assert.match(css, /linear-gradient\(145deg,\s*var\(--phg-accent-start\)/u);
  assert.match(
    css,
    /#phg-root \.phg-launcher\s*\{[\s\S]*?width:\s*50px;[\s\S]*?height:\s*52px;[\s\S]*?border-radius:\s*13px;/u,
  );
  assert.doesNotMatch(
    css,
    /#phg-root \.phg-launcher\s*\{[^}]*border-radius:\s*50%;/u,
  );
  assert.match(
    css,
    /\.phg-launcher-mark svg\s*\{[\s\S]*?width:\s*50px;[\s\S]*?height:\s*52px;/u,
  );
  assert.match(css, /\.phg-launcher::before/u);
  assert.match(css, /translate3d\(0,\s*-3px,\s*0\)\s*scale\(1\.035\)/u);
  assert.match(css, /\.phg-panel\[data-phg-state="open"\]/u);
  assert.match(css, /cubic-bezier\(\.16,\s*1,\s*\.3,\s*1\)/u);
  assert.match(css, /nth-child\(1\)[\s\S]*55ms/u);
  assert.match(css, /nth-child\(2\)[\s\S]*82ms/u);
  assert.match(css, /nth-child\(3\)[\s\S]*109ms/u);
  assert.match(css, /\.phg-prompt-card:hover[\s\S]*\.phg-card-menu-trigger/u);
  assert.match(
    css,
    /\.phg-prompt-card:has\(:focus-visible\)[\s\S]*\.phg-card-menu-trigger/u,
  );
  assert.match(css, /grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto/u);
  assert.match(css, /\.phg-card-drag\s*\{[^}]*cursor:\s*grab/su);
  assert.match(css, /\.phg-card-drag-orbit\s*\{[^}]*stroke:\s*currentColor;/su);
  assert.doesNotMatch(css, /\.phg-prompt-card::before/u);
  assert.match(css, /@keyframes phg-card-orbit-draw/u);
  assert.match(
    css,
    /\.phg-card-drag-orbit\s*\{[^}]*stroke-dasharray:\s*38\.3;/su,
  );
  assert.match(
    css,
    /\.phg-prompt-card:hover \.phg-card-drag-orbit,[\s\S]*?\.phg-prompt-card\[data-phg-dragging="true"\] \.phg-card-drag-orbit\s*\{[^}]*animation:\s*phg-card-orbit-draw[^;]*\s1;/su,
  );
  assert.match(
    css,
    /\.phg-prompt-card:hover \.phg-card-drag-dot,[\s\S]*?scale\(1\.5\)/u,
  );
  assert.doesNotMatch(css, /phg-card-orbit-dot-glide/u);
  assert.match(css, /\.phg-prompt-card\[data-phg-dragging="true"\]/u);
  assert.match(css, /\.phg-prompt-list\[data-phg-reordering="true"\]/u);
  assert.match(
    css,
    /\.phg-prompt-list\[data-phg-reordering="true"\] \.phg-prompt-card:not\(\[data-phg-dragging="true"\]\)\s*\{[^}]*transition:\s*transform/su,
  );
  assert.match(
    css,
    /\.phg-prompt-card\[data-phg-dragging="true"\]\s*\{[^}]*will-change:\s*transform/su,
  );
  assert.match(css, /@media[^\{]*pointer:\s*coarse/u);
  assert.match(css, /prefers-reduced-motion:\s*reduce/u);
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.phg-card-drag-orbit[\s\S]*?animation:\s*none\s*!important;/u,
  );
  assert.match(css, /html\.dark\s+#phg-root/u);
  assert.match(css, /html\[data-theme="dark"\]\s+#phg-root/u);
  assert.match(css, /html\.light\s+#phg-root/u);
  assert.match(
    css,
    /\.phg-panel-footer \.phg-button-primary\s*\{[^}]*color:\s*var\(--phg-text\);/su,
  );
  assert.doesNotMatch(css, /color:\s*#c9cad1\b/u);
  assert.match(css, /prefers-color-scheme:\s*dark/u);
  assert.match(css, /prefers-color-scheme:\s*light/u);
  assert.match(css, /\.phg-dialog-header/u);
  assert.match(css, /\.phg-dialog-body/u);
  assert.match(css, /\.phg-dialog-footer/u);
  assert.match(css, /\.phg-history-row/u);
  assert.match(css, /\.phg-panel-settings/u);
  assert.match(
    css,
    /\.phg-panel-settings\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center;/su,
  );
  assert.match(css, /\.phg-switch-input:checked \+ \.phg-switch-track/u);
  assert.match(css, /\.phg-switch-input:focus-visible \+ \.phg-switch-track/u);
  assert.match(css, /\.phg-status\[data-phg-kind="error"\]/u);
  assert.match(
    css,
    /html:not\(\.dark\):not\(\[data-theme="dark"\]\)\s+#phg-root/u,
  );
  assert.match(
    css,
    /html:not\(\.light\):not\(\[data-theme="light"\]\)\s+#phg-root/u,
  );
  assert.match(
    css,
    /\.phg-dialog\s*\{[^}]*width:\s*min\(410px,\s*calc\(100vw - 24px\)\)/su,
  );
  assert.match(css, /\.phg-dialog-body\s*\{[^}]*overflow-y:\s*auto/su);
  assert.match(
    css,
    /\.phg-dialog\[data-phg-kind="delete"\][^\{]*\{[^}]*width:/su,
  );
  assert.match(
    css,
    /\.phg-control:focus-visible\s*\{[^}]*box-shadow:[^;]*,[^;]*;/su,
  );
  assert.match(css, /\.phg-history-value\s*\{[^}]*border-radius:\s*999px/su);
  assert.match(css, /\.phg-panel-search\s*\{/u);
  assert.match(css, /\.phg-search-input\s*\{[^}]*border-radius:\s*999px/su);
  assert.match(css, /\.phg-list-heading\s*\{/u);
  assert.match(css, /\.phg-prompt-card\[hidden\]\s*\{\s*display:\s*none;/su);
  assert.match(css, /\.phg-no-match[^\{]*\{/su);
  assert.match(css, /\.phg-visually-hidden\s*\{/su);
  assert.doesNotMatch(css, /\.phg-card-tile\s*\{/u);
  assert.doesNotMatch(css, /\.phg-card-chip\s*\{/u);
  assert.doesNotMatch(css, /\.phg-card-detail\s*\{/u);
  assert.doesNotMatch(css, /\.phg-panel\s*\{[^}]*filter\s*:/u);
  assert.doesNotMatch(css, /(^|\})\s*(?:button|input|textarea|\*)\s*\{/mu);
});

test("explicit theme cascade keeps dark tokens when markers conflict", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");
  const explicitThemeRule =
    /(html\.(?:dark|light)\s+#phg-root,\s*html\[data-theme="(?:dark|light)"\]\s+#phg-root)\s*\{([^}]*)\}/gu;
  const conflictMatches = (selectorList) =>
    selectorList.includes("html.dark #phg-root") ||
    selectorList.includes('html[data-theme="light"] #phg-root');
  const resolvedTokens = {};

  for (const match of css.matchAll(explicitThemeRule)) {
    if (!conflictMatches(match[1])) {
      continue;
    }
    for (const declaration of match[2].matchAll(/(--phg-[\w-]+):\s*([^;]+);/gu)) {
      resolvedTokens[declaration[1]] = declaration[2].trim();
    }
  }

  assert.equal(
    resolvedTokens["--phg-page"],
    "#0d0e10",
    "dark must win when html.dark conflicts with data-theme=light",
  );
});

test("primary button gradient tokens meet WCAG contrast with white text", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");
  const rootTokens = /#phg-root\s*\{([^}]*)\}/u.exec(css)?.[1] || "";
  const relativeLuminance = (hexColor) => {
    const channels = hexColor
      .slice(1)
      .match(/.{2}/gu)
      .map((channel) => Number.parseInt(channel, 16) / 255)
      .map((channel) =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const whiteLuminance = relativeLuminance("#ffffff");

  for (const token of ["accent-start", "accent-mid", "accent-end"]) {
    const value = new RegExp(`--phg-${token}:\\s*(#[0-9a-f]{6});`, "iu").exec(
      rootTokens,
    )?.[1];
    assert.ok(value, `--phg-${token} must be a six-digit hex color`);
    const contrast = (whiteLuminance + 0.05) / (relativeLuminance(value) + 0.05);
    assert.ok(
      contrast >= 4.5,
      `--phg-${token} ${value} has ${contrast.toFixed(2)}:1 contrast with white`,
    );
  }
});

test("card action icons use theme-aware surfaces without the light-theme black block", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");

  for (const token of [
    "action-bg",
    "action-bg-hover",
    "action-border",
    "action-icon",
    "danger-bg",
    "danger-bg-hover",
    "danger-border",
    "danger-icon",
  ]) {
    assert.match(css, new RegExp(`--phg-${token}:`, "u"), token);
  }
  assert.match(
    css,
    /#phg-root\s*\{[^}]*--phg-action-bg:\s*#202127;[^}]*--phg-danger-icon:\s*#ffaaa7;/su,
  );
  assert.match(
    css,
    /html\.light\s+#phg-root,\s*html\[data-theme="light"\]\s+#phg-root\s*\{[^}]*--phg-action-bg:\s*#f2f2f1;[^}]*--phg-danger-icon:\s*#b42318;/su,
  );
  assert.match(
    css,
    /@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*html:not\(\.dark\):not\(\[data-theme="dark"\]\)\s+#phg-root\s*\{[^}]*--phg-action-bg:\s*#f2f2f1;[^}]*--phg-danger-icon:\s*#b42318;/su,
  );
  assert.match(
    css,
    /\.phg-card-action\s*\{[^}]*background:\s*var\(--phg-action-bg\);[^}]*color:\s*var\(--phg-action-icon\);/su,
  );
  assert.doesNotMatch(
    css,
    /\.phg-card-action\s*\{[^}]*background:\s*#202126;/su,
  );
  assert.match(
    css,
    /\.phg-card-action-direct-insert\s*\{[^}]*width:\s*44px;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;/su,
  );
  assert.match(
    css,
    /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)[\s\S]*?\.phg-card-menu-trigger\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/su,
  );
  assert.doesNotMatch(
    css,
    /#phg-root \.phg-card-actions\s*\{[^}]*opacity:\s*0;/su,
  );
  assert.match(
    css,
    /@media\s*\(hover:\s*none\),\s*\(pointer:\s*coarse\)[\s\S]*?\.phg-card-menu-trigger\s*\{[^}]*position:\s*static;[^}]*width:\s*44px;[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/su,
  );
  assert.match(
    css,
    /\.phg-card-name\s*\{[^}]*padding-right:\s*4px;/su,
  );
  assert.match(
    css,
    /\.phg-card-menu\s*\{[^}]*position:\s*fixed;[^}]*width:\s*156px;[^}]*pointer-events:\s*auto;/su,
  );
  assert.doesNotMatch(css, /\.phg-card-management-actions/u);
});

test("both themes provide semantic chrome and shadow tokens", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");
  const tokens = [
    "divider",
    "header-surface",
    "footer-surface",
    "icon-muted",
    "add-bg",
    "add-border",
    "add-icon",
    "focus-ring",
    "launcher-shadow",
    "launcher-shadow-hover",
    "panel-shadow",
    "status-shadow",
    "dialog-shadow",
  ];

  for (const token of tokens) {
    assert.match(css, new RegExp(`--phg-${token}:`, "u"), token);
  }
  assert.match(
    css,
    /#phg-root\s*\{[^}]*--phg-header-surface:\s*#151619;[^}]*--phg-dialog-shadow:/su,
  );
  assert.match(
    css,
    /html\.light\s+#phg-root,\s*html\[data-theme="light"\]\s+#phg-root\s*\{[^}]*--phg-header-surface:\s*#ffffff;[^}]*--phg-dialog-shadow:/su,
  );
  assert.match(
    css,
    /@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*html:not\(\.dark\):not\(\[data-theme="dark"\]\)\s+#phg-root\s*\{[^}]*--phg-header-surface:\s*#ffffff;[^}]*--phg-dialog-shadow:/su,
  );
  assert.doesNotMatch(
    css,
    /\.phg-panel-header\s*\{[^}]*background:\s*#202126;/su,
  );
  assert.doesNotMatch(css, /\.phg-add-arrow\s*\{[^}]*color:\s*#777985;/su);
  assert.doesNotMatch(css, /\.phg-panel-close\s*\{[^}]*color:\s*#9899a3;/su);
});

test("control focus styling derives its border and shadows from the focus token", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");
  const focusRule = /#phg-root \.phg-control:focus-visible\s*\{([^}]*)\}/u.exec(
    css,
  )?.[1];

  assert.ok(focusRule, "control focus rule must exist");
  assert.match(focusRule, /border-color:[^;]*var\(--phg-focus-ring\)[^;]*;/u);
  assert.match(
    focusRule,
    /box-shadow:[^;]*var\(--phg-focus-ring\)[^;]*var\(--phg-focus-ring\)[^;]*;/su,
  );
  assert.doesNotMatch(focusRule, /rgb\(/u);
});

test("light theme variants use a readable danger token", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");
  const explicitLight = /html\.light\s+#phg-root,\s*html\[data-theme="light"\]\s+#phg-root\s*\{[^}]*--phg-danger:\s*#b42318;/su;
  const systemLight = /@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*html:not\(\.dark\):not\(\[data-theme="dark"\]\)\s+#phg-root\s*\{[^}]*--phg-danger:\s*#b42318;/su;

  assert.equal(
    explicitLight.test(css) && systemLight.test(css),
    true,
    "explicit and system light themes must both override --phg-danger",
  );
});

test("panel placement controls its origin and closed offset toward the launcher", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");
  const expected = [
    ["above", "center bottom", "0, 16px, 0"],
    ["below", "center top", "0, -16px, 0"],
    ["right", "left center", "-16px, 0, 0"],
    ["left", "right center", "16px, 0, 0"],
  ];

  for (const [placement, origin, offset] of expected) {
    const selector = new RegExp(
      `\\.phg-panel\\[data-phg-placement="${placement}"\\]\\s*\\{[^}]*` +
        `transform-origin:\\s*${origin};[^}]*` +
        `transform:\\s*translate3d\\(${offset}\\)\\s*scale\\(\\.955\\);`,
      "su",
    );
    assert.match(css, selector, `${placement} placement must animate toward the launcher`);
  }
});

test("coarse pointers receive 44px dialog and history targets", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");
  const coarse = css.slice(
    css.indexOf("@media (hover: none), (pointer: coarse)"),
    css.indexOf("@media (prefers-reduced-motion: reduce)"),
  );

  for (const selector of [
    "#phg-root .phg-dialog .phg-button",
    "#phg-root .phg-dialog .phg-icon-button",
    "#phg-root .phg-history-value",
    "#phg-root .phg-history-delete",
    "#phg-root .phg-search-input",
  ]) {
    assert.match(
      coarse,
      new RegExp(`${selector.replaceAll(".", "\\.")}[^\\{]*\\{[^}]*min-height:\\s*44px;`, "su"),
      `${selector} must be at least 44px high for coarse pointers`,
    );
  }
  assert.match(
    coarse,
    /\.phg-dialog \.phg-icon-button[^\{]*\{[^}]*min-width:\s*44px;/su,
  );
  assert.match(
    coarse,
    /\.phg-history-delete[^\{]*\{[^}]*min-width:\s*44px;/su,
  );
});

test("primary controls keep 44px targets before pointer-specific overrides", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");

  assert.match(
    css,
    /\.phg-card-drag\s*\{[^}]*width:\s*44px;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/su,
  );
  assert.match(
    css,
    /\.phg-card-action\s*\{[^}]*width:\s*44px;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/su,
  );
  assert.match(
    css,
    /\.phg-card-menu-trigger\s*\{[^}]*width:\s*44px;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/su,
  );
  assert.match(
    css,
    /\.phg-button,[\s\S]*?\.phg-history-delete\s*\{[^}]*min-height:\s*44px;/u,
  );
  assert.match(css, /\.phg-icon-button\s*\{[^}]*min-width:\s*44px;/su);
  assert.match(
    css,
    /\.phg-panel-close,[\s\S]*?\.phg-panel-settings\s*\{[^}]*width:\s*44px;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/u,
  );
  assert.match(css, /\.phg-search-input\s*\{[^}]*min-height:\s*44px;/su);
  assert.match(css, /\.phg-control\s*\{[^}]*min-height:\s*44px;/su);
  assert.match(css, /\.phg-history-value\s*\{[^}]*min-height:\s*44px;/su);
  assert.match(
    css,
    /\.phg-history-delete\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/su,
  );
});

test("an open launcher lifts with a glow while active, drag, and reduced motion override it", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");
  const openRule = /\.phg-launcher\[aria-expanded="true"\]\s*\{[^}]*transform:\s*translate3d\(0,\s*-2px,\s*0\)\s*scale\(1\.02\);[^}]*box-shadow:/su;
  const finePointer = css.slice(
    css.indexOf("@media (hover: hover) and (pointer: fine)"),
    css.indexOf("@media (hover: none), (pointer: coarse)"),
  );
  const reducedMotion = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

  assert.match(css, openRule);
  assert.match(css, /\.phg-launcher\[aria-expanded="true"\]::before\s*\{[^}]*opacity:\s*\.58;/su);
  assert.match(css, /\.phg-launcher\[data-phg-dragging="true"\][^\{]*\{[^}]*scale\(\.97\)/su);
  assert.match(
    finePointer,
    /\.phg-launcher\[data-phg-dragging="true"\]::before\s*\{[^}]*opacity:\s*\.28;[^}]*scale\(\.84\)/su,
  );
  assert.match(reducedMotion, /\.phg-launcher\[aria-expanded="true"\]/u);
  assert.match(reducedMotion, /\.phg-launcher\[data-phg-dragging="true"\]/u);
});
