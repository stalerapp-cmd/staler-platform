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
import { translateValidity } from './lib/validity';

translateValidity();
import App from './App';
import { I18nProvider } from './lib/i18n';
import { ThemeProvider } from './lib/theme';
import { AuthProvider } from './lib/auth';
import { PrefsSync } from './components/PrefsSync';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/Confirm';
import { apiUrl, isNative } from './lib/api';
import { preloadPages } from './components/Boundary';

// The app talks to a server that may be asleep (free hosting sleeps when idle).
// Wake it as soon as the app opens, so it's ready by the time a form is sent.
// Theme and direction before anything paints (no light/LTR flash on open).
try {
  const th = localStorage.getItem('st.theme') ?? localStorage.getItem('tb.theme');
  if (th === 'dark' || th === 'light') document.documentElement.dataset.theme = th;
} catch {
  /* storage blocked */
}
// Android WebView repaints blurred (frosted) layers unevenly while scrolling, which shows as
// flicker; inside the app those layers get a solid tint instead.
if (isNative) document.documentElement.classList.add('native');

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

window.addEventListener('load', () => setTimeout(preloadPages, 1500), { once: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
          <AuthProvider>
            <PrefsSync />
            <App />
          </AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
);
