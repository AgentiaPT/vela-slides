// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
/**
 * Vela Desktop — Main entry point.
 *
 * Initializes the desktop bridge (Tauri IPC), then mounts the Vela React app.
 * The vela.jsx monolith is imported and its App component rendered into #root.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';

// Initialize desktop bridge BEFORE loading the Vela app
// This sets up window.storage, agent routing, and file handling
import './desktop-bridge.js';

// Import the Vela monolith — Vite resolves this via the @vela alias
// The monolith exports the App component at module scope
// Note: We need to dynamically import since vela.jsx expects certain globals
async function init() {
  try {
    // Wait a tick for Tauri bridge to be ready
    await new Promise(resolve => setTimeout(resolve, 50));

    // Dynamically import the Vela app
    // vela.jsx uses React and lucide-react as imports (handled by Vite)
    const velaModule = await import('@vela/vela.jsx');

    // The App component should be the default or named export
    const App = velaModule.default || velaModule.App;

    if (!App) {
      console.error('[vela-desktop] Could not find App component in vela.jsx');
      document.getElementById('vela-loading').querySelector('.msg').textContent = 'Error loading app';
      return;
    }

    // Mount React app
    const rootEl = document.getElementById('root');
    const root = createRoot(rootEl);
    root.render(React.createElement(App));

    console.log('[vela-desktop] App mounted successfully');
  } catch (e) {
    console.error('[vela-desktop] Failed to initialize:', e);
    const msgEl = document.getElementById('vela-loading')?.querySelector('.msg');
    if (msgEl) {
      msgEl.textContent = 'Failed to load: ' + e.message;
      msgEl.style.color = '#ef4444';
    }
  }
}

init();
