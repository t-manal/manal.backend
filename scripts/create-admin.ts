/**
 * SECURE ADMIN ACCOUNT CREATION SCRIPT
 * 
 * WARNING: This creates an INSTRUCTOR account with full system access.
 * ONLY run this ONCE to create your first admin/instructor account.
 * 
 * Usage:
 *   ts-node scripts/create-admin.ts <email> <password> <firstName> <lastName>
 * 
 * Example:
 *   ts-node scripts/create-admin.ts admin@app.com SecurePass123 Admin User
 */

import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

async function createAdmin() {
  const args = process.argv.slice(2);
  
  if (args.length < 4) {
    console.error('\n❌ ERROR: Missing arguments');
    console.log('\nUsage: ts-node scripts/create-admin.ts <email> <password> <firstName> <lastName>');
    console.log('Example: ts-node scripts/create-admin.ts admin@app.com SecurePass123 Admin User\n');
    process.exit(1);
  }

  const [email, password, firstName, lastName] = args;

  console.log('\n🔐 SECURE ADMIN/INSTRUCTOR ACCOUNT CREATION\n');
  console.log('⚠️  WARNING: This creates an account with INSTRUCTOR privileges\n');

  try {
    // Validate inputs
    if (!email || !email.includes('@')) {
      throw new Error('Invalid email address');
    }
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    if (!firstName || !lastName) {
      throw new Error('First name and last name are required');
    }

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: { email },
    });

    if (existingUser) {
      throw new Error(`User with email ${email} already exists`);
    }

    // Generate username
    const prefix = email.split('@')[0].replace(/[^a-zA-Z0-9.]/g, '').toLowerCase();
    const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const username = `admin_${prefix}${randomSuffix}`;

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin user with INSTRUCTOR role (highest available)
    const admin = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        username,
        firstName,
        lastName,
        role: Role.INSTRUCTOR, // NOTE: Schema only has STUDENT/INSTRUCTOR, no ADMIN
        emailVerifiedAt: new Date(), // Auto-verify admin accounts
      },
    });

    console.log('\n✅ ADMIN ACCOUNT CREATED SUCCESSFULLY!\n');
    console.log('📧 Email:', admin.email);
    console.log('👤 Username:', admin.username);
    console.log('🔑 Role:', admin.role);
    console.log('✓ Email Verified:', admin.emailVerifiedAt ? 'Yes' : 'No');
    console.log('\n⚠️  IMPORTANT: Store this password securely. You will not see it again.\n');

  } catch (error: any) {
    console.error('\n❌ ERROR:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();
