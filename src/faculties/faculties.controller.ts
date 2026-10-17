import { Controller, Get, Post, Body, Patch, Delete, Param, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { FacultiesService } from './faculties.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller()
export class FacultiesController {
  constructor(private readonly facultiesService: FacultiesService) {}

  // Public endpoint to fetch faculties
  @Get('faculties/public')
  async findPublicFaculties(@Query('schoolId') schoolId?: string) {
    if (schoolId) {
      return this.facultiesService.findAllBySchool(schoolId);
    }
    return this.facultiesService.findAllPublic();
  }

  // Public endpoint to fetch departments
  @Get('departments/public')
  async findPublicDepartments(@Query('facultyId') facultyId?: string) {
    return this.facultiesService.findAllPublicDepartments(facultyId);
  }

  // GET /v1/admin/faculties
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN, Role.LECTURER)
  @Get('admin/faculties')
  async findAll(@Request() req: any, @Query('schoolId') querySchoolId?: string) {
    const schoolId = (req.user.role === Role.SCHOOL_ADMIN || req.user.role === Role.LECTURER)
      ? req.user.schoolId
      : (querySchoolId || req.user.schoolId);
    if (!schoolId) {
      return this.facultiesService.findAllPublic();
    }
    return this.facultiesService.findAllBySchool(schoolId);
  }

  // GET /v1/admin/schools/:schoolId/faculties
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN)
  @Get('admin/schools/:schoolId/faculties')
  findAllBySchool(@Param('schoolId') schoolId: string) {
    return this.facultiesService.findAllBySchool(schoolId);
  }

  // POST /v1/admin/faculties
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN)
  @Post('admin/faculties')
  create(@Request() req: any, @Body() data: any) {
    const schoolId = req.user.role === Role.SCHOOL_ADMIN ? req.user.schoolId : (data.schoolId || req.user.schoolId);
    if (!schoolId) {
      throw new BadRequestException('School ID is missing.');
    }
    return this.facultiesService.create({ ...data, schoolId });
  }

  // PATCH /v1/admin/faculties/:id
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN)
  @Patch('admin/faculties/:id')
  update(@Param('id') id: string, @Body() data: any) {
    return this.facultiesService.update(id, data);
  }

  // DELETE /v1/admin/faculties/:id
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN)
  @Delete('admin/faculties/:id')
  delete(@Param('id') id: string) {
    return this.facultiesService.delete(id);
  }

  // POST /v1/admin/faculties/:id/deactivate
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN)
  @Post('admin/faculties/:id/deactivate')
  deactivate(@Param('id') id: string, @Body('reason') reason: string) {
    return this.facultiesService.deactivate(id, reason);
  }

  // POST /v1/admin/departments
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN)
  @Post('admin/departments')
  createDepartment(@Request() req: any, @Body() data: any) {
    const schoolId = req.user.role === Role.SCHOOL_ADMIN ? req.user.schoolId : (data.schoolId || req.user.schoolId);
    if (!schoolId) {
      throw new BadRequestException('School ID is missing.');
    }
    return this.facultiesService.createDepartment({ ...data, schoolId });
  }

  // DELETE /v1/admin/departments/:id
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.SCHOOL_ADMIN)
  @Delete('admin/departments/:id')
  deleteDepartment(@Param('id') id: string) {
    return this.facultiesService.deleteDepartment(id);
  }
}
