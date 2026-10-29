import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import '@fontsource/amiri/400.css';
import '@fontsource/amiri/700.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import './styles/index.css';
import App from './App';
import { I18nProvider } from './lib/i18n';
import { ThemeProvider } from './lib/theme';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/Confirm';
import { apiUrl, isNative } from './lib/api';

// The app talks to a server that may be asleep (free hosting sleeps when idle).
// Wake it as soon as the app opens, so it's ready by the time a form is sent.
if (isNative) {
  const warm = () => void fetch(apiUrl('/health'), { cache: 'no-store' }).catch(() => {});
  warm();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') warm();
  });
}


if (isNative) {
  void StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  void StatusBar.setBackgroundColor({ color: '#0C1A17' }).catch(() => {});
  void CapApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && location.pathname !== '/app') history.back();
    else void CapApp.exitApp();
  });
  // talerbank://pay/<uuid> deep links open the pay screen.
  void CapApp.addListener('appUrlOpen', ({ url }) => {
    const m = /^talerbank:\/\/pay\/([0-9a-f-]{36})$/i.exec(url);
    if (m) location.assign(`/app/pay/${m[1]}`);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
);
