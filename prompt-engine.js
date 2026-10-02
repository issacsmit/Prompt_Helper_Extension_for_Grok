(function exposePromptEngine(globalObject) {
  "use strict";

  const namespace = globalObject.PromptHelper || {};
  const constants =
    typeof module !== "undefined" && module.exports
      ? require("./constants.js")
      : namespace;
  const DEFAULT_PLACEHOLDER = constants.DEFAULT_PLACEHOLDER || "【光标】";
  const LEGACY_PLACEHOLDER = constants.LEGACY_PLACEHOLDER || "[光标]";
  const MAX_PLACEHOLDER_HISTORY = constants.MAX_PLACEHOLDER_HISTORY || 5;
  const BRACKET_SLOT_PATTERN = /【([\s\S]*?)】/gu;
  const SLOT_LABEL_PREVIEW_LIMIT = 80;
  const SLOT_CONTEXT_SIDE_LENGTH = 36;
  const SLOT_CONTEXT_LIMIT = 180;

  function normalizePlaceholder(value) {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim();
    return normalized || null;
  }

  function isCustomPlaceholder(value) {
    return (
      value !== null &&
      value !== DEFAULT_PLACEHOLDER &&
      value !== LEGACY_PLACEHOLDER
    );
  }

  function normalizeHistory(history) {
    if (!Array.isArray(history)) {
      return [];
    }

    const normalized = [];
    const seen = new Set();

    for (const value of history) {
      const placeholder = normalizePlaceholder(value);
      if (!isCustomPlaceholder(placeholder) || seen.has(placeholder)) {
        continue;
      }

      seen.add(placeholder);
      normalized.push(placeholder);
      if (normalized.length === MAX_PLACEHOLDER_HISTORY) {
        break;
      }
    }

    return normalized;
  }

  function removeFirstPlaceholder(text, placeholder) {
    if (!placeholder) {
      return null;
    }
    const caretOffset = text.indexOf(placeholder);
    if (caretOffset === -1) {
      return null;
    }
    return {
      text:
        text.slice(0, caretOffset) +
        text.slice(caretOffset + placeholder.length),
      caretOffset,
      matchedPlaceholder: placeholder,
    };
  }

  function promptText(record) {
    return record && typeof record.prompt === "string" ? record.prompt : "";
  }

  function bracketLabel(value) {
    if (typeof value !== "string") {
      return null;
    }
    const match = /^【([\s\S]*?)】$/u.exec(value);
    if (!match) {
      return null;
    }
    return match[1].trim() || null;
  }

  function slotDisplayLabel(label) {
    return label.length > SLOT_LABEL_PREVIEW_LIMIT
      ? `${label.slice(0, SLOT_LABEL_PREVIEW_LIMIT - 1)}…`
      : label;
  }

  function slotContext(text, start, end) {
    const contextStart = Math.max(0, start - SLOT_CONTEXT_SIDE_LENGTH);
    const contextEnd = Math.min(text.length, end + SLOT_CONTEXT_SIDE_LENGTH);
    const compact = text
      .slice(contextStart, contextEnd)
      .replace(/\s+/gu, " ")
      .trim();
    const bounded =
      compact.length > SLOT_CONTEXT_LIMIT
        ? `${compact.slice(0, SLOT_CONTEXT_LIMIT - 1)}…`
        : compact;
    return `${contextStart > 0 ? "…" : ""}${bounded}${
      contextEnd < text.length ? "…" : ""
    }`;
  }

  function excludedSlotLabels(record) {
    const labels = new Set();
    for (const placeholder of [DEFAULT_PLACEHOLDER, record?.placeholder]) {
      const label = bracketLabel(normalizePlaceholder(placeholder));
      if (label) {
        labels.add(label);
      }
    }
    return labels;
  }

  function controlPlaceholders(record) {
    const placeholders = new Set();
    for (const value of [record?.placeholder, DEFAULT_PLACEHOLDER, LEGACY_PLACEHOLDER]) {
      const placeholder = normalizePlaceholder(value);
      if (placeholder) {
        placeholders.add(placeholder);
      }
    }
    return placeholders;
  }

  function isFillSlot(token, label, excludedLabels, controlMarkers) {
    if (!label || excludedLabels.has(label)) {
      return false;
    }
    for (const placeholder of controlMarkers) {
      if (token.includes(placeholder)) {
        return false;
      }
    }
    return true;
  }

  function extractPromptSlots(record) {
    const text = promptText(record);
    const excludedLabels = excludedSlotLabels(record);
    const controlMarkers = controlPlaceholders(record);
    const slots = [];
    const slotsByKey = new Map();

    for (const match of text.matchAll(BRACKET_SLOT_PATTERN)) {
      const token = match[0];
      const label = match[1].trim();
      if (!isFillSlot(token, label, excludedLabels, controlMarkers)) {
        continue;
      }
      const existing = slotsByKey.get(label);
      if (existing) {
        existing.count += 1;
        continue;
      }
      const slot = {
        key: label,
        label,
        displayLabel: slotDisplayLabel(label),
        token,
        count: 1,
        context: slotContext(text, match.index, match.index + token.length),
      };
      slotsByKey.set(label, slot);
      slots.push(slot);
    }

    return slots;
  }

  function slotValue(values, key) {
    if (!values) {
      return null;
    }
    try {
      if (
        typeof values.has === "function" &&
        typeof values.get === "function" &&
        values.has(key)
      ) {
        const value = values.get(key);
        return typeof value === "string" && value.trim() ? value : null;
      }
    } catch (_error) {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      const value = values[key];
      return typeof value === "string" && value.trim() ? value : null;
    }
    return null;
  }

  function fillPromptSlots(record, text, values) {
    const excludedLabels = excludedSlotLabels(record);
    const controlMarkers = controlPlaceholders(record);
    const chunks = [];
    const remainingBrackets = [];
    const replacements = [];
    let sourceOffset = 0;
    let outputLength = 0;

    const append = (value) => {
      chunks.push(value);
      outputLength += value.length;
    };

    for (const match of text.matchAll(BRACKET_SLOT_PATTERN)) {
      const token = match[0];
      const start = match.index;
      const end = start + token.length;
      const label = match[1].trim();
      append(text.slice(sourceOffset, start));
      const value = isFillSlot(token, label, excludedLabels, controlMarkers)
        ? slotValue(values, label)
        : null;
      if (value !== null) {
        replacements.push({
          start,
          end,
          outputLength,
          replacementLength: value.length,
        });
        append(value);
      } else {
        const outputStart = outputLength;
        append(token);
        remainingBrackets.push({
          token,
          start: outputStart,
          end: outputLength,
        });
      }
      sourceOffset = end;
    }
    append(text.slice(sourceOffset));

    return {
      text: chunks.join(""),
      remainingBrackets,
      replacements,
      mapOffset(sourceTarget) {
        let delta = 0;
        for (const replacement of replacements) {
          if (sourceTarget <= replacement.start) {
            break;
          }
          if (sourceTarget < replacement.end) {
            return replacement.outputLength;
          }
          delta +=
            replacement.replacementLength -
            (replacement.end - replacement.start);
        }
        return sourceTarget + delta;
      },
    };
  }

  function firstPlaceholderOutsideRanges(text, placeholder, ranges) {
    let searchOffset = 0;
    while (searchOffset <= text.length - placeholder.length) {
      const index = text.indexOf(placeholder, searchOffset);
      if (index === -1) {
        return -1;
      }
      const end = index + placeholder.length;
      const overlapsReplacement = ranges.some(
        (range) => index < range.end && end > range.start,
      );
      if (!overlapsReplacement) {
        return index;
      }
      searchOffset = index + Math.max(1, placeholder.length);
    }
    return -1;
  }

  function prepareInsertion(record, history, options = {}) {
    const text = promptText(record);
    const recordPlaceholder = normalizePlaceholder(record?.placeholder);
    const priorityCandidates = [];

    if (isCustomPlaceholder(recordPlaceholder)) {
      priorityCandidates.push(recordPlaceholder);
    }
    priorityCandidates.push(DEFAULT_PLACEHOLDER, LEGACY_PLACEHOLDER);

    const seen = new Set();
    for (const placeholder of priorityCandidates) {
      if (seen.has(placeholder)) {
        continue;
      }
      seen.add(placeholder);
      const prepared = removeFirstPlaceholder(text, placeholder);
      if (prepared) {
        const filled = fillPromptSlots(record, prepared.text, options.slotValues);
        return {
          text: filled.text,
          caretOffset: filled.mapOffset(prepared.caretOffset),
          matchedPlaceholder: prepared.matchedPlaceholder,
        };
      }
    }

    const filled = fillPromptSlots(record, text, options.slotValues);

    if (options.autoSelectBracketPlaceholder !== false) {
      const bracket = filled.remainingBrackets[0];
      if (bracket) {
        return {
          text: filled.text,
          caretOffset: bracket.start,
          selectionEndOffset: bracket.end,
          matchedPlaceholder: bracket.token,
        };
      }
    }

    for (const placeholder of normalizeHistory(history)) {
      if (seen.has(placeholder)) {
        continue;
      }
      seen.add(placeholder);
      const caretOffset = firstPlaceholderOutsideRanges(
        text,
        placeholder,
        filled.replacements,
      );
      if (caretOffset !== -1) {
        const withoutPlaceholder =
          text.slice(0, caretOffset) +
          text.slice(caretOffset + placeholder.length);
        const historyFilled = fillPromptSlots(
          record,
          withoutPlaceholder,
          options.slotValues,
        );
        return {
          text: historyFilled.text,
          caretOffset: historyFilled.mapOffset(caretOffset),
          matchedPlaceholder: placeholder,
        };
      }
    }

    return {
      text: filled.text,
      caretOffset: filled.text.length,
      matchedPlaceholder: null,
    };
  }

  function updatePlaceholderHistory(history, placeholder) {
    const normalizedHistory = normalizeHistory(history);
    const nextPlaceholder = normalizePlaceholder(placeholder);

    if (!isCustomPlaceholder(nextPlaceholder)) {
      return normalizedHistory;
    }

    return [
      nextPlaceholder,
      ...normalizedHistory.filter((value) => value !== nextPlaceholder),
    ].slice(0, MAX_PLACEHOLDER_HISTORY);
  }

  const api = {
    extractPromptSlots,
    prepareInsertion,
    updatePlaceholderHistory,
  };
  Object.assign(namespace, api);
  globalObject.PromptHelper = namespace;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
