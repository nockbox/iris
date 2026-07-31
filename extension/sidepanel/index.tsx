document.documentElement.classList.add('sidepanel');

import { createRoot } from 'react-dom/client';
import { Popup } from '../popup/Popup';
import { ThemeProvider } from '../popup/contexts/ThemeContext';

import '@fontsource/lora/400.css';
import '@fontsource/lora/500.css';
import '@fontsource/lora/600.css';
import '../popup/styles.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <ThemeProvider>
      <Popup />
    </ThemeProvider>
  );
}
