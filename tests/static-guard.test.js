"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "manifest.json");
const STANDARD_SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const PRODUCTION_FILES = Object.freeze([
  "constants.js",
  "storage.js",
  "prompt-engine.js",
  "grok-editor.js",
  "update-check.js",
  "ui.js",
  "content.js",
  "content.css",
]);
const NETWORK_ALLOWED_FILES = Object.freeze(["update-check.js"]);
const ALLOWED_REMOTE_URL_PREFIXES = Object.freeze([
  "https://api.github.com/repos/issacsmit/Prompt_Helper_Extension_for_Grok/",
  "https://github.com/issacsmit/Prompt_Helper_Extension_for_Grok/",
]);

const FORBIDDEN_SIGNATURES = Object.freeze([
  {
    label: "network request primitive",
    pattern:
      /\b(?:fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon\s*\(|importScripts\s*\()/iu,
  },
  {
    label: "remote URL",
    pattern: /https?:\/\//iu,
  },
  {
    label: "API credential",
    pattern:
      /\b(?:api[_ -]?key|authorization\s*[:=]|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]{10,})\b/iu,
  },
  {
    label: "model service or model identifier",
    pattern:
      /\b(?:openrouter|api\.openai\.com|anthropic|gemini-[a-z0-9._-]+|gpt-[34o][a-z0-9._-]*|claude-[a-z0-9._-]+)\b/iu,
  },
  {
    label: "background messaging or service worker",
    pattern:
      /\b(?:serviceWorker|chrome\.runtime\.(?:onMessage|sendMessage)|importScripts)\b/u,
  },
  {
    label: "model-backed prompt rewriting hook",
    pattern: /\b(?:rewritePrompt|generatePrompt|callModel)\b/u,
  },
  {
    label: "bundled prompt library",
    pattern: /SEED_PROMPTS|seedPrompts|seed-prompts/u,
  },
]);

function isAllowedRemoteUrl(url) {
  if (url === STANDARD_SVG_NAMESPACE) {
    return true;
  }
  return ALLOWED_REMOTE_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function containsForbiddenRemoteUrl(source) {
  const remoteUrls = String(source || "").match(/https?:\/\/[^\s"'`]+/giu) || [];
  return remoteUrls.some((url) => !isAllowedRemoteUrl(url));
}

function readManifest() {
  assert.ok(fs.existsSync(MANIFEST_PATH), "manifest.json must exist before runtime files can be guarded");
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

test("static guard covers exactly the files loaded into the production page", () => {
  const manifest = readManifest();
  const contentScript = manifest.content_scripts?.[0];

  assert.deepEqual(
    [...(contentScript?.js || []), ...(contentScript?.css || [])],
    PRODUCTION_FILES,
  );
});

test("production runtime contains no network, credential, model, or background implementation", () => {
  for (const relativePath of PRODUCTION_FILES) {
    const absolutePath = path.join(ROOT, relativePath);
    assert.ok(fs.existsSync(absolutePath), `${relativePath} must exist`);
    const source = fs.readFileSync(absolutePath, "utf8");

    for (const signature of FORBIDDEN_SIGNATURES) {
      if (signature.label === "remote URL") {
        assert.equal(
          containsForbiddenRemoteUrl(source),
          false,
          `${relativePath} contains a forbidden ${signature.label}`,
        );
        continue;
      }
      if (
        signature.label === "network request primitive" &&
        NETWORK_ALLOWED_FILES.includes(relativePath)
      ) {
        continue;
      }
      assert.doesNotMatch(
        source,
        signature.pattern,
        `${relativePath} contains a forbidden ${signature.label}`,
      );
    }
  }
});

test("remote URL guard exempts only the standard SVG namespace", () => {
  const svgNamespace = "http://www.w3.org/2000/svg";

  assert.equal(containsForbiddenRemoteUrl(svgNamespace), false);
  assert.equal(
    containsForbiddenRemoteUrl(
      "https://api.github.com/repos/issacsmit/Prompt_Helper_Extension_for_Grok/releases/latest",
    ),
    false,
  );
  assert.equal(containsForbiddenRemoteUrl("https://example.com/api"), true);
  assert.equal(containsForbiddenRemoteUrl("http://example.com/resource"), true);
  assert.equal(containsForbiddenRemoteUrl(`${svgNamespace}.evil`), true);
  assert.equal(
    containsForbiddenRemoteUrl(`${svgNamespace} https://example.com/still-forbidden`),
    true,
  );
});

test("the extension root has no background script", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "background.js")), false);
});
