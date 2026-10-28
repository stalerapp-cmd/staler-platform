import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The Android app loads the bundle from https://localhost, so it carries its
 * own Content-Security-Policy that only allows talking to the configured API.
 * The web build relies on the (stricter, header-based) CSP of the API server.
 */
function nativeCsp(apiUrl: string): Plugin {
  return {
    name: 'native-csp',
    transformIndexHtml(html) {
      const api = new URL(apiUrl).origin;
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self' data:",
        `img-src 'self' data: blob: ${api} https://*.supabase.co`,
        `connect-src 'self' ${api}`,
        "media-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ');
      return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const native = mode === 'native';
  if (native && !env.VITE_API_URL) throw new Error('VITE_API_URL is required for the native (Android) build');
  return {
    plugins: [react(), ...(native ? [nativeCsp(env.VITE_API_URL!)] : [])],
    build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 900, cssCodeSplit: true },
    server: {
      port: 5173,
      proxy: { '/api': 'http://localhost:5000', '/files': 'http://localhost:5000' },
    },
    test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], css: false },
  };
});
