import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { logger } from './logger.js';

export interface Licence {
  email: string;
  licence: string;
  order: string;
  viewOnly?: boolean;
}

/** Latin-only text for the standard PDF font (e-mails are ASCII; anything else is dropped). */
const ascii = (s: string) => s.replace(/[^\x20-\x7E]/g, '').slice(0, 120);

/**
 * Personalises a purchased file for one buyer. PDFs get, on every page:
 *  - a footer "Licensed to <e-mail> · <licence> · <date>",
 *  - a faint diagonal watermark with the same licence,
 *  - the licence in the document metadata (survives "print to PDF" of the text layer).
 * A copy shared online therefore always identifies the account it came from.
 * Other file types pass through unchanged (the licence is in the file name).
 */
export async function personalise(data: Buffer, mime: string, l: Licence): Promise<{ data: Buffer; mime: string }> {
  const isPdf = mime === 'application/pdf' || data.subarray(0, 5).toString() === '%PDF-';
  if (!isPdf) return { data, mime };
  try {
    const doc = await PDFDocument.load(data, { ignoreEncryption: false, updateMetadata: false });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const date = new Date().toISOString().slice(0, 10);
    const footer = ascii(`Licensed to ${l.email}  |  ${l.licence}  |  Order ${l.order}  |  ${date}  |  Sharing this file is not permitted`);
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      const size = Math.max(6, Math.min(8, width / 90));
      page.drawRectangle({ x: 0, y: 0, width, height: size + 8, color: rgb(1, 1, 1), opacity: 0.85 });
      page.drawText(footer, { x: 12, y: 5, size, font, color: rgb(0.35, 0.35, 0.4) });
      const mark = ascii(`${l.licence}  ${l.email}`);
      const markSize = Math.min(28, width / 22);
      page.drawText(mark, {
        x: width * 0.12,
        y: height * 0.3,
        size: markSize,
        font: bold,
        color: rgb(0.55, 0.55, 0.6),
        opacity: l.viewOnly ? 0.16 : 0.09,
        rotate: degrees(35),
      });
    }
    doc.setSubject(ascii(`Licensed copy ${l.licence} for ${l.email}`));
    doc.setKeywords([ascii(l.licence), ascii(l.email), `order-${ascii(l.order)}`]);
    doc.setProducer('S-Taler licensed copy');
    doc.setModificationDate(new Date());
    const out = await doc.save({ useObjectStreams: true });
    return { data: Buffer.from(out), mime: 'application/pdf' };
  } catch (err) {
    // Encrypted or malformed PDFs: deliver as-is rather than failing the buyer.
    logger.warn({ err: (err as Error).message }, 'pdf personalisation skipped');
    return { data, mime };
  }
}
