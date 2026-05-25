// ==UserScript==
// @name         ChatGPT Fold
// @namespace    https://github.com/chatgpt-fold
// @version      0.1.0
// @description  Add collapsible heading sections to ChatGPT assistant responses.
// @author       feiyu.xia
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Stevring/chatgpt-fold-util/main/dist/chatgpt-fold.user.js
// @downloadURL  https://raw.githubusercontent.com/Stevring/chatgpt-fold-util/main/dist/chatgpt-fold.user.js
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  const style = document.createElement("style");
  style.setAttribute("data-chatgpt-fold-style", "true");
  style.textContent = ".cgpt-fold-toggle,\n.cgpt-fold-global-button {\n  font: inherit;\n  color: inherit;\n  cursor: pointer;\n  transition:\n    background-color 120ms ease,\n    border-color 120ms ease,\n    transform 120ms ease;\n}\n\n.cgpt-fold-toggle {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 1.25rem;\n  height: 1.25rem;\n  min-width: 1.25rem;\n  margin-inline-start: 0.35rem;\n  padding: 0;\n  border: 0;\n  border-radius: 4px;\n  background: transparent;\n  vertical-align: middle;\n  line-height: 1;\n  opacity: 0.68;\n  transform: rotate(90deg);\n}\n\n.cgpt-fold-toggle:hover {\n  background: color-mix(in srgb, currentColor 10%, transparent);\n  opacity: 1;\n}\n\n.cgpt-fold-global-button {\n  border: 1px solid rgba(120, 120, 120, 0.32);\n  background: color-mix(in srgb, canvas 92%, canvasText 8%);\n}\n\n.cgpt-fold-global-button:hover {\n  background: color-mix(in srgb, canvas 84%, canvasText 16%);\n  border-color: rgba(120, 120, 120, 0.5);\n}\n\n.cgpt-fold-toggle:focus-visible,\n.cgpt-fold-global-button:focus-visible {\n  outline: 2px solid #10a37f;\n  outline-offset: 2px;\n}\n\n.cgpt-fold-toggle[aria-expanded=\"false\"] {\n  transform: rotate(0deg);\n}\n\n.cgpt-fold-hidden {\n  display: none !important;\n}\n\n.cgpt-fold-global-controls {\n  position: fixed;\n  right: 18px;\n  bottom: 84px;\n  z-index: 2147483647;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding: 8px;\n  border: 1px solid rgba(120, 120, 120, 0.2);\n  border-radius: 8px;\n  background: color-mix(in srgb, canvas 88%, transparent);\n  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16);\n  backdrop-filter: blur(10px);\n}\n\n.cgpt-fold-global-button {\n  min-width: 5.5rem;\n  min-height: 2rem;\n  padding: 0 0.75rem;\n  border-radius: 6px;\n  font-size: 0.82rem;\n  font-weight: 600;\n  white-space: nowrap;\n}\n\n@media (max-width: 640px) {\n  .cgpt-fold-global-controls {\n    right: 12px;\n    bottom: 72px;\n  }\n\n  .cgpt-fold-global-button {\n    min-width: 4.75rem;\n    padding: 0 0.55rem;\n    font-size: 0.76rem;\n  }\n}\n";
  document.documentElement.appendChild(style);

  "use strict";
  const MESSAGE_PROCESSED_ATTR = "data-chatgpt-fold-message";
  const BLOCK_ID_ATTR = "data-chatgpt-fold-block-id";
  const GLOBAL_CONTROLS_ID = "cgpt-fold-global-controls";
  const HIDDEN_CLASS = "cgpt-fold-hidden";
  const SCAN_DEBOUNCE_MS = 250;
  const assistantMessageSelector = [
      '[data-message-author-role="assistant"]',
      '[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]'
  ].join(",");
  let blockIdCounter = 0;
  let scanTimer;
  let observer;
  const processedMessages = new WeakMap();
  function isHTMLElement(value) {
      return value instanceof HTMLElement;
  }
  function getHeadingLevel(heading) {
      return Number.parseInt(heading.tagName.slice(1), 10);
  }
  function createBlockId() {
      blockIdCounter += 1;
      return `cgpt-fold-block-${blockIdCounter}`;
  }
  function getMessageContainer(roleElement) {
      return roleElement.closest("article") ?? roleElement;
  }
  function getContentRoot(roleElement) {
      const markdown = roleElement.querySelector(".markdown");
      if (markdown) {
          return markdown;
      }
      const prose = roleElement.querySelector(".prose");
      if (prose) {
          return prose;
      }
      return roleElement;
  }
  function getAssistantContentRoots() {
      const roots = [];
      const seen = new Set();
      for (const roleElement of document.querySelectorAll(assistantMessageSelector)) {
          const messageContainer = getMessageContainer(roleElement);
          if (seen.has(messageContainer)) {
              continue;
          }
          seen.add(messageContainer);
          roots.push(getContentRoot(roleElement));
      }
      return roots;
  }
  function isManagedNode(element) {
      return Boolean(element.closest(".cgpt-fold-global-controls") ||
          element.classList.contains("cgpt-fold-toggle"));
  }
  function resetMessage(contentRoot) {
      const previous = processedMessages.get(contentRoot);
      if (!previous) {
          return;
      }
      for (const block of previous.blocks) {
          block.toggle.remove();
          for (const node of block.contentNodes) {
              node.classList.remove(HIDDEN_CLASS);
          }
      }
      contentRoot.removeAttribute(MESSAGE_PROCESSED_ATTR);
      processedMessages.delete(contentRoot);
  }
  function snapshotCollapsedStates(contentRoot) {
      const previous = processedMessages.get(contentRoot);
      const states = new Map();
      if (!previous) {
          return states;
      }
      for (const block of previous.blocks) {
          states.set(block.id, block.collapsed);
      }
      return states;
  }
  function collectHeadingBlocks(contentRoot) {
      const headings = Array.from(contentRoot.querySelectorAll("h1,h2,h3,h4,h5,h6")).filter((heading) => !isManagedNode(heading));
      return headings.map((heading) => {
          const level = getHeadingLevel(heading);
          const contentNodes = [];
          let cursor = heading.nextElementSibling;
          while (cursor) {
              if (cursor.matches("h1,h2,h3,h4,h5,h6") && getHeadingLevel(cursor) <= level) {
                  break;
              }
              if (isHTMLElement(cursor) && !isManagedNode(cursor)) {
                  contentNodes.push(cursor);
              }
              cursor = cursor.nextElementSibling;
          }
          return {
              id: heading.getAttribute(BLOCK_ID_ATTR) ?? createBlockId(),
              heading,
              contentNodes
          };
      });
  }
  function createToggle(block) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "cgpt-fold-toggle";
      toggle.innerHTML =
          '<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M5.2 3.8 9.4 8l-4.2 4.2 1.4 1.4L12.2 8 6.6 2.4 5.2 3.8z" fill="currentColor"/></svg>';
      toggle.setAttribute("aria-label", "折叠此段");
      toggle.setAttribute("aria-expanded", "true");
      toggle.dataset.foldBlockId = block.id;
      toggle.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const processedMessage = findProcessedMessage(toggle);
          const currentBlock = processedMessage?.blocks.find((candidate) => candidate.id === block.id);
          if (!currentBlock) {
              return;
          }
          setBlockCollapsed(currentBlock, !currentBlock.collapsed);
      });
      return toggle;
  }
  function attachToggle(heading, toggle) {
      heading.appendChild(toggle);
  }
  function setBlockCollapsed(block, collapsed) {
      block.collapsed = collapsed;
      block.toggle.setAttribute("aria-expanded", String(!collapsed));
      block.toggle.setAttribute("aria-label", collapsed ? "展开此段" : "折叠此段");
      for (const node of block.contentNodes) {
          node.classList.toggle(HIDDEN_CLASS, collapsed);
      }
  }
  function findProcessedMessage(element) {
      const message = element.closest(`[${MESSAGE_PROCESSED_ATTR}]`);
      if (!message) {
          return undefined;
      }
      return processedMessages.get(message);
  }
  function processMessage(contentRoot) {
      const collapsedStates = snapshotCollapsedStates(contentRoot);
      resetMessage(contentRoot);
      const blocks = [];
      for (const rawBlock of collectHeadingBlocks(contentRoot)) {
          if (rawBlock.contentNodes.length === 0) {
              continue;
          }
          rawBlock.heading.setAttribute(BLOCK_ID_ATTR, rawBlock.id);
          const toggle = createToggle(rawBlock);
          attachToggle(rawBlock.heading, toggle);
          const collapsed = collapsedStates.get(rawBlock.id) ?? false;
          const block = {
              ...rawBlock,
              toggle,
              collapsed: false
          };
          setBlockCollapsed(block, collapsed);
          blocks.push(block);
      }
      if (blocks.length === 0) {
          return;
      }
      contentRoot.setAttribute(MESSAGE_PROCESSED_ATTR, "true");
      processedMessages.set(contentRoot, {
          container: contentRoot,
          blocks
      });
  }
  function runScan() {
      const roots = getAssistantContentRoots();
      for (const root of roots) {
          processMessage(root);
      }
      ensureGlobalControls();
  }
  function scheduleScan() {
      if (scanTimer !== undefined) {
          window.clearTimeout(scanTimer);
      }
      scanTimer = window.setTimeout(() => {
          scanTimer = undefined;
          runScan();
      }, SCAN_DEBOUNCE_MS);
  }
  function setAll(action) {
      const collapsed = action === "collapse";
      for (const root of getAssistantContentRoots()) {
          const processedMessage = processedMessages.get(root);
          if (!processedMessage) {
              continue;
          }
          for (const block of processedMessage.blocks) {
              setBlockCollapsed(block, collapsed);
          }
      }
  }
  function ensureGlobalControls() {
      if (document.getElementById(GLOBAL_CONTROLS_ID)) {
          return;
      }
      const controls = document.createElement("div");
      controls.id = GLOBAL_CONTROLS_ID;
      controls.className = "cgpt-fold-global-controls";
      const collapseButton = document.createElement("button");
      collapseButton.type = "button";
      collapseButton.className = "cgpt-fold-global-button";
      collapseButton.textContent = "折叠全部";
      collapseButton.addEventListener("click", () => setAll("collapse"));
      const expandButton = document.createElement("button");
      expandButton.type = "button";
      expandButton.className = "cgpt-fold-global-button";
      expandButton.textContent = "展开全部";
      expandButton.addEventListener("click", () => setAll("expand"));
      controls.append(collapseButton, expandButton);
      document.documentElement.appendChild(controls);
  }
  function observePage() {
      observer?.disconnect();
      observer = new MutationObserver((mutations) => {
          const shouldRescan = mutations.some((mutation) => {
              if (mutation.type !== "childList") {
                  return false;
              }
              const addedNodes = Array.from(mutation.addedNodes);
              const removedNodes = Array.from(mutation.removedNodes);
              return [...addedNodes, ...removedNodes].some((node) => {
                  if (!isHTMLElement(node)) {
                      return false;
                  }
                  return !isManagedNode(node);
              });
          });
          if (shouldRescan) {
              scheduleScan();
          }
      });
      observer.observe(document.body, {
          childList: true,
          subtree: true
      });
  }
  function init() {
      if (!document.body) {
          window.addEventListener("DOMContentLoaded", init, { once: true });
          return;
      }
      runScan();
      observePage();
  }
  init();
})();
