import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { Role } from '@prisma/client';
import { compressPdfBuffer } from './pdf-compressor.util';
import { fetchGoogleDriveFile } from './google-drive.util';

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly supabaseStorage: SupabaseStorageService,
  ) {}

  async create(data: any, userRole?: Role, userId?: string, file?: Express.Multer.File) {
    const defaultPrices = await this.settingsService.getPricingSettings();
    const type = data.type || 'resource';
    const defaultPrice =
      type === 'slides'
        ? defaultPrices.slidePrice
        : type === 'past_question'
        ? defaultPrices.pastQuestionPrice
        : defaultPrices.courseMaterialPrice;

    // Rule: Lecturer uploads automatically default to Paid
    let isPaid = data.isPaid !== undefined ? String(data.isPaid) === 'true' || data.isPaid === true : true;
    if (userRole === Role.LECTURER) {
      isPaid = true;
    }

    const price = isPaid ? (data.price && Number(data.price) > 0 ? Number(data.price) : defaultPrice) : 0;
    const rawExt = file ? file.originalname.split('.').pop()?.toLowerCase() : data.title ? data.title.split('.').pop()?.toLowerCase() : 'pdf';
    const fileExtension = rawExt && rawExt.length <= 5 ? rawExt : 'pdf';

    let downloadUrl = data.downloadUrl;
    if (file) {
      if (file.mimetype?.includes('pdf') || file.originalname.toLowerCase().endsWith('.pdf')) {
        file.buffer = await compressPdfBuffer(file.buffer);
      }
      downloadUrl = await this.supabaseStorage.uploadFile(file);
    } else if (!downloadUrl) {
      const port = process.env.PORT || 3006;
      const baseUrl =
        process.env.APP_URL ||
        (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`);
      downloadUrl = `${baseUrl}/uploads/sample_past_question.pdf`;
    }

    return this.prisma.content.create({
      data: {
        title: data.title,
        type,
        fileType: fileExtension,
        previewUrl: data.previewUrl || null,
        downloadUrl,
        visibility: data.visibility || 'public',
        isPaid,
        price,
        level: data.level || null,
        courseId: data.courseId || null,
        schoolId: data.schoolId || null,
        uploaderId: userId || data.uploaderId || null,
      },
      include: { course: true, school: true, uploader: { select: { id: true, fullName: true, role: true } } },
    });
  }

  async createBulk(items: any[], files: Express.Multer.File[], user: { id: string; role: Role; schoolId?: string }) {
    const results: any[] = [];
    const defaultPrices = await this.settingsService.getPricingSettings();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const itemData = items[i] || items[0] || {};
      const originalName = file.originalname;
      const fileExtension = originalName.split('.').pop()?.toLowerCase() || 'pdf';

      try {
        if (file.mimetype?.includes('pdf') || file.originalname.toLowerCase().endsWith('.pdf')) {
          file.buffer = await compressPdfBuffer(file.buffer);
        }

        const downloadUrl = await this.supabaseStorage.uploadFile(file);
        const title = itemData.title || originalName.replace(/\.[^/.]+$/, '');
        const type = itemData.type || 'resource';
        const defaultPrice =
          type === 'slides'
            ? defaultPrices.slidePrice
            : type === 'past_question'
            ? defaultPrices.pastQuestionPrice
            : defaultPrices.courseMaterialPrice;

        let isPaid = itemData.isPaid !== undefined ? Boolean(itemData.isPaid) : true;
        if (user.role === Role.LECTURER) {
          isPaid = true;
        }

        const price = isPaid ? (itemData.price && Number(itemData.price) > 0 ? Number(itemData.price) : defaultPrice) : 0;

        const created = await this.prisma.content.create({
          data: {
            title,
            type,
            fileType: fileExtension,
            downloadUrl,
            visibility: 'public',
            isPaid,
            price,
            level: itemData.level || null,
            courseId: itemData.courseId || null,
            schoolId: itemData.schoolId || user.schoolId || null,
            uploaderId: user.id,
          },
          include: { course: true, school: true },
        });

        results.push({
          filename: originalName,
          status: 'success',
          content: created,
        });
      } catch (err: any) {
        results.push({
          filename: originalName,
          status: 'failed',
          error: err.message || 'Failed to upload file',
        });
      }
    }

    return {
      total: files.length,
      successCount: results.filter((r) => r.status === 'success').length,
      failureCount: results.filter((r) => r.status === 'failed').length,
      results,
    };
  }

  async importFromGoogleDrive(body: any, user: { id: string; role: Role; schoolId?: string }) {
    if (!body.url || typeof body.url !== 'string') {
      throw new BadRequestException('Google Drive URL or File ID is required');
    }

    const fileInfo = await fetchGoogleDriveFile(body.url);
    const compressedBuffer = await compressPdfBuffer(fileInfo.buffer);
    const mockFile: Express.Multer.File = {
      buffer: compressedBuffer,
      originalname: fileInfo.filename,
      mimetype: fileInfo.contentType || 'application/pdf',
      size: compressedBuffer.length,
      fieldname: 'file',
      encoding: '7bit',
      stream: null as any,
      destination: '',
      filename: fileInfo.filename,
      path: '',
    };

    const title = body.title?.trim() || fileInfo.filename.replace(/\.[^/.]+$/, '');
    const schoolId = user.schoolId || body.schoolId || null;

    return this.create(
      {
        ...body,
        title,
        schoolId,
      },
      user.role,
      user.id,
      mockFile,
    );
  }

  async update(id: string, body: any, user: { id: string; role: Role; schoolId?: string }, file?: Express.Multer.File) {
    const existing = await this.prisma.content.findUnique({
      where: { id },
      include: { course: true, school: true },
    });
    if (!existing) {
      throw new NotFoundException('Content not found');
    }

    if (user.role === Role.LECTURER && existing.uploaderId !== user.id) {
      throw new ForbiddenException('You can only edit content that you uploaded');
    }
    if (user.role === Role.SCHOOL_ADMIN && existing.schoolId && user.schoolId && existing.schoolId !== user.schoolId) {
      throw new ForbiddenException('You can only edit content from your school');
    }

    const updateData: any = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.courseId !== undefined) updateData.courseId = body.courseId || null;
    if (body.level !== undefined) updateData.level = body.level || null;
    if (body.isPaid !== undefined) {
      updateData.isPaid = String(body.isPaid) === 'true' || body.isPaid === true;
    }
    if (body.price !== undefined) {
      updateData.price = Number(body.price) || 0;
    }

    if (file) {
      if (file.mimetype?.includes('pdf') || file.originalname.toLowerCase().endsWith('.pdf')) {
        file.buffer = await compressPdfBuffer(file.buffer);
      }
      const downloadUrl = await this.supabaseStorage.uploadFile(file);
      updateData.downloadUrl = downloadUrl;
      const rawExt = file.originalname.split('.').pop()?.toLowerCase();
      if (rawExt) updateData.fileType = rawExt;
    } else if (body.downloadUrl) {
      updateData.downloadUrl = body.downloadUrl;
    }

    return this.prisma.content.update({
      where: { id },
      data: updateData,
      include: {
        course: true,
        school: true,
        uploader: { select: { id: true, fullName: true, role: true } },
      },
    });
  }

  async updatePricing(id: string, dto: { isPaid?: boolean; price?: number }) {
    const existing = await this.prisma.content.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Content not found');

    const defaultPrices = await this.settingsService.getPricingSettings();
    const defaultPrice =
      existing.type === 'slides'
        ? defaultPrices.slidePrice
        : existing.type === 'past_question'
        ? defaultPrices.pastQuestionPrice
        : defaultPrices.courseMaterialPrice;

    const isPaid = dto.isPaid !== undefined ? dto.isPaid : existing.isPaid;
    const price = isPaid ? (dto.price !== undefined ? dto.price : existing.price || defaultPrice) : 0;

    return this.prisma.content.update({
      where: { id },
      data: { isPaid, price },
      include: { course: true, school: true, uploader: true },
    });
  }

  async findAll(query?: { uploaderId?: string; schoolId?: string; courseId?: string; type?: string }, user?: any) {
    const where: any = {};
    if (query?.uploaderId) where.uploaderId = query.uploaderId;
    if (user && user.role !== 'SUPER_ADMIN' && user.schoolId) {
      where.OR = [
        { schoolId: user.schoolId },
        { schoolId: null },
      ];
    } else if (query?.schoolId) {
      where.schoolId = query.schoolId;
    }
    if (query?.courseId) where.courseId = query.courseId;
    if (query?.type) where.type = query.type;

    return this.prisma.content.findMany({
      where,
      include: {
        course: {
          include: {
            department: {
              include: { faculty: true },
            },
          },
        },
        school: true,
        uploader: { select: { id: true, fullName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const content = await this.prisma.content.findUnique({
      where: { id },
      include: { course: true, school: true, uploader: { select: { id: true, fullName: true, role: true } } },
    });
    if (!content) throw new NotFoundException('Content not found');
    return content;
  }

  async remove(id: string, user?: { id: string; role: Role; schoolId?: string }) {
    const existing = await this.prisma.content.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Content not found');

    if (user) {
      if (user.role === Role.LECTURER && existing.uploaderId !== user.id) {
        throw new ForbiddenException('You can only delete content that you uploaded');
      }
      if (user.role === Role.SCHOOL_ADMIN && existing.schoolId && user.schoolId && existing.schoolId !== user.schoolId) {
        throw new ForbiddenException('You can only delete content from your school');
      }
    }

    return this.prisma.content.delete({ where: { id } });
  }
}
