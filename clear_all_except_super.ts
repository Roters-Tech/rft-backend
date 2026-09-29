import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
const isLocal = !connectionString || connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
});

const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🔍 Finding super admin(s)...');
  const superAdmins = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN' },
    select: { id: true, email: true, fullName: true, role: true },
  });

  if (superAdmins.length === 0) {
    console.error('❌ No SUPER_ADMIN found! Aborting.');
    process.exit(1);
  }

  console.log('✅ Super admin(s) found:');
  superAdmins.forEach((sa) => console.log(`   - ${sa.email} (${sa.fullName})`));

  const superAdminIds = superAdmins.map((sa) => sa.id);

  console.log('\n🗑️  Clearing all data (keeping super admin)...\n');

  // Delete in order respecting foreign key constraints
  const deleted = {
    announcementLikes: await prisma.announcementLike.deleteMany({}),
    announcementComments: await prisma.announcementComment.deleteMany({}),
    chatMessages: await prisma.chatMessage.deleteMany({}),
    notifications: await prisma.notification.deleteMany({}),
    assessmentSubmissions: await prisma.assessmentSubmission.deleteMany({}),
    userUnlocks: await prisma.userUnlock.deleteMany({}),
    payments: await prisma.payment.deleteMany({}),
    otps: await prisma.otp.deleteMany({}),
    revokedTokens: await prisma.revokedToken.deleteMany({}),
    feedbacks: await prisma.feedback.deleteMany({}),
    supportTickets: await prisma.supportTicket.deleteMany({}),
    admissionRequests: await prisma.admissionRequest.deleteMany({}),
    anonymousMessages: await prisma.anonymousMessage.deleteMany({}),
    classSessions: await prisma.classSession.deleteMany({}),
    classRepAssignments: await prisma.classRepAssignment.deleteMany({}),
    enrollments: await prisma.enrollment.deleteMany({}),
    globalSettings: await prisma.globalSetting.deleteMany({}),
    subscriptions: await prisma.subscription.deleteMany({}),
    assessments: await prisma.assessment.deleteMany({}),
    announcements: await prisma.announcement.deleteMany({}),
    contents: await prisma.content.deleteMany({}),
    courses: await prisma.course.deleteMany({}),
    users: await prisma.user.deleteMany({
      where: { id: { notIn: superAdminIds } },
    }),
    departments: await prisma.department.deleteMany({}),
    faculties: await prisma.faculty.deleteMany({}),
    schools: await prisma.school.deleteMany({}),
  };

  console.log('📊 Deletion summary:');
  for (const [table, result] of Object.entries(deleted)) {
    if (result.count > 0) {
      console.log(`   ${table}: ${result.count} records deleted`);
    }
  }

  // Clear the super admin's school/department refs since those are deleted
  await prisma.user.updateMany({
    where: { id: { in: superAdminIds } },
    data: { schoolId: null, departmentId: null },
  });

  console.log('\n✅ Database cleared! Only super admin(s) remain:');
  const remaining = await prisma.user.findMany({
    select: { email: true, fullName: true, role: true },
  });
  remaining.forEach((u) => console.log(`   📧 ${u.email} | ${u.fullName} | ${u.role}`));
  console.log('\n🎉 Done!');
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
