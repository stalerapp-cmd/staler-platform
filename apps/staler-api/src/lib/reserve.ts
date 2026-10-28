import crypto from 'node:crypto';

/** Crockford base32 — the alphabet GNU Taler uses for keys. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function crockford(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** A fresh Ed25519 reserve key pair (public: 52 chars, private: 32-byte seed as base32). */
export function newReserveKeypair(): { reservePub: string; reservePriv: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  return { reservePub: crockford(pub), reservePriv: crockford(priv) };
}
