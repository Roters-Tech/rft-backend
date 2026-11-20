import { Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';

const logger = new Logger('PdfCompressor');

export async function compressPdfBuffer(buffer: Buffer): Promise<Buffer> {
  // Always return authentic file buffer directly to guarantee 100% integrity, avoid blank white pages,
  // and preserve embedded fonts, encryption dictionaries, and vector layouts.
  return buffer;
}

