import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';

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
  const newEmail = 'roterstech@gmail.com';
  const newPassword = 'RotersTech@2026!';
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  const superAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' },
  });

  if (!superAdmin) {
    console.error('❌ No SUPER_ADMIN found!');
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: superAdmin.id },
    data: {
      email: newEmail,
      fullName: 'RFT Super Admin',
      passwordHash: hashedPassword,
    },
  });

  console.log('✅ Super admin updated!');
  console.log(`   📧 Email: ${newEmail}`);
  console.log(`   🔑 Password: ${newPassword}`);
}

main()
  .catch((e) => { console.error('Error:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
