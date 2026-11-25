import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { testConnection } from './lib/firebase.ts';
import { ThemeProvider } from './lib/theme.tsx';
import './index.css';

// Run non-blocking Firebase connectivity check if Firebase auth is active
void testConnection();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </ErrorBoundary>
);
