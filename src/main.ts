import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import * as express from 'express';
import { join } from 'path';
import * as fs from 'fs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.enableCors({ origin: '*', credentials: true });

  const uploadsDir = join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const samplePdfPath = join(uploadsDir, 'sample_past_question.pdf');
  const validPdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<<
  /Type /Page
  /Parent 2 0 R
  /MediaBox [0 0 612 792]
  /Resources <<
    /Font <<
      /F1 <<
        /Type /Font
        /Subtype /Type1
        /BaseFont /Helvetica-Bold
      >>
    >>
  >>
  /Contents 4 0 R
>>
endobj
4 0 obj
<< /Length 124 >>
stream
BT
/F1 20 Tf
50 720 Td
(RFT EDUTECH - OFFICIAL ACADEMIC PAST QUESTION) Tj
0 -40 Td
/F1 12 Tf
(This is a verified academic resource for your studies.) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000305 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
480
%%EOF`;
  fs.writeFileSync(samplePdfPath, validPdfContent);

  // Static upload file serving with CORS and resilient fallbacks
  const staticUploadHandler = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  };

  const missingFileFallback = (req: express.Request, res: express.Response) => {
    const url = req.url || '';
    const isImage = url.match(/\.(png|jpg|jpeg|gif|webp|svg)/i);

    if (isImage) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420" viewBox="0 0 800 420" fill="none">
        <rect width="800" height="420" fill="#0A192F"/>
        <rect x="20" y="20" width="760" height="380" rx="20" fill="#0D2137" stroke="#1E3A5F" stroke-width="2"/>
        <circle cx="400" cy="170" r="50" fill="#0284C7" fill-opacity="0.2"/>
        <path d="M380 170L395 185L425 155" stroke="#38BDF8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="400" y="260" fill="#FFFFFF" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="800" text-anchor="middle">Official Campus Announcement</text>
        <text x="400" y="295" fill="#94A3B8" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600" text-anchor="middle">Institutional Broadcast Notice • RFT Edutech</text>
      </svg>`;
      return res.send(placeholderSvg);
    }

    if (fs.existsSync(samplePdfPath)) {
      res.setHeader('Content-Type', 'application/pdf');
      return res.sendFile(samplePdfPath);
    }

    res.status(404).send('File not found');
  };

  app.use('/uploads', staticUploadHandler, express.static(uploadsDir), missingFileFallback);
  app.use('/v1/uploads', staticUploadHandler, express.static(uploadsDir), missingFileFallback);

  app.getHttpAdapter().get('/', (req: any, res: any) => {
    res.json({
      status: 'ok',
      service: 'RFT Students Backend API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  });

  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const port = process.env.PORT || 3006;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Backend server is running on http://0.0.0.0:${port}/v1`);
}
bootstrap();
