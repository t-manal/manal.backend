-- SECURE ADMIN ACCOUNT CREATION VIA SQL
-- Alternative method if you prefer direct SQL over the TypeScript script
-- 
-- WARNING: This creates an INSTRUCTOR account (highest privilege in system)
-- Replace the values below with your actual admin details

-- Step 1: Hash your password using bcrypt (10 rounds)
-- You can use: https://bcrypt-generator.com/ or node -e "console.log(require('bcryptjs').hashSync('YOUR_PASSWORD', 10))"
-- Example hashed password for "AdminPassword123": $2a$10$N9qo8uLOickgx2ZMRZoMye7FRNpvNIiD67oXDjZ0.lT8JOvpPGS2u

-- Step 2: Insert admin user
INSERT INTO "User" (
  "id",
  "email",
  "password",
  "username",
  "firstName",
  "lastName",
  "role",
  "emailVerifiedAt",
  "createdAt",
  "updatedAt"
) VALUES (
  gen_random_uuid(), -- PostgreSQL generates UUID
  'admin@yourapp.com', -- ⚠️ CHANGE THIS
  '$2a$10$YOUR_HASHED_PASSWORD_HERE', -- ⚠️ CHANGE THIS (hashed password)
  'admin_system_0001', -- ⚠️ CHANGE THIS (unique username)
  'Admin', -- ⚠️ CHANGE THIS
  'User', -- ⚠️ CHANGE THIS
  'INSTRUCTOR', -- NOTE: Schema only has STUDENT/INSTRUCTOR (no ADMIN role)
  NOW(), -- Auto-verify admin accounts
  NOW(),
  NOW()
);

-- Step 3: Verify the admin was created
SELECT "id", "email", "username", "role", "emailVerifiedAt" 
FROM "User" 
WHERE "role" = 'INSTRUCTOR';

-- ⚠️  SECURITY NOTES:
-- 1. NEVER share the password in plain text
-- 2. Run this ONLY on your production database with restricted access
-- 3. Use a STRONG password (min 12 characters, mixed case, numbers, symbols)
-- 4. Delete this SQL file after use or remove the actual values
-- 5. INSTRUCTOR is the highest privilege level in this schema
