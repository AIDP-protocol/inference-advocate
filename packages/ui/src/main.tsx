// Bootstrap the React chat surface into the document.
//
// Paper steps 1 and 12 live in App.tsx; this file only mounts the tree and applies the stored
// shell theme before first paint so a dark preference does not flash light.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, readThemePreference } from './theme';
import './styles.css';

applyTheme(readThemePreference());

const root = document.getElementById('root');
if (!root) throw new Error('no root element');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
