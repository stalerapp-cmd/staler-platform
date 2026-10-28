import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ps.staler.wallet',
  appName: 'S-Taler',
  webDir: 'dist',
  server: { androidScheme: 'https', cleartext: false },
  android: { allowMixedContent: false, captureInput: true, webContentsDebuggingEnabled: false },
  plugins: {
    SplashScreen: { launchShowDuration: 900, backgroundColor: '#141B3D', showSpinner: false },
  },
};

export default config;
