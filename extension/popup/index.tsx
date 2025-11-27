/**
 * Popup entry point: Renders React app
 */

import { createRoot } from 'react-dom/client';
import { Popup } from './Popup';
import { ThemeProvider } from './contexts/ThemeContext';

import './styles.css';

import '@fontsource/lora/400.css';
import '@fontsource/lora/500.css';
import '@fontsource/lora/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <ThemeProvider>
      <Popup />
    </ThemeProvider>
  );
}
