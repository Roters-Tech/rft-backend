import { BadRequestException, NotFoundException, Logger } from '@nestjs/common';

const logger = new Logger('GoogleDriveUtil');

export interface GoogleDriveFileInfo {
  buffer: Buffer;
  filename: string;
  contentType: string;
  size: number;
}

export function extractGoogleDriveFileId(inputUrl: string): { fileId: string; type?: 'file' | 'document' | 'presentation' | 'spreadsheets' } | null {
  if (!inputUrl || typeof inputUrl !== 'string') return null;
  const trimmed = inputUrl.trim();

  // Google Docs
  const docMatch = trimmed.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/i);
  if (docMatch) return { fileId: docMatch[1], type: 'document' };

  // Google Slides
  const presMatch = trimmed.match(/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/i);
  if (presMatch) return { fileId: presMatch[1], type: 'presentation' };

  // Google Sheets
  const sheetMatch = trimmed.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/i);
  if (sheetMatch) return { fileId: sheetMatch[1], type: 'spreadsheets' };

  // Google Drive standard file /file/d/ID/view or similar
  const fileMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i);
  if (fileMatch) return { fileId: fileMatch[1], type: 'file' };

  // URL query parameter ?id=ID
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
  if (idMatch) return { fileId: idMatch[1], type: 'file' };

  // Standalone Google Drive File ID (typically 25-50 characters)
  if (/^[a-zA-Z0-9_-]{20,60}$/.test(trimmed)) {
    return { fileId: trimmed, type: 'file' };
  }

  return null;
}

export async function fetchGoogleDriveFile(urlOrId: string): Promise<GoogleDriveFileInfo> {
  const parsed = extractGoogleDriveFileId(urlOrId);
  if (!parsed) {
    throw new BadRequestException('Invalid Google Drive URL or File ID format.');
  }

  const { fileId, type } = parsed;

  const candidateUrls: string[] = [];
  if (type === 'document') {
    candidateUrls.push(`https://docs.google.com/document/d/${fileId}/export?format=pdf`);
  } else if (type === 'presentation') {
    candidateUrls.push(`https://docs.google.com/presentation/d/${fileId}/export/pdf`);
  } else if (type === 'spreadsheets') {
    candidateUrls.push(`https://docs.google.com/spreadsheets/d/${fileId}/export?format=pdf`);
  } else {
    // Standard file: try direct usercontent download, then uc export
    candidateUrls.push(`https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0`);
    candidateUrls.push(`https://drive.google.com/uc?export=download&id=${fileId}`);
  }

  logger.log(`Fetching Google Drive file: ${fileId} (${type || 'file'})`);

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'application/pdf,application/octet-stream,*/*',
  };

  let buffer: Buffer | null = null;
  let contentType = 'application/pdf';
  let filename = `drive_file_${fileId}.pdf`;
  let lastError = '';

  for (const downloadUrl of candidateUrls) {
    try {
      let res = await fetch(downloadUrl, {
        headers,
        redirect: 'follow',
      });

      let currentContentType = res.headers.get('content-type') || '';
      const disposition = res.headers.get('content-disposition') || '';

      const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i);
      if (filenameMatch && filenameMatch[1]) {
        filename = decodeURIComponent(filenameMatch[1].replace(/["']/g, '').trim());
      } else if (type === 'document' || type === 'presentation' || type === 'spreadsheets') {
        filename = `${type}_${fileId}.pdf`;
      }

      let arrayBuf = await res.arrayBuffer();
      let currentBuf = Buffer.from(arrayBuf);

      const isHtml =
        currentContentType.includes('text/html') ||
        currentBuf.slice(0, 50).toString('utf-8').toLowerCase().includes('<!doctype') ||
        currentBuf.slice(0, 50).toString('utf-8').toLowerCase().includes('<html');

      if (isHtml) {
        const htmlText = currentBuf.toString('utf-8');

        if (
          htmlText.includes('You need access') ||
          htmlText.includes('Access denied') ||
          htmlText.includes('accounts.google.com/ServiceLogin') ||
          htmlText.includes('ServiceLogin')
        ) {
          throw new BadRequestException(
            'Google Drive file is restricted or private. Please set sharing in Google Drive to "Anyone with the link can view", or use "Save as Direct Link".',
          );
        }

        if (
          htmlText.includes('File not found') ||
          htmlText.includes('Not Found') ||
          htmlText.includes('The requested URL was not found')
        ) {
          throw new NotFoundException('Google Drive file not found. Please verify the URL or link.');
        }

        // Virus scan warning confirmation
        const confirmMatch = htmlText.match(/confirm=([0-9a-zA-Z_-]+)/i);
        const actionMatch =
          htmlText.match(/action="([^"]+)"/i) ||
          htmlText.match(/id="uc-download-link"[^>]*href="([^"]+)"/i);

        if (confirmMatch || actionMatch) {
          let confirmUrl = '';
          if (actionMatch && actionMatch[1]) {
            confirmUrl = actionMatch[1].replace(/&amp;/g, '&');
            if (!confirmUrl.startsWith('http')) {
              confirmUrl = `https://drive.google.com${confirmUrl}`;
            }
          } else if (confirmMatch) {
            confirmUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmMatch[1]}`;
          }

          const cookie = res.headers.get('set-cookie') || '';
          const confirmRes = await fetch(confirmUrl, {
            headers: {
              ...headers,
              ...(cookie ? { Cookie: cookie } : {}),
            },
            redirect: 'follow',
          });

          if (confirmRes.ok) {
            const confirmBuf = Buffer.from(await confirmRes.arrayBuffer());
            const stillHtml =
              confirmBuf.slice(0, 50).toString('utf-8').toLowerCase().includes('<html') ||
              confirmBuf.slice(0, 50).toString('utf-8').toLowerCase().includes('<!doctype');
            if (!stillHtml && confirmBuf.length > 0) {
              buffer = confirmBuf;
              contentType = confirmRes.headers.get('content-type') || 'application/pdf';
              break;
            }
          }
        }

        // If it's still HTML and not handled above, record error and try next candidate
        lastError = 'Google Drive returned a web page instead of document bytes.';
        continue;
      }

      if (res.ok && currentBuf.length > 0) {
        buffer = currentBuf;
        contentType = currentContentType || 'application/pdf';
        break;
      }
    } catch (e: any) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) {
        throw e;
      }
      lastError = e?.message || 'Download error';
    }
  }

  if (!buffer || buffer.length === 0) {
    throw new BadRequestException(
      lastError ||
        'Unable to download file directly from Google Drive. Please ensure the file is set to "Anyone with the link can view", or use "Save as Direct Link".',
    );
  }

  // Ensure file has a valid extension
  if (!filename.toLowerCase().endsWith('.pdf') && !filename.includes('.')) {
    filename += '.pdf';
  }

  return {
    buffer,
    filename,
    contentType: contentType || 'application/pdf',
    size: buffer.length,
  };
}
