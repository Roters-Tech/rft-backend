import { Controller, Get, Post, Query, Param, Patch, Delete, Body, UseGuards, Request, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller(['admin/users', 'users'])
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Post('upload-document')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, callback) => {
      if (!file.mimetype.match(/\/(pdf|png|jpeg|jpg|docx|msword)$/i) && !file.originalname.match(/\.(pdf|png|jpg|jpeg|doc|docx)$/i)) {
        return callback(new BadRequestException('Only PDF, PNG, JPG, or DOC documents are allowed (Max 10MB)!'), false);
      }
      callback(null, true);
    },
  }))
  async uploadDocument(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No document file provided');
    }
    return this.usersService.uploadDocument(file);
  }

  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN)
  @Post()
  createUser(@Request() req: any, @Body() dto: { fullName: string; email: string; schoolId?: string; departmentId?: string; phoneNumber?: string; role?: Role }) {
    const schoolId = req.user.role === Role.SCHOOL_ADMIN ? req.user.schoolId : (dto.schoolId || req.user.schoolId);
    return this.usersService.createUser({ ...dto, schoolId });
  }

  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN)
  @Post('lecturers')
  createLecturerAlias(@Request() req: any, @Body() dto: { fullName: string; email: string; schoolId?: string; departmentId?: string; phoneNumber?: string; role?: Role }) {
    const schoolId = req.user.role === Role.SCHOOL_ADMIN ? req.user.schoolId : (dto.schoolId || req.user.schoolId);
    return this.usersService.createUser({ ...dto, schoolId, role: Role.LECTURER });
  }

  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN, Role.LECTURER)
  @Get()
  findAll(
    @Request() req: any,
    @Query('role') role?: Role,
    @Query('schoolId') querySchoolId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('search') search?: string,
  ) {
    const schoolId = req.user.role === Role.SCHOOL_ADMIN ? req.user.schoolId : (querySchoolId || req.user.schoolId);
    return this.usersService.findAll({ role, schoolId, departmentId, search });
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Request() req: any) {
    const userId = req.user.id || req.user.userId;
    return this.usersService.getProfile(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req: any) {
    const userId = req.user.id || req.user.userId;
    return this.usersService.getProfile(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateMe(@Request() req: any, @Body() dto: any) {
    const userId = req.user.id || req.user.userId;
    return this.usersService.updateProfile(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  updateProfile(@Request() req: any, @Body() dto: any) {
    const userId = req.user.id || req.user.userId;
    return this.usersService.updateProfile(userId, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN, Role.LECTURER)
  @Patch(':id/courses')
  updateCourses(@Param('id') id: string, @Body() body: { courseIds?: string[]; customCourse?: string }) {
    return this.usersService.updateLecturerCourses(id, body.courseIds || [], body.customCourse);
  }

  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN)
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.usersService.updateUserStatus(id, status);
  }

  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN, Role.LECTURER)
  @Patch(':id')
  updateUser(@Param('id') id: string, @Body() dto: any, @Request() req: any) {
    // If lecturer is updating themselves
    const currentUserId = req.user.id || req.user.userId;
    if (req.user.role === Role.LECTURER && currentUserId === id) {
      return this.usersService.updateProfile(id, dto);
    }
    return this.usersService.updateUser(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('push-token')
  savePushToken(@Request() req: any, @Body('pushToken') pushToken: string) {
    return this.usersService.savePushToken(req.user.id, pushToken);
  }

  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN)
  @Delete(':id')
  removeUser(@Param('id') id: string) {
    return this.usersService.removeUser(id);
  }
}
