type FoldAction = "collapse" | "expand";

type FoldBlock = {
  id: string;
  heading: HTMLElement;
  toggle: HTMLButtonElement;
  contentNodes: HTMLElement[];
  collapsed: boolean;
};

type ProcessedMessage = {
  container: HTMLElement;
  blocks: FoldBlock[];
};

const MESSAGE_PROCESSED_ATTR = "data-chatgpt-fold-message";
const BLOCK_ID_ATTR = "data-chatgpt-fold-block-id";
const GLOBAL_CONTROLS_ID = "cgpt-fold-global-controls";
const HIDDEN_CLASS = "cgpt-fold-hidden";
const SCAN_DEBOUNCE_MS = 250;
const DEBUG_PREFIX = "[ChatGPT Fold]";

const assistantMessageSelector = [
  '[data-message-author-role="assistant"]',
  '[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]'
].join(",");

let blockIdCounter = 0;
let scanTimer: number | undefined;
let observer: MutationObserver | undefined;

const processedMessages = new WeakMap<HTMLElement, ProcessedMessage>();

function isHTMLElement(value: Element | Node | null | undefined): value is HTMLElement {
  return value instanceof HTMLElement;
}

function getHeadingLevel(heading: Element): number {
  return Number.parseInt(heading.tagName.slice(1), 10);
}

function createBlockId(): string {
  blockIdCounter += 1;
  return `cgpt-fold-block-${blockIdCounter}`;
}

function getMessageContainer(roleElement: HTMLElement): HTMLElement {
  return roleElement.closest("article") ?? roleElement;
}

function getContentRoot(roleElement: HTMLElement): HTMLElement {
  const markdown = roleElement.querySelector<HTMLElement>(".markdown");
  if (markdown) {
    return markdown;
  }

  const prose = roleElement.querySelector<HTMLElement>(".prose");
  if (prose) {
    return prose;
  }

  return roleElement;
}

function getAssistantContentRoots(): HTMLElement[] {
  const roots: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const roleElement of document.querySelectorAll<HTMLElement>(assistantMessageSelector)) {
    const messageContainer = getMessageContainer(roleElement);
    if (seen.has(messageContainer)) {
      continue;
    }

    seen.add(messageContainer);
    roots.push(getContentRoot(roleElement));
  }

  if (roots.length > 0) {
    return roots;
  }

  for (const markdownRoot of document.querySelectorAll<HTMLElement>("main .markdown, main .prose")) {
    if (seen.has(markdownRoot) || isManagedNode(markdownRoot)) {
      continue;
    }

    seen.add(markdownRoot);
    roots.push(markdownRoot);
  }

  return roots;
}

function isManagedNode(element: HTMLElement): boolean {
  return Boolean(
    element.closest(".cgpt-fold-global-controls") ||
      element.classList.contains("cgpt-fold-toggle")
  );
}

function resetMessage(contentRoot: HTMLElement): void {
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

function getUniqueContentNodes(blocks: FoldBlock[]): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const block of blocks) {
    for (const node of block.contentNodes) {
      if (seen.has(node)) {
        continue;
      }

      seen.add(node);
      nodes.push(node);
    }
  }

  return nodes;
}

function renderMessage(processedMessage: ProcessedMessage): void {
  for (const block of processedMessage.blocks) {
    block.toggle.setAttribute("aria-expanded", String(!block.collapsed));
    block.toggle.setAttribute("aria-label", block.collapsed ? "展开此段" : "折叠此段");
  }

  for (const node of getUniqueContentNodes(processedMessage.blocks)) {
    const hiddenByCollapsedBlock = processedMessage.blocks.some(
      (block) => block.collapsed && block.contentNodes.includes(node)
    );

    node.classList.toggle(HIDDEN_CLASS, hiddenByCollapsedBlock);
  }
}

function snapshotCollapsedStates(contentRoot: HTMLElement): Map<string, boolean> {
  const previous = processedMessages.get(contentRoot);
  const states = new Map<string, boolean>();

  if (!previous) {
    return states;
  }

  for (const block of previous.blocks) {
    states.set(block.id, block.collapsed);
  }

  return states;
}

function collectHeadingBlocks(contentRoot: HTMLElement): Omit<FoldBlock, "toggle" | "collapsed">[] {
  const headings = Array.from(contentRoot.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")).filter(
    (heading) => !isManagedNode(heading)
  );

  return headings.map((heading) => {
    const level = getHeadingLevel(heading);
    const contentNodes: HTMLElement[] = [];
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

function createToggle(block: Omit<FoldBlock, "toggle" | "collapsed">): HTMLButtonElement {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "cgpt-fold-toggle";
  toggle.innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M5.2 3.8 9.4 8l-4.2 4.2 1.4 1.4L12.2 8 6.6 2.4 5.2 3.8z" fill="currentColor"/></svg>';
  toggle.dataset.foldBlockId = block.id;

  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const processedMessage = findProcessedMessage(toggle);
    if (!processedMessage) {
      return;
    }

    const currentBlock = processedMessage.blocks.find((candidate) => candidate.id === block.id);
    if (!currentBlock) {
      return;
    }

    setBlockCollapsed(processedMessage, currentBlock, !currentBlock.collapsed);
  });

  return toggle;
}

function attachToggle(heading: HTMLElement, toggle: HTMLButtonElement): void {
  heading.appendChild(toggle);
}

function setBlockCollapsed(
  processedMessage: ProcessedMessage,
  block: FoldBlock,
  collapsed: boolean
): void {
  block.collapsed = collapsed;
  renderMessage(processedMessage);
}

function findProcessedMessage(element: HTMLElement): ProcessedMessage | undefined {
  const message = element.closest<HTMLElement>(`[${MESSAGE_PROCESSED_ATTR}]`);
  if (!message) {
    return undefined;
  }

  return processedMessages.get(message);
}

function processMessage(contentRoot: HTMLElement): void {
  const collapsedStates = snapshotCollapsedStates(contentRoot);
  resetMessage(contentRoot);

  const blocks: FoldBlock[] = [];

  for (const rawBlock of collectHeadingBlocks(contentRoot)) {
    if (rawBlock.contentNodes.length === 0) {
      continue;
    }

    rawBlock.heading.setAttribute(BLOCK_ID_ATTR, rawBlock.id);
    const toggle = createToggle(rawBlock);
    attachToggle(rawBlock.heading, toggle);
    const collapsed = collapsedStates.get(rawBlock.id) ?? false;
    const block: FoldBlock = {
      ...rawBlock,
      toggle,
      collapsed
    };

    blocks.push(block);
  }

  if (blocks.length === 0) {
    return;
  }

  contentRoot.setAttribute(MESSAGE_PROCESSED_ATTR, "true");
  const processedMessage: ProcessedMessage = {
    container: contentRoot,
    blocks
  };
  processedMessages.set(contentRoot, processedMessage);
  renderMessage(processedMessage);
}

function runScan(): void {
  ensureGlobalControls();

  const roots = getAssistantContentRoots();
  for (const root of roots) {
    processMessage(root);
  }
}

function scheduleScan(): void {
  if (scanTimer !== undefined) {
    window.clearTimeout(scanTimer);
  }

  scanTimer = window.setTimeout(() => {
    scanTimer = undefined;
    runScan();
  }, SCAN_DEBOUNCE_MS);
}

function setAll(action: FoldAction): void {
  const collapsed = action === "collapse";
  for (const root of getAssistantContentRoots()) {
    const processedMessage = processedMessages.get(root);
    if (!processedMessage) {
      continue;
    }

    for (const block of processedMessage.blocks) {
      block.collapsed = collapsed;
    }

    renderMessage(processedMessage);
  }
}

function ensureGlobalControls(): void {
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

function observePage(): void {
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

function init(): void {
  if (!document.body) {
    window.addEventListener("DOMContentLoaded", init, { once: true });
    return;
  }

  console.info(`${DEBUG_PREFIX} userscript started`, {
    url: location.href,
    readyState: document.readyState
  });
  runScan();
  observePage();
}

init();
