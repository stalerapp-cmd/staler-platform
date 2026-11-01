/** Turns a browser's user-agent text into words a person recognises. */
export interface DeviceInfo {
  kind: 'phone' | 'tablet' | 'computer';
  browser: string;
  os: string;
  app: boolean;
}

export function parseDevice(ua: string | null | undefined): DeviceInfo {
  const s = ua ?? '';
  const app = /S-?Taler|TalerBank|Capacitor|; wv\)/i.test(s);
  const tablet = /iPad|Tablet|Android(?!.*Mobile)/i.test(s);
  const phone = !tablet && /Mobile|iPhone|Android/i.test(s);
  const v = (re: RegExp) => s.match(re)?.[1]?.split('.')[0];
  let os = '';
  if (/iPhone|iPad|iPod/.test(s)) os = `iOS ${(s.match(/OS (\d+)[_.](\d+)?/) ?? []).slice(1).filter(Boolean).join('.')}`.trim();
  else if (/Android/.test(s)) os = `Android ${v(/Android ([\d.]+)/) ?? ''}`.trim();
  else if (/Windows NT 10/.test(s)) os = 'Windows';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/Mac OS X/.test(s)) os = 'macOS';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Linux/.test(s)) os = 'Linux';
  let browser = '';
  if (/Edg\//.test(s)) browser = `Edge ${v(/Edg\/([\d.]+)/)}`;
  else if (/OPR\/|Opera/.test(s)) browser = `Opera ${v(/OPR\/([\d.]+)/) ?? ''}`.trim();
  else if (/SamsungBrowser/.test(s)) browser = `Samsung Internet ${v(/SamsungBrowser\/([\d.]+)/)}`;
  else if (/Firefox|FxiOS/.test(s)) browser = `Firefox ${v(/(?:Firefox|FxiOS)\/([\d.]+)/)}`;
  else if (/CriOS/.test(s)) browser = `Chrome ${v(/CriOS\/([\d.]+)/)}`;
  else if (/Chrome\//.test(s)) browser = `Chrome ${v(/Chrome\/([\d.]+)/)}`;
  else if (/Safari\//.test(s)) browser = `Safari ${v(/Version\/([\d.]+)/) ?? ''}`.trim();
  else if (/curl|node|undici|okhttp/i.test(s)) browser = s.split(/[ /]/)[0] ?? '';
  return { kind: tablet ? 'tablet' : phone ? 'phone' : 'computer', browser: browser || '—', os: os || '—', app };
}
