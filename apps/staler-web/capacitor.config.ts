import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ps.staler.wallet',
  appName: 'S-Taler',
  webDir: 'dist',
  server: { androidScheme: 'https', cleartext: false },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    // Android 15+ draws apps edge-to-edge: keep content clear of the status and navigation bars.
    adjustMarginsForEdgeToEdge: 'auto',
  },
  plugins: {
    SplashScreen: { launchShowDuration: 900, backgroundColor: '#141B3D', showSpinner: false },
  },
};

export default config;
