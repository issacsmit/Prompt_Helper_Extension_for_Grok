"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "manifest.json");

const EXPECTED_JAVASCRIPT = Object.freeze([
  "constants.js",
  "storage.js",
  "prompt-engine.js",
  "grok-editor.js",
  "update-check.js",
  "ui.js",
  "content.js",
]);

function readManifest() {
  assert.ok(fs.existsSync(MANIFEST_PATH), "manifest.json must exist at the extension root");
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function collectUrls(value, urls = []) {
  if (typeof value === "string" && value.includes("://")) {
    urls.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      collectUrls(entry, urls);
    }
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      collectUrls(entry, urls);
    }
  }
  return urls;
}

test("manifest declares the exact MV3 identity, version, and storage permission", () => {
  const manifest = readManifest();

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Grok 提示词助手");
  assert.equal(manifest.version, "1.0.0");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://api.github.com/*"]);
});

test("manifest loads the content runtime in exact dependency order on grok.com", () => {
  const manifest = readManifest();

  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ["https://grok.com/*"],
      js: EXPECTED_JAVASCRIPT,
      css: ["content.css"],
      run_at: "document_idle",
    },
  ]);
});

test("manifest exposes only local icons and no background or extra extension surfaces", () => {
  const manifest = readManifest();

  assert.deepEqual(manifest.icons, {
    16: "icons/icon16.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png",
  });

  for (const prohibitedKey of [
    "background",
    "action",
    "browser_action",
    "page_action",
    "options_page",
    "options_ui",
    "side_panel",
    "devtools_page",
    "externally_connectable",
    "web_accessible_resources",
    "chrome_url_overrides",
  ]) {
    assert.equal(
      Object.hasOwn(manifest, prohibitedKey),
      false,
      `manifest must not declare ${prohibitedKey}`,
    );
  }

  assert.deepEqual(collectUrls(manifest), [
    "https://api.github.com/*",
    "https://grok.com/*",
  ]);
});
