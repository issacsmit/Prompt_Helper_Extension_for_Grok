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

test("constants expose the supported placeholders through CommonJS and PromptHelper", () => {
  const constants = optionalRequire("../constants.js");

  assert.equal(constants.DEFAULT_PLACEHOLDER, "【光标】");
  assert.equal(constants.LEGACY_PLACEHOLDER, "[光标]");
  assert.equal(constants.DEFAULT_AUTO_SELECT_BRACKET_PLACEHOLDER, true);
  assert.equal(globalThis.PromptHelper?.DEFAULT_PLACEHOLDER, constants.DEFAULT_PLACEHOLDER);
  assert.equal(globalThis.PromptHelper?.LEGACY_PLACEHOLDER, constants.LEGACY_PLACEHOLDER);
});

test("prompt engine exposes its public functions through CommonJS and PromptHelper", () => {
  const engine = optionalRequire("../prompt-engine.js");

  assert.equal(typeof engine.extractPromptSlots, "function");
  assert.equal(typeof engine.prepareInsertion, "function");
  assert.equal(typeof engine.updatePlaceholderHistory, "function");
  assert.equal(globalThis.PromptHelper?.prepareInsertion, engine.prepareInsertion);
  assert.equal(
    globalThis.PromptHelper?.extractPromptSlots,
    engine.extractPromptSlots,
  );
  assert.equal(
    globalThis.PromptHelper?.updatePlaceholderHistory,
    engine.updatePlaceholderHistory,
  );
});

const { DEFAULT_PLACEHOLDER, LEGACY_PLACEHOLDER } = require("../constants.js");
const {
  extractPromptSlots,
  prepareInsertion,
  updatePlaceholderHistory,
} = require("../prompt-engine.js");

test("slot extraction is generic, ordered, deduplicated, and excludes cursor controls", () => {
  const record = {
    prompt:
      "为【 目标 】比较【选项 A】和【选项 B】，最后回到【目标】。" +
      "【光标】并在<落点>结束。",
    placeholder: "<落点>",
  };

  assert.deepEqual(
    extractPromptSlots(record).map(({ key, count, token }) => ({
      key,
      count,
      token,
    })),
    [
      { key: "目标", count: 2, token: "【 目标 】" },
      { key: "选项 A", count: 1, token: "【选项 A】" },
      { key: "选项 B", count: 1, token: "【选项 B】" },
    ],
  );
  assert.match(extractPromptSlots(record)[0].context, /目标/u);
});

test("a bracket-shaped custom cursor is never exposed as a fill slot", () => {
  assert.deepEqual(
    extractPromptSlots({
      prompt: "前【插入点】中【主题】后【插入点】",
      placeholder: "【插入点】",
    }).map((slot) => slot.key),
    ["主题"],
  );
});

test("a custom cursor embedded inside a bracket token keeps cursor priority", () => {
  assert.deepEqual(
    extractPromptSlots({
      prompt: "前【主题】后【风格】",
      placeholder: "主题",
    }).map((slot) => slot.key),
    ["风格"],
  );
});

test("built-in cursor markers embedded in bracket text are not offered as fill slots", () => {
  assert.deepEqual(
    extractPromptSlots({
      prompt: "【说明【光标】位置】和【[光标]】以及【主题】",
    }).map((slot) => slot.key),
    ["主题"],
  );
});

test("very long generic labels keep their full key but expose bounded UI copy", () => {
  const label = "长".repeat(240);
  const [slot] = extractPromptSlots({ prompt: `前文【${label}】后文` });

  assert.equal(slot.key, label);
  assert.ok(slot.displayLabel.length <= 80);
  assert.ok(slot.context.length <= 182);
});

test("record custom placeholder wins even when lower-priority markers occur earlier", () => {
  const content = [
    DEFAULT_PLACEHOLDER,
    LEGACY_PLACEHOLDER,
    "<past>",
    "before<record>after",
  ].join("|");

  assert.deepEqual(
    prepareInsertion({ prompt: content, placeholder: "<record>" }, ["<past>"]),
    {
      text: content.replace("<record>", ""),
      caretOffset: content.indexOf("<record>"),
      matchedPlaceholder: "<record>",
    },
  );
});

test("default placeholder wins over legacy and history candidates", () => {
  const content = `<past>|${LEGACY_PLACEHOLDER}|before${DEFAULT_PLACEHOLDER}after`;

  assert.deepEqual(prepareInsertion({ prompt: content }, ["<past>"]), {
    text: content.replace(DEFAULT_PLACEHOLDER, ""),
    caretOffset: content.indexOf(DEFAULT_PLACEHOLDER),
    matchedPlaceholder: DEFAULT_PLACEHOLDER,
  });
});

test("legacy placeholder wins over history candidates", () => {
  const content = `<past>|before${LEGACY_PLACEHOLDER}after`;

  assert.deepEqual(prepareInsertion({ prompt: content }, ["<past>"]), {
    text: content.replace(LEGACY_PLACEHOLDER, ""),
    caretOffset: content.indexOf(LEGACY_PLACEHOLDER),
    matchedPlaceholder: LEGACY_PLACEHOLDER,
  });
});

test("history supplies a compatibility placeholder after built-in candidates miss", () => {
  const content = "prefix<older>suffix";

  assert.deepEqual(prepareInsertion({ prompt: content }, ["<newer>", "<older>"]), {
    text: "prefixsuffix",
    caretOffset: 6,
    matchedPlaceholder: "<older>",
  });
});

test("only the first occurrence of the selected placeholder is removed", () => {
  const content = `A${DEFAULT_PLACEHOLDER}B${DEFAULT_PLACEHOLDER}C`;

  assert.deepEqual(prepareInsertion({ prompt: content }), {
    text: `AB${DEFAULT_PLACEHOLDER}C`,
    caretOffset: 1,
    matchedPlaceholder: DEFAULT_PLACEHOLDER,
  });
});

test("multiline text is preserved and caret offset points to the removed marker", () => {
  const content = `第一行\n第二行 <slot> 尾部\n第三行`;

  assert.deepEqual(prepareInsertion({ prompt: content, placeholder: "<slot>" }), {
    text: "第一行\n第二行  尾部\n第三行",
    caretOffset: content.indexOf("<slot>"),
    matchedPlaceholder: "<slot>",
  });
});

test("first full-width bracket placeholder stays in the text and becomes the selection", () => {
  const content = "请把【主题】写成【风格】。";

  assert.deepEqual(prepareInsertion({ prompt: content }), {
    text: content,
    caretOffset: content.indexOf("【主题】"),
    selectionEndOffset: content.indexOf("【主题】") + "【主题】".length,
    matchedPlaceholder: "【主题】",
  });
});

test("an explicit custom cursor placeholder wins over bracket auto-selection", () => {
  const content = "先看【主题】，再到<位置>继续";

  assert.deepEqual(
    prepareInsertion({ prompt: content, placeholder: "<位置>" }),
    {
      text: "先看【主题】，再到继续",
      caretOffset: content.indexOf("<位置>"),
      matchedPlaceholder: "<位置>",
    },
  );
});

test("bracket auto-selection wins over history fallback but can be disabled", () => {
  const content = "【主题】后接<旧位置>";

  assert.deepEqual(prepareInsertion({ prompt: content }, ["<旧位置>"]), {
    text: content,
    caretOffset: 0,
    selectionEndOffset: 4,
    matchedPlaceholder: "【主题】",
  });
  assert.deepEqual(
    prepareInsertion(
      { prompt: content },
      ["<旧位置>"],
      { autoSelectBracketPlaceholder: false },
    ),
    {
      text: "【主题】后接",
      caretOffset: content.indexOf("<旧位置>"),
      matchedPlaceholder: "<旧位置>",
    },
  );
});

test("disabling bracket auto-selection leaves unmatched bracket text untouched", () => {
  const content = "请填写【任何内容】";

  assert.deepEqual(
    prepareInsertion(
      { prompt: content },
      [],
      { autoSelectBracketPlaceholder: false },
    ),
    {
      text: content,
      caretOffset: content.length,
      matchedPlaceholder: null,
    },
  );
});

test("slot values replace every same-name occurrence and select the first unresolved slot", () => {
  const content = "给【对象】写一段【风格】文案，并再次称呼【 对象 】。";
  const text = "给开发者写一段【风格】文案，并再次称呼开发者。";

  assert.deepEqual(
    prepareInsertion(
      { prompt: content },
      [],
      { slotValues: new Map([["对象", "开发者"]]) },
    ),
    {
      text,
      caretOffset: text.indexOf("【风格】"),
      selectionEndOffset: text.indexOf("【风格】") + "【风格】".length,
      matchedPlaceholder: "【风格】",
    },
  );
});

test("filled text is never reparsed as a slot or cursor marker", () => {
  const value = "保留【光标】、【不是新槽位】与 <旧位置>";
  const content = "内容：【内容】";
  const expected = `内容：${value}`;

  assert.deepEqual(
    prepareInsertion(
      { prompt: content },
      ["<旧位置>"],
      { slotValues: new Map([["内容", value]]) },
    ),
    {
      text: expected,
      caretOffset: expected.length,
      matchedPlaceholder: null,
    },
  );
});

test("slot replacement remaps a template cursor after variable-length answers", () => {
  assert.deepEqual(
    prepareInsertion(
      { prompt: "【对象】-【光标】-【语气】" },
      [],
      {
        slotValues: new Map([
          ["对象", "开发者团队"],
          ["语气", "简洁"],
        ]),
      },
    ),
    {
      text: "开发者团队--简洁",
      caretOffset: "开发者团队-".length,
      matchedPlaceholder: "【光标】",
    },
  );
});

test("whitespace-only answers remain unresolved instead of deleting template text", () => {
  assert.deepEqual(
    prepareInsertion(
      { prompt: "前【主题】后" },
      [],
      { slotValues: { 主题: "   " } },
    ),
    {
      text: "前【主题】后",
      caretOffset: 1,
      selectionEndOffset: 5,
      matchedPlaceholder: "【主题】",
    },
  );
});

test("text stays unchanged and caret moves to the end when no marker matches", () => {
  const content = "第一行\n第二行";

  assert.deepEqual(prepareInsertion({ prompt: content }, ["<past>"]), {
    text: content,
    caretOffset: content.length,
    matchedPlaceholder: null,
  });
});

test("history keeps the newest occurrence first and removes duplicates", () => {
  assert.deepEqual(
    updatePlaceholderHistory(["<one>", "<two>", "<one>"], "<two>"),
    ["<two>", "<one>"],
  );
});

test("history trims custom markers and excludes empty or built-in markers", () => {
  const history = [
    "  <one>  ",
    "",
    null,
    DEFAULT_PLACEHOLDER,
    "<two>",
    LEGACY_PLACEHOLDER,
    "<one>",
  ];

  assert.deepEqual(updatePlaceholderHistory(history, "  <new>  "), [
    "<new>",
    "<one>",
    "<two>",
  ]);
  assert.deepEqual(updatePlaceholderHistory(history, DEFAULT_PLACEHOLDER), [
    "<one>",
    "<two>",
  ]);
});

test("history retains at most five most-recent custom markers", () => {
  assert.deepEqual(
    updatePlaceholderHistory(["<one>", "<two>", "<three>", "<four>", "<five>"], "<six>"),
    ["<six>", "<one>", "<two>", "<three>", "<four>"],
  );
});
