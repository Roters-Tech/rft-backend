import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import ws from 'ws';

@Injectable()
export class SupabaseStorageService {
  private supabase: SupabaseClient;
  private readonly logger = new Logger(SupabaseStorageService.name);
  private bucketName = 'academic-content';
  private uploadsDir = path.join(process.cwd(), 'uploads');

  constructor() {
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }

    const supabaseUrl = process.env.SUPABASE_URL || 'https://phutsvgmbcmyraxsjyoy.supabase.co';
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_KEY ||
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBodXRzdmdtYmNteXJheHNqeW95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEzODU5NDksImV4cCI6MjA1Njk2MTk0OX0';

    this.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: ws as any },
    });
    this.ensureBucket();
  }

  private async ensureBucket() {
    try {
      const { data: buckets } = await this.supabase.storage.listBuckets();
      const exists = buckets?.some((b) => b.name === this.bucketName);
      if (!exists) {
        await this.supabase.storage.createBucket(this.bucketName, {
          public: true,
          allowedMimeTypes: [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
            'image/png',
            'image/jpeg',
          ],
        });
        this.logger.log(`Created public Supabase storage bucket: ${this.bucketName}`);
      }
    } catch (err: any) {
      this.logger.warn(`Could not verify bucket presence: ${err.message}`);
    }
  }

  async uploadFile(file: Express.Multer.File): Promise<string> {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${uniqueSuffix}-${safeName}`;

    let fileBuffer: Buffer;
    if (file.buffer) {
      fileBuffer = file.buffer;
    } else if (file.path && fs.existsSync(file.path)) {
      fileBuffer = fs.readFileSync(file.path);
    } else {
      throw new Error('File content missing in upload payload');
    }

    try {
      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .upload(fileName, fileBuffer, {
          contentType: file.mimetype || 'application/octet-stream',
          upsert: true,
        });

      if (!error && data) {
        const { data: publicUrlData } = this.supabase.storage
          .from(this.bucketName)
          .getPublicUrl(fileName);

        this.logger.log(`Uploaded file to Supabase Storage: ${publicUrlData.publicUrl}`);
        return publicUrlData.publicUrl;
      }

      this.logger.warn(`Supabase Storage upload returned error: ${error?.message || 'Unknown'}. Saving locally.`);
    } catch (err: any) {
      this.logger.warn(`Supabase Storage exception: ${err.message}. Saving locally.`);
    }

    // Local disk fallback
    const localFilePath = path.join(this.uploadsDir, fileName);
    fs.writeFileSync(localFilePath, fileBuffer);
    const port = process.env.PORT || 3006;
    const baseUrl =
      process.env.APP_URL ||
      (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`);
    const localUrl = `${baseUrl}/uploads/${fileName}`;
    this.logger.log(`Saved file: ${localUrl}`);
    return localUrl;
  }
}
