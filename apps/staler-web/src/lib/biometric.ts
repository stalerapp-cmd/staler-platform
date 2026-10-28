import { Preferences } from '@capacitor/preferences';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { isNative } from './api';

const KEY = 'st.bio';
const ASKED = 'st.bio.asked';

/** Fingerprint / face / phone PIN unlock — Android app only. */
export async function bioAvailable(): Promise<boolean> {
  if (!isNative) return false;
  try {
    const r = await BiometricAuth.checkBiometry();
    return r.isAvailable || r.deviceIsSecure;
  } catch {
    return false;
  }
}
export async function bioEnabled(): Promise<boolean> {
  if (!isNative) return false;
  return (await Preferences.get({ key: KEY })).value === '1';
}
export async function setBioEnabled(on: boolean) {
  await Preferences.set({ key: KEY, value: on ? '1' : '0' });
  await Preferences.set({ key: ASKED, value: '1' });
}
export async function bioAsked(): Promise<boolean> {
  return (await Preferences.get({ key: ASKED })).value === '1';
}
/** Resolves when the person proved it's them; throws if they cancelled or failed. */
export async function bioVerify(o: { title: string; reason: string; cancel: string }) {
  await BiometricAuth.authenticate({
    reason: o.reason,
    cancelTitle: o.cancel,
    allowDeviceCredential: true,
    androidTitle: o.title,
    androidSubtitle: o.reason,
    androidConfirmationRequired: false,
  });
}
