# Quick Test: Registration Security

**Test 1: Try to register with ADMIN role (should FAIL)**
```bash
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "hacker@test.com",
    "password": "password123",
    "firstName": "Evil",
    "lastName": "Hacker",
    "role": "ADMIN"
  }'
```

**Expected Response**:
```json
{
  "success": false,
  "message": "Invalid field: role cannot be set during registration",
  "data": null,
  "error": null
}
```
**Status Code**: 400 ✅

---

**Test 2: Normal registration (should SUCCEED)**
```bash
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "student@test.com",
    "password": "password123",
    "firstName": "John",
    "lastName": "Doe"
  }'
```

**Expected**: Success with accessToken  
**Database Check**: User's role should be 'STUDENT'

---

**Test 3: Create First Admin**
```bash
cd backend
npx ts-node scripts/create-admin.ts admin@yourapp.com SecurePass123! Admin User
```

**Expected**: Admin account created with INSTRUCTOR role
