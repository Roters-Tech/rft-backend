import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AnnouncementsService } from './announcements.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('announcements')
@UseGuards(JwtAuthGuard)
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('image', {
    fileFilter: (req, file, callback) => {
      // Allow images and common document attachments
      callback(null, true);
    }
  }))
  create(
    @Body() data: any,
    @Request() req: any,
    @UploadedFile() image?: Express.Multer.File
  ) {
    const authorId = req.user?.id || req.user?.userId;
    const schoolId = data.schoolId || req.user?.schoolId;
    return this.announcementsService.create({ ...data, schoolId }, authorId, image);
  }

  @Get()
  findAll(@Request() req: any) {
    return this.announcementsService.findAll(req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.announcementsService.findOne(id, req.user);
  }

  @Post(':id/like')
  toggleLike(@Param('id') id: string, @Request() req: any) {
    const userId = req.user?.userId || req.user?.id;
    return this.announcementsService.toggleLike(id, userId);
  }

  @Get(':id/comments')
  getComments(@Param('id') id: string, @Request() req: any) {
    const userId = req.user?.userId || req.user?.id;
    return this.announcementsService.getComments(id, userId);
  }

  @Post(':id/comments')
  addComment(
    @Param('id') id: string,
    @Body() dto: { text?: string; content?: string },
    @Request() req: any,
  ) {
    const authorId = req.user?.userId || req.user?.id;
    const content = dto.content || dto.text || '';
    return this.announcementsService.addComment(id, authorId, content);
  }

  @Post(':id/comments/:commentId/like')
  toggleCommentLike(@Param('commentId') commentId: string, @Request() req: any) {
    const userId = req.user?.userId || req.user?.id;
    return this.announcementsService.toggleCommentLike(commentId, userId);
  }

  @Post('comments/:commentId/like')
  toggleCommentLikeDirect(@Param('commentId') commentId: string, @Request() req: any) {
    const userId = req.user?.userId || req.user?.id;
    return this.announcementsService.toggleCommentLike(commentId, userId);
  }

  @Post(':id/comments/:commentId/reactions')
  reactToComment(
    @Param('commentId') commentId: string,
    @Body() dto: { emoji: string },
    @Request() req: any,
  ) {
    const userId = req.user?.userId || req.user?.id;
    return this.announcementsService.reactToComment(commentId, userId, dto.emoji);
  }

  @Post('comments/:commentId/reactions')
  reactToCommentDirect(
    @Param('commentId') commentId: string,
    @Body() dto: { emoji: string },
    @Request() req: any,
  ) {
    const userId = req.user?.userId || req.user?.id;
    return this.announcementsService.reactToComment(commentId, userId, dto.emoji);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN, Role.LECTURER)
  @Patch(':id')
  @UseInterceptors(FileInterceptor('image', {
    fileFilter: (req, file, callback) => {
      if (!file.mimetype.match(/\/(jpg|jpeg|png|gif)$/)) {
        return callback(new BadRequestException('Only image files are allowed!'), false);
      }
      callback(null, true);
    }
  }))
  update(
    @Param('id') id: string,
    @Body() data: any,
    @Request() req: any,
    @UploadedFile() image?: Express.Multer.File
  ) {
    return this.announcementsService.update(id, data, image, req.user);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN, Role.LECTURER)
  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.announcementsService.remove(id, req.user);
  }
}
