// Bootstrap the React chat surface into the document.
//
// Paper steps 1 and 12 live in App.tsx; this file only mounts the tree.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('no root element');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
