// content/content.js
// WebMCP bridge + DOM interaction executor
// SECURITY: Never passes raw page text to backend (prompt injection defense)

// ---------------------------------------------------------------------------
// WebMCP API access — support both production and testing namespaces
// ---------------------------------------------------------------------------
function getModelContext() {
  return navigator.modelContext || navigator.modelContextTesting || null;
}

// ---------------------------------------------------------------------------
// Message listener — service worker / side panel relay
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'get_webmcp_tools') {
    getWebMCPTools().then(sendResponse);
    return true; // async response
  }
  if (message.type === 'execute_webmcp') {
    executeWebMCPTool(message.tool_name, message.args).then(sendResponse);
    return true;
  }
  if (message.type === 'execute_dom') {
    executeDOMAction(message.selector, message.action, message.value).then(sendResponse);
    return true;
  }
  if (message.type === 'get_page_meta') {
    // Return ONLY structured metadata — never raw page text
    sendResponse({
      url: window.location.href,
      title: document.title,
    });
    return false;
  }
  if (message.type === 'get_interactive_elements') {
    sendResponse(getInteractiveElements());
    return false;
  }
});

// ---------------------------------------------------------------------------
// WebMCP tools — check availability before every call
// ---------------------------------------------------------------------------
async function getWebMCPTools() {
  const ctx = getModelContext();
  if (!ctx) {
    return { available: false, tools: [] };
  }
  try {
    // Reference pattern: listTools() returns tool schemas
    const tools = typeof ctx.listTools === 'function'
      ? ctx.listTools()
      : (typeof ctx.getTools === 'function' ? await ctx.getTools() : []);
    return { available: true, tools: tools || [] };
  } catch (e) {
    return { available: false, tools: [], error: e.message };
  }
}

async function executeWebMCPTool(toolName, args) {
  const ctx = getModelContext();
  if (!ctx) {
    return { success: false, error: 'WebMCP not available on this page' };
  }
  try {
    // Reference pattern: executeTool(name, args)
    let result;
    if (typeof ctx.executeTool === 'function') {
      result = await ctx.executeTool(toolName, args);
    } else if (typeof ctx.callTool === 'function') {
      result = await ctx.callTool(toolName, args);
    } else {
      return { success: false, error: 'No WebMCP execution method available' };
    }
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Interactive element discovery — returns visible inputs, textareas, contenteditables
// ---------------------------------------------------------------------------
function getInteractiveElements() {
  const results = [];
  const candidates = document.querySelectorAll(
    'input:not([type="hidden"]), textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]'
  );
  candidates.forEach((el, i) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    const info = {
      index: i,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      placeholder: el.getAttribute('placeholder') || el.getAttribute('aria-label') || '',
      role: el.getAttribute('role') || '',
      contenteditable: el.isContentEditable,
      selector: buildSelector(el),
      position: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
    results.push(info);
  });
  return { success: true, elements: results };
}

function buildSelector(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
  if (el.getAttribute('aria-label')) return `[aria-label="${el.getAttribute('aria-label')}"]`;
  if (el.getAttribute('name')) return `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`;
  if (el.getAttribute('placeholder')) return `${el.tagName.toLowerCase()}[placeholder="${el.getAttribute('placeholder')}"]`;
  if (el.isContentEditable) {
    if (el.classList.contains('ProseMirror')) return 'div.ProseMirror[contenteditable="true"]';
    if (el.getAttribute('role') === 'textbox') return '[role="textbox"][contenteditable="true"]';
    return '[contenteditable="true"]';
  }
  return el.tagName.toLowerCase();
}

// Fallback selector cascade for typing into rich-text editors / reply boxes
const REPLY_BOX_SELECTORS = [
  'div.ProseMirror[contenteditable="true"]',
  '[role="textbox"][contenteditable="true"]',
  'div[contenteditable="true"][data-placeholder]',
  'div[contenteditable="true"]',
  'textarea',
  'input[type="text"]:not([hidden])',
  'input:not([type]):not([hidden])',
];

// Search iframes recursively for an element
function findElement(selector) {
  // Try top-level document first
  let el = document.querySelector(selector);
  if (el) return el;

  // Search all iframes recursively
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) continue;
      el = doc.querySelector(selector);
      if (el) return el;

      // Nested iframes
      const nested = doc.querySelectorAll('iframe');
      for (const n of nested) {
        try {
          el = n.contentDocument?.querySelector(selector);
          if (el) return el;
        } catch {}
      }
    } catch {}
  }
  return null;
}

function findElementWithFallback(selector) {
  // Try the given selector first (including iframes)
  let el = findElement(selector);
  if (el) return el;

  // Try smart partial matching for aria-label selectors
  const ariaExact = selector.match(/\[aria-label=["'](.+?)["']\]/);
  if (ariaExact) {
    const labelText = ariaExact[1].toLowerCase();
    // Try contains match
    const allWithLabel = document.querySelectorAll('[aria-label]');
    for (const candidate of allWithLabel) {
      const candidateLabel = (candidate.getAttribute('aria-label') || '').toLowerCase();
      if (candidateLabel.includes(labelText) || labelText.includes(candidateLabel)) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return candidate;
      }
    }
  }

  // Try matching by data-testid partial match
  const testIdMatch = selector.match(/\[data-testid=["'](.+?)["']\]/);
  if (testIdMatch) {
    const testId = testIdMatch[1].toLowerCase();
    const allWithTestId = document.querySelectorAll('[data-testid]');
    for (const candidate of allWithTestId) {
      if ((candidate.getAttribute('data-testid') || '').toLowerCase().includes(testId)) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return candidate;
      }
    }
  }

  // Try the fallback cascade (for reply boxes / text inputs)
  for (const fallback of REPLY_BOX_SELECTORS) {
    el = findElement(fallback);
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return el;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Visibility helper — waits for element to be visible before interaction
// ---------------------------------------------------------------------------
async function waitForVisible(el, maxRetries = 3, delayMs = 200) {
  for (let i = 0; i < maxRetries; i++) {
    if (typeof el.checkVisibility === 'function') {
      if (el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return true;
    } else {
      // Fallback for browsers without checkVisibility
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.opacity !== '0') return true;
    }
    if (i < maxRetries - 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// DOM actions — fallback when WebMCP not available
// ---------------------------------------------------------------------------
async function executeDOMAction(selector, action, value) {
  try {
    // Page-level scroll actions — no element needed
    if (action === 'scroll_down') {
      const amount = parseInt(value) || 600;
      window.scrollBy({ top: amount, behavior: 'smooth' });
      await new Promise(r => setTimeout(r, 300));
      return { success: true, scrollY: Math.round(window.scrollY), scrollHeight: document.body.scrollHeight };
    }
    if (action === 'scroll_up') {
      const amount = parseInt(value) || 600;
      window.scrollBy({ top: -amount, behavior: 'smooth' });
      await new Promise(r => setTimeout(r, 300));
      return { success: true, scrollY: Math.round(window.scrollY), scrollHeight: document.body.scrollHeight };
    }
    if (action === 'scroll_to_top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await new Promise(r => setTimeout(r, 300));
      return { success: true, scrollY: Math.round(window.scrollY), scrollHeight: document.body.scrollHeight };
    }
    if (action === 'scroll_to_bottom') {
      // Scroll in steps to trigger infinite scroll content loading
      for (let i = 0; i < 3; i++) {
        window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 500));
      }
      return { success: true, scrollY: Math.round(window.scrollY), scrollHeight: document.body.scrollHeight };
    }

    // Use smart fallback for type/click actions on potential text inputs
    const el = (action === 'type' || action === 'click')
      ? findElementWithFallback(selector)
      : findElement(selector);
    if (!el) {
      return { success: false, error: 'Element not found: ' + selector };
    }

    switch (action) {
      case 'click': {
        // Check visibility before clicking — retry up to 3 times
        const isVisible = await waitForVisible(el, 3, 200);
        if (!isVisible) {
          return { success: false, error: 'Element found but not visible: ' + selector };
        }
        el.click();
        break;
      }
      case 'type': {
        const textToType = value || '';

        // Always clear existing content before typing
        el.focus();
        el.click();

        // Strategy 1: contenteditable elements (e.g. Claude.ai, rich text editors)
        if (el.isContentEditable) {
          // Clear existing content first
          el.innerHTML = '';
          el.focus();
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
          if (!document.execCommand('insertText', false, textToType)) {
            el.textContent = textToType;
          }
          el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: textToType, bubbles: true, cancelable: true }));
          el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          break;
        }

        // Clear existing value for input/textarea fields
        if ('value' in el) {
          el.value = '';
        }
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);

        // Strategy 2: execCommand('insertText') for standard inputs
        if (el.select) el.select();
        try {
          if (document.execCommand('insertText', false, textToType)) {
            break;
          }
        } catch (ignore) { /* fall through */ }

        // Strategy 3: Click + set value via native setter + dispatch events (React-friendly)
        el.click();
        const proto = Object.getPrototypeOf(el);
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
          || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, textToType);
        } else {
          el.value = textToType;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
      case 'scroll':
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      case 'hover':
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
        break;
      case 'select':
        if (el.tagName === 'SELECT') {
          el.value = value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        break;
      default:
        return { success: false, error: 'Unknown action: ' + action };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Notify service worker when WebMCP tools change on this page
// ---------------------------------------------------------------------------
(function observeWebMCPTools() {
  const ctx = getModelContext();
  if (!ctx) return;

  // Reference pattern: listen for tool changes
  if (typeof ctx.addEventListener === 'function') {
    ctx.addEventListener('toolchange', () => {
      getWebMCPTools().then((result) => {
        chrome.runtime.sendMessage({
          type: 'webmcp_tools_updated',
          tools: result.tools,
          url: window.location.href,
        });
      });
    });
  } else if (typeof ctx.registerToolsChangedCallback === 'function') {
    ctx.registerToolsChangedCallback(() => {
      getWebMCPTools().then((result) => {
        chrome.runtime.sendMessage({
          type: 'webmcp_tools_updated',
          tools: result.tools,
          url: window.location.href,
        });
      });
    });
  }
})();
