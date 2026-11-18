import { Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';

const logger = new Logger('PdfCompressor');

export async function compressPdfBuffer(buffer: Buffer): Promise<Buffer> {
  try {
    if (!buffer || buffer.length === 0) return buffer;

    // Verify it starts with PDF magic bytes %PDF-
    const header = buffer.subarray(0, 5).toString('ascii');
    if (!header.startsWith('%PDF-')) {
      return buffer;
    }

    const loadedDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const cleanDoc = await PDFDocument.create();

    const pageIndices = loadedDoc.getPageIndices();
    const copiedPages = await cleanDoc.copyPages(loadedDoc, pageIndices);
    for (const page of copiedPages) {
      cleanDoc.addPage(page);
    }

    // Save with object streams to compact internal structures
    const compressedBytes = await cleanDoc.save({ useObjectStreams: true });
    const compressedBuffer = Buffer.from(compressedBytes);

    if (compressedBuffer.length < buffer.length) {
      const reduction = Math.round(((buffer.length - compressedBuffer.length) / buffer.length) * 100);
      logger.log(`PDF compressed: ${buffer.length} -> ${compressedBuffer.length} bytes (${reduction}% reduction)`);
      return compressedBuffer;
    }

    return buffer;
  } catch (err: any) {
    logger.warn(`Could not compress PDF (using original buffer): ${err?.message || err}`);
    return buffer;
  }
}

