import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contentPath = resolve(rootDir, "dist/content.js");
const stylesPath = resolve(rootDir, "src/styles.css");
const outputPath = resolve(rootDir, "dist/chatgpt-fold.user.js");

const [content, styles] = await Promise.all([
  readFile(contentPath, "utf8"),
  readFile(stylesPath, "utf8")
]);

const metadata = `// ==UserScript==
// @name         ChatGPT Fold
// @namespace    https://github.com/chatgpt-fold
// @version      0.1.0
// @description  Add collapsible heading sections to ChatGPT assistant responses.
// @author       feiyu.xia
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==`;

const userscript = `${metadata}

(function () {
  "use strict";

  const style = document.createElement("style");
  style.setAttribute("data-chatgpt-fold-style", "true");
  style.textContent = ${JSON.stringify(styles)};
  document.documentElement.appendChild(style);

${indent(content, 2)}
})();
`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, userscript, "utf8");

function indent(value, spaces) {
  const prefix = " ".repeat(spaces);
  return value
    .trim()
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
