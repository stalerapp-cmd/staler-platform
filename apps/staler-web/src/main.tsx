import { StrictMode } from 'react';
import { receiveNativeGoogle } from './components/GoogleButton';
import { createRoot } from 'react-dom/client';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import '@fontsource/reem-kufi/400.css';
import '@fontsource/reem-kufi/600.css';
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
import { CartProvider } from './components/Commerce';
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
  void StatusBar.setBackgroundColor({ color: '#141B3D' }).catch(() => {});
  // Android back button: navigate back inside the app, exit only from the root.
  void CapApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && location.pathname !== '/app') history.back();
    else void CapApp.exitApp();
  });
  // taler://google?code=… comes back from the Google sign-in page in the browser.
  void CapApp.addListener('appUrlOpen', ({ url }) => {
    if (receiveNativeGoogle(url)) {
      if (!/^\/(login|register)/.test(location.pathname)) location.assign('/login');
      return;
    }
    const m = /^taler:\/\/exchange-claim\?v=([^&]+)/i.exec(url);
    if (m) location.assign(`/app/claim?v=${m[1]}`);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
          <AuthProvider>
            <CartProvider>
              <App />
            </CartProvider>
          </AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
);
