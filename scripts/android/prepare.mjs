#!/usr/bin/env node
/**
 * Hardens the Capacitor-generated Android project before it is built.
 * Usage: node scripts/android/prepare.mjs <app-dir> <deep-link-scheme>
 *
 *  - android:allowBackup="false"   (tokens never end up in cloud/adb backups)
 *  - android:usesCleartextTraffic="false" + network security config (HTTPS only)
 *  - CAMERA permission for QR scanning, nothing else
 *  - deep links for the app's own scheme (taler:// or talerbank://)
 *  - FLAG_SECURE on the main activity (no screenshots / recents thumbnails of balances)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [appDir, scheme] = process.argv.slice(2);
if (!appDir || !scheme || !/^[a-z][a-z0-9+.-]*$/.test(scheme)) {
  console.error('usage: prepare.mjs <app-dir> <scheme>');
  process.exit(2);
}
const android = join(appDir, 'android');
const main = join(android, 'app/src/main');
const manifestPath = join(main, 'AndroidManifest.xml');
if (!existsSync(manifestPath)) throw new Error(`${manifestPath} not found — run "npx cap add android" first`);

const capConfig = readFileSync(join(appDir, 'capacitor.config.ts'), 'utf8');
const appId = /appId:\s*'([a-z0-9_.]+)'/i.exec(capConfig)?.[1];
if (!appId) throw new Error('appId not found in capacitor.config.ts');

// ---------------------------------------------------------------- manifest
let m = readFileSync(manifestPath, 'utf8');
const setAttr = (tag, attr, value) => {
  const re = new RegExp(`(<${tag}\\b[^>]*?)\\s${attr.replace(':', '\\:')}="[^"]*"`);
  if (re.test(m)) m = m.replace(re, `$1 ${attr}="${value}"`);
  else m = m.replace(new RegExp(`<${tag}\\b`), `<${tag} ${attr}="${value}"`);
};
setAttr('application', 'android:allowBackup', 'false');
setAttr('application', 'android:usesCleartextTraffic', 'false');
setAttr('application', 'android:networkSecurityConfig', '@xml/network_security_config');

if (!m.includes('android.permission.CAMERA')) {
  m = m.replace(
    /(<uses-permission android:name="android.permission.INTERNET"\s*\/>)/,
    `$1\n    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />`,
  );
}
if (!m.includes(`android:scheme="${scheme}"`)) {
  m = m.replace(
    /(<activity\b[\s\S]*?<\/intent-filter>)/,
    `$1\n\n            <intent-filter>\n                <action android:name="android.intent.action.VIEW" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <category android:name="android.intent.category.BROWSABLE" />\n                <data android:scheme="${scheme}" />\n            </intent-filter>`,
  );
}
writeFileSync(manifestPath, m);

// ------------------------------------------------- network security config
const xmlDir = join(main, 'res/xml');
mkdirSync(xmlDir, { recursive: true });
writeFileSync(
  join(xmlDir, 'network_security_config.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`,
);

// ------------------------------------------------------------ MainActivity
const pkgPath = join(main, 'java', ...appId.split('.'));
mkdirSync(pkgPath, { recursive: true });
writeFileSync(
  join(pkgPath, 'MainActivity.java'),
  `package ${appId};

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Balances and codes must not leak into screenshots or the recents screen.
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
    }
}
`,
);

console.log(`hardened ${android} (${appId}, ${scheme}://)`);
