// ThreadOS Drift Sentinel — Background Service Worker
import { ThreadStore } from './storage/threadStore.js';
import { analyzeDrift } from './drift/analyzer.js';

const genId = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

// ── MESSAGE ROUTER ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  dispatch(msg, sender)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }));
  return true;
});

async function dispatch(msg, sender) {
  const { type, payload = {} } = msg;

  switch (type) {

    case 'CAPTURE_SESSION': {
      const { threadId, session } = payload;

      // Auto-create thread on first capture if none set
      let thread = await ThreadStore.getThread(threadId);
      if (!thread) {
        const model = session.model || 'Unknown';
        thread = await ThreadStore.createThread({
          id: threadId,
          title: `${model} Thread`,
          brief: '',
          constraints: [],
          sessions: [],
          driftFlags: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      const prev = thread.sessions[thread.sessions.length - 1] || null;
      const drift = prev ? analyzeDrift(prev, session, thread) : {
        drift: false, severity: 'none', reason: 'First session', score: 100, flags: []
      };

      const stored = {
        ...session,
        id: genId(),
        drift,
        capturedAt: Date.now(),
      };

      await ThreadStore.addSession(threadId, stored);

      if (drift.drift) {
        await ThreadStore.addDriftFlag(threadId, {
          id: genId(),
          sessionId: stored.id,
          severity: drift.severity,
          reason: drift.reason,
          score: drift.score,
          flags: drift.flags,
          timestamp: Date.now(),
        });
      }

      // Update badge
      updateBadge(sender.tab?.id, drift);

      return { ok: true, session: stored, drift };
    }

    case 'CREATE_THREAD': {
      const t = await ThreadStore.createThread({
        id: genId(),
        title: payload.title || 'New Thread',
        brief: payload.brief || '',
        constraints: payload.constraints || [],
        sessions: [],
        driftFlags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { ok: true, thread: t };
    }

    case 'GET_THREADS':
      return { ok: true, threads: await ThreadStore.getAllThreads() };

    case 'GET_THREAD': {
      const t = await ThreadStore.getThread(payload.threadId);
      return { ok: true, thread: t };
    }

    case 'UPDATE_THREAD': {
      const t = await ThreadStore.updateThread(payload.threadId, payload.changes);
      return { ok: true, thread: t };
    }

    case 'DELETE_THREAD':
      await ThreadStore.deleteThread(payload.threadId);
      return { ok: true };

    case 'EXPORT_THREAD': {
      const t = await ThreadStore.getThread(payload.threadId);
      return { ok: true, json: JSON.stringify(t, null, 2) };
    }

    case 'USAGE': {
      const bytes = await ThreadStore.usage();
      return { ok: true, bytes };
    }

    case 'CLEAR_ALL':
      await ThreadStore.clearAll();
      return { ok: true };

    default:
      return { error: `Unknown type: ${type}` };
  }
}

// ── BADGE ────────────────────────────────────────────────────────────────────
function updateBadge(tabId, drift) {
  if (!tabId) return;
  const color = {
    high: '#ef4444',
    medium: '#eab308',
    low: '#3b82f6',
    none: '#22c55e',
  }[drift.severity] || '#71717a';

  chrome.action.setBadgeBackgroundColor({ color, tabId });
  chrome.action.setBadgeText({
    text: drift.drift ? '!' : '',
    tabId,
  });
}

// ── INIT ─────────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') await ThreadStore.init();
  console.log('[ThreadOS Sentinel] Ready');
});
