// ThreadOS Sentinel — Bundled: gemini
(function() {
'use strict';
// ThreadOS Sentinel — Shared Content Script Base

const genId = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

const detectModel = () => {
  const u = location.href;
  if (u.includes('openai.com'))     return 'ChatGPT';
  if (u.includes('claude.ai'))      return 'Claude';
  if (u.includes('gemini.google'))  return 'Gemini';
  if (u.includes('perplexity.ai'))  return 'Perplexity';
  return 'Unknown';
};

// ── BACKGROUND MESSAGING ──────────────────────────────────────────────────────
async function bg(type, payload = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, payload });
  } catch (e) {
    console.warn('[ThreadOS]', e.message);
    return { error: e.message };
  }
}

// ── THREAD STATE ──────────────────────────────────────────────────────────────
let _threadId = null;
let _panelReady = false;

function getThreadId() { return _threadId; }
function setThreadId(id) { _threadId = id; }

// ── CAPTURE SESSION ───────────────────────────────────────────────────────────
async function captureSession({ model, prompt, response }) {
  // Ensure we have a thread
  if (!_threadId) {
    const r = await bg('CREATE_THREAD', {
      title: `${model} — ${new Date().toLocaleDateString()}`,
    });
    if (r?.thread) _threadId = r.thread.id;
    else return null;
  }

  const result = await bg('CAPTURE_SESSION', {
    threadId: _threadId,
    session: {
      model,
      prompt:   prompt.trim().slice(0, 4000),
      response: response.trim().slice(0, 6000),
      url:      location.href,
      timestamp: Date.now(),
    },
  });

  if (result?.ok) {
    notifyPanel({ type: 'SESSION_CAPTURED', session: result.session, drift: result.drift });
  }
  return result;
}

// ── PANEL COMMUNICATION ───────────────────────────────────────────────────────
function notifyPanel(msg) {
  const iframe = document.getElementById('tos-panel-frame');
  iframe?.contentWindow?.postMessage({ source: 'tos-content', ...msg }, '*');
}

window.addEventListener('message', e => {
  if (e.data?.source !== 'tos-panel') return;
  if (e.data.type === 'SET_THREAD') _threadId = e.data.threadId;
  if (e.data.type === 'REQUEST_STATE') pushStateToPanel();
});

async function pushStateToPanel() {
  const r = await bg('GET_THREADS', {});
  notifyPanel({
    type: 'STATE',
    threads: r?.threads || [],
    activeThreadId: _threadId,
    model: detectModel(),
  });
}

// ── PANEL INJECTION ───────────────────────────────────────────────────────────
function injectPanel() {
  if (_panelReady) return;
  _panelReady = true;

  // Panel iframe
  const iframe = document.createElement('iframe');
  iframe.id = 'tos-panel-frame';
  iframe.src = chrome.runtime.getURL('panel.html');
  Object.assign(iframe.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    width: '320px',
    height: '480px',
    border: 'none',
    borderRadius: '14px',
    boxShadow: '0 24px 72px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.06)',
    zIndex: '2147483640',
    transition: 'transform .25s cubic-bezier(.4,0,.2,1), opacity .2s ease',
    background: 'transparent',
  });
  document.body.appendChild(iframe);

  // Toggle button
  const toggle = document.createElement('button');
  toggle.id = 'tos-toggle';
  toggle.innerHTML = iconSVG(16);
  Object.assign(toggle.style, {
    position: 'fixed',
    bottom: '20px',
    right: '348px',
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    background: '#f97316',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    zIndex: '2147483641',
    boxShadow: '0 4px 16px rgba(249,115,22,.4)',
    transition: 'all .2s ease',
  });
  document.body.appendChild(toggle);

  // Drift badge
  const badge = document.createElement('span');
  badge.id = 'tos-badge';
  Object.assign(badge.style, {
    position: 'fixed',
    bottom: '48px',
    right: '348px',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    background: '#ef4444',
    border: '2px solid white',
    zIndex: '2147483642',
    display: 'none',
  });
  document.body.appendChild(badge);

  // Pulse keyframe
  const style = document.createElement('style');
  style.textContent = `@keyframes tos-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.25);opacity:.8}}`;
  document.head.appendChild(style);

  // Toggle logic
  let visible = true;
  toggle.addEventListener('click', () => {
    visible = !visible;
    iframe.style.transform = visible ? '' : 'translateY(16px) scale(.96)';
    iframe.style.opacity = visible ? '1' : '0';
    iframe.style.pointerEvents = visible ? 'auto' : 'none';
    toggle.style.background = visible ? '#f97316' : '#17171c';
    toggle.style.border = visible ? 'none' : '1px solid #28283a';
    if (visible) pushStateToPanel();
  });

  // Listen for drift events to light up badge
  window.addEventListener('message', e => {
    if (e.data?.source !== 'tos-content') return;
    if (e.data.type === 'SESSION_CAPTURED' && e.data.drift?.drift) {
      badge.style.display = 'block';
      badge.style.background = e.data.drift.severity === 'high' ? '#ef4444' : '#eab308';
      badge.style.animation = 'tos-pulse 1.4s 3';
    }
  });

  // Initial state push after panel loads
  iframe.addEventListener('load', () => setTimeout(pushStateToPanel, 300));
}

// ── SAVE TO THREAD BUTTON ─────────────────────────────────────────────────────
function injectSaveButton(anchorSel, getPrompt, getResponse) {
  let injected = false;

  const tryInject = () => {
    if (injected || document.getElementById('tos-save-btn')) return;
    const anchor = document.querySelector(anchorSel);
    if (!anchor) return;
    injected = true;

    const btn = document.createElement('button');
    btn.id = 'tos-save-btn';
    btn.innerHTML = `${iconSVG(11)} Save to Thread`;
    Object.assign(btn.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      padding: '5px 12px',
      borderRadius: '7px',
      background: 'rgba(249,115,22,.1)',
      border: '1px solid rgba(249,115,22,.28)',
      color: '#f97316',
      fontSize: '12px',
      fontWeight: '600',
      fontFamily: 'system-ui,sans-serif',
      cursor: 'pointer',
      margin: '4px',
      transition: 'all .14s',
    });

    btn.onmouseenter = () => { btn.style.background = 'rgba(249,115,22,.2)'; };
    btn.onmouseleave = () => { btn.style.background = 'rgba(249,115,22,.1)'; };

    btn.onclick = async () => {
      const prompt = getPrompt();
      const response = getResponse();
      if (!prompt && !response) { flash(btn, 'Nothing yet', '#71717a'); return; }
      flash(btn, 'Saving…', '#f97316');
      const r = await captureSession({ model: detectModel(), prompt: prompt || '', response: response || '' });
      if (r?.ok) flash(btn, '✓ Saved', '#22c55e');
      else flash(btn, 'Error', '#ef4444');
    };

    anchor.appendChild(btn);
  };

  tryInject();
  new MutationObserver(tryInject).observe(document.body, { childList: true, subtree: true });
  [1000, 3000, 6000].forEach(t => setTimeout(tryInject, t));
}

function flash(btn, text, color) {
  const orig = btn.innerHTML;
  btn.textContent = text;
  btn.style.color = color;
  setTimeout(() => { btn.innerHTML = orig; btn.style.color = '#f97316'; }, 2200);
}

function iconSVG(sz) {
  return `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;
}

// ThreadOS Sentinel — Gemini Content Script

let lastTurn = '';

const getUser = () => {
  for (const sel of ['user-chunk .query-text', '.user-query-container', '[class*="user-message"]']) {
    const els = document.querySelectorAll(sel);
    if (els.length) return els[els.length - 1]?.textContent?.trim() || '';
  }
  return '';
};

const getAssistant = () => {
  for (const sel of ['model-response .markdown', '.model-response-text', '[class*="model-response"]']) {
    const els = document.querySelectorAll(sel);
    if (els.length) return els[els.length - 1]?.textContent?.trim() || '';
  }
  return '';
};

function startCapture() {
  new MutationObserver(() => {
    const p = getUser(), r = getAssistant();
    if (!p || !r) return;
    const key = p.slice(-40) + r.slice(-40);
    if (key === lastTurn) return;
    clearTimeout(window.__tos_t);
    window.__tos_t = setTimeout(() => {
      const finalR = getAssistant();
      const finalKey = p.slice(-40) + finalR.slice(-40);
      if (finalKey === lastTurn || !finalR) return;
      lastTurn = finalKey;
      captureSession({ model: 'Gemini', prompt: p, response: finalR });
    }, 2000);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

function init() {
  injectPanel();
  injectSaveButton('prompt-chip', getUser, getAssistant);
  startCapture();
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', () => setTimeout(init, 800))
  : setTimeout(init, 800);
})();
