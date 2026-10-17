import { Controller, Get, Post, Body, Patch, Param, Query, UseGuards, Req, Delete } from '@nestjs/common';
import { CoursesService } from './courses.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller()
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get('courses/public')
  findPublic(@Query('schoolId') schoolId?: string) {
    return this.coursesService.findAllStudent({ schoolId });
  }

  // Admin scopes
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN, Role.LECTURER)
  @Post('admin/courses')
  create(@Req() req: any, @Body() data: any) {
    return this.coursesService.create(data, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN)
  @Get('admin/courses')
  findAllAdmin(@Req() req: any) {
    return this.coursesService.findAllAdmin(req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN)
  @Patch('admin/courses/:id')
  update(@Param('id') id: string, @Body() data: any) {
    return this.coursesService.update(id, data);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN)
  @Delete('admin/courses/:id')
  delete(@Param('id') id: string) {
    return this.coursesService.delete(id);
  }

  // Student & Lecturer scopes
  @UseGuards(JwtAuthGuard)
  @Get('courses')
  findAllStudent(@Req() req: any, @Query('schoolId') schoolId?: string, @Query('lecturerId') lecturerId?: string) {
    return this.coursesService.findAllStudent({ schoolId, lecturerId }, req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('courses/my-courses')
  getMyCourses(@Req() req: any) {
    return this.coursesService.getMyCourses(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('courses/:id/enroll')
  enroll(@Req() req: any, @Param('id') courseId: string) {
    return this.coursesService.enroll(req.user.id, courseId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('courses/:id/enroll')
  unenroll(@Req() req: any, @Param('id') courseId: string) {
    return this.coursesService.unenroll(req.user.id, courseId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('courses/:id/students')
  getEnrolledStudents(@Param('id') courseId: string) {
    return this.coursesService.getEnrolledStudents(courseId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('courses/:id')
  findOne(@Param('id') id: string) {
    return this.coursesService.findOne(id);
  }
}

