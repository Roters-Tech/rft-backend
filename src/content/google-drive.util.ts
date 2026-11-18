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
  let downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  if (type === 'document') {
    downloadUrl = `https://docs.google.com/document/d/${fileId}/export?format=pdf`;
  } else if (type === 'presentation') {
    downloadUrl = `https://docs.google.com/presentation/d/${fileId}/export/pdf`;
  } else if (type === 'spreadsheets') {
    downloadUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=pdf`;
  }

  logger.log(`Fetching Google Drive file: ${fileId} (${type || 'file'})`);

  let res = await fetch(downloadUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    redirect: 'follow',
  });

  let contentType = res.headers.get('content-type') || '';

  // Google returns an HTML warning interstitial for large files (virus scan warning)
  if (contentType.includes('text/html')) {
    const htmlText = await res.text();

    if (
      htmlText.includes('You need access') ||
      htmlText.includes('Access denied') ||
      htmlText.includes('accounts.google.com/ServiceLogin')
    ) {
      throw new BadRequestException(
        'Google Drive file is private. Please update sharing permissions to "Anyone with the link can view".',
      );
    }

    if (
      htmlText.includes('File not found') ||
      htmlText.includes('Not Found') ||
      htmlText.includes("The requested URL was not found")
    ) {
      throw new NotFoundException('Google Drive file not found. Please verify the URL or ID.');
    }

    // Look for confirmation token
    const confirmMatch = htmlText.match(/confirm=([0-9a-zA-Z_-]+)/i);
    const actionMatch = htmlText.match(/action="([^"]+)"/i) || htmlText.match(/id="uc-download-link"[^>]*href="([^"]+)"/i);

    if (confirmMatch || actionMatch) {
      let confirmUrl = '';
      if (actionMatch && actionMatch[1]) {
        confirmUrl = actionMatch[1].replace(/&amp;/g, '&');
        if (!confirmUrl.startsWith('http')) {
          confirmUrl = `https://drive.google.com${confirmUrl}`;
        }
      } else if (confirmMatch) {
        confirmUrl = `https://drive.google.com/uc?export=download&confirm=${confirmMatch[1]}&id=${fileId}`;
      }

      const cookie = res.headers.get('set-cookie') || '';
      res = await fetch(confirmUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        redirect: 'follow',
      });
      contentType = res.headers.get('content-type') || '';
    }
  }

  if (!res.ok) {
    throw new BadRequestException(`Google Drive download failed with HTTP status ${res.status}`);
  }

  // Determine filename
  const disposition = res.headers.get('content-disposition') || '';
  let filename = `drive_file_${fileId}.pdf`;

  const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i);
  if (filenameMatch && filenameMatch[1]) {
    filename = decodeURIComponent(filenameMatch[1].replace(/["']/g, '').trim());
  } else if (type === 'document' || type === 'presentation' || type === 'spreadsheets') {
    filename = `${type}_${fileId}.pdf`;
  }

  // Ensure file has valid extension
  if (!filename.toLowerCase().endsWith('.pdf') && !filename.includes('.')) {
    filename += '.pdf';
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return {
    buffer,
    filename,
    contentType: contentType || 'application/pdf',
    size: buffer.length,
  };
}

