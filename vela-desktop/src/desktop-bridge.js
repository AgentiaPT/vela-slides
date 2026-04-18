// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
/**
 * Desktop Bridge — Adaptation layer between Vela React app and Tauri backend.
 *
 * This module:
 * 1. Provides window.storage polyfill using Tauri IPC
 * 2. Sets up VELA_LOCAL_MODE and agent routing
 * 3. Listens for file-open events from the native OS
 * 4. Provides agent status tracking
 */

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// ── Storage polyfill ──────────────────────────────────────────────
// Replaces localStorage-based polyfill from local.html with
// Tauri IPC calls to the Rust storage backend (~/.vela/storage/).

window.storage = {
  get: async function(key) {
    try {
      const value = await invoke('storage_get', { key });
      return value != null ? { value } : null;
    } catch (e) {
      console.warn('[vela-desktop] storage.get error:', e);
      return null;
    }
  },
  set: async function(key, value) {
    try {
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      await invoke('storage_set', { key, value: str });
    } catch (e) {
      console.warn('[vela-desktop] storage.set error:', e);
    }
  },
  delete: async function(key) {
    try {
      await invoke('storage_delete', { key });
    } catch (e) {
      console.warn('[vela-desktop] storage.delete error:', e);
    }
  }
};

// ── File handling ─────────────────────────────────────────────────

// Listen for file-open events from native OS (double-click .vela file)
listen('file-opened', (event) => {
  const path = event.payload;
  console.log('[vela-desktop] File opened from OS:', path);
  if (window.__velaReceiveDeckUpdate) {
    // Load the file via Tauri backend
    invoke('open_deck', { path }).then((deck) => {
      window.__velaReceiveDeckUpdate(deck);
      // Update window title
      const title = deck.deckTitle || deck.t || 'Untitled';
      document.title = `Vela — ${title}`;
    }).catch((e) => {
      console.error('[vela-desktop] Failed to open file:', e);
    });
  }
});

// ── Agent status ──────────────────────────────────────────────────

window.__velaDesktop = {
  isDesktop: true,

  // Get list of available agents
  getAgents: () => invoke('get_agents'),

  // Set active agent
  setActiveAgent: (agentType) => invoke('set_active_agent', { agentType }),

  // Complete via agent
  agentComplete: (system, messages, temperature, maxTokens) =>
    invoke('agent_complete', { system, messages, temperature, maxTokens }),

  // Health check
  agentHealth: () => invoke('agent_health'),

  // Test connection
  testAgentConnection: (agentType, port, model) =>
    invoke('test_agent_connection', { agentType, port, model }),

  // File operations
  openDeck: (path) => invoke('open_deck', { path }),
  saveDeck: (path, deck) => invoke('save_deck', { path, deck }),
  recentFiles: () => invoke('recent_files'),
  openFileDialog: () => invoke('open_file_dialog'),
  saveFileDialog: () => invoke('save_file_dialog'),

  // Settings
  getSettings: () => invoke('get_settings'),
  updateSettings: (partial) => invoke('update_settings', { partial }),
};

// Listen for agent changes
listen('agents-changed', (event) => {
  console.log('[vela-desktop] Agents changed:', event.payload);
  // Dispatch a custom DOM event so the React app can react
  window.dispatchEvent(new CustomEvent('vela-agents-changed', {
    detail: event.payload
  }));
});

console.log('[vela-desktop] Desktop bridge initialized');
