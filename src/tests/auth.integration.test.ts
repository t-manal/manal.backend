import { Role } from '@prisma/client';
import express from 'express';
import cookieParser from 'cookie-parser';
import { prismaMock } from '../__tests__/setup';
import { errorMiddleware } from '../middlewares/error.middleware';
import authRoutes from '../modules/auth/auth.routes';

const request: any = require('supertest');
jest.mock('../middlewares/rate-limit.middleware', () => {
  const passthrough = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    authRateLimiter: passthrough,
    refreshRateLimiter: passthrough,
    adminActionRateLimiter: passthrough,
    paymentRateLimiter: passthrough,
    publicRateLimiter: passthrough,
    contactRateLimiter: passthrough,
  };
});

jest.mock('../services/email/email.service', () => ({
  emailService: {
    sendVerificationCode: jest.fn().mockResolvedValue({ success: true, messageId: 'test-message-id' }),
    sendPasswordResetEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'test-message-id' }),
  },
}));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/v1/auth', authRoutes);
app.use(errorMiddleware);

type StoredUser = {
  id: string;
  email: string;
  password: string | null;
  username: string;
  role: Role;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
  bio: string | null;
  avatar: string | null;
  refreshToken: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type StoredRefreshToken = {
  id: string;
  userId: string;
  token: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
};

type StoredVerificationCode = {
  id: string;
  userId: string;
  codeHash: string;
  expiresAt: Date;
  createdAt: Date;
};

let idSequence = 0;
let emailSequence = 0;
let users: StoredUser[] = [];
let refreshTokens: StoredRefreshToken[] = [];
let verificationCodes: StoredVerificationCode[] = [];
const createdUserEmails = new Set<string>();

const createId = (prefix: string): string => {
  idSequence += 1;
  return `${prefix}-${idSequence}`;
};

const makeRegisterPayload = () => {
  emailSequence += 1;
  return {
    email: `auth-integration-${emailSequence}@example.com`,
    password: 'StrongPass123!',
    firstName: 'Test',
    lastName: 'User',
    phoneNumber: '5551234567',
  };
};

const cloneUser = (user: StoredUser) => ({ ...user });
const cloneRefreshToken = (token: StoredRefreshToken) => ({ ...token });

const applySelect = (record: Record<string, unknown>, select?: Record<string, boolean>) => {
  if (!select) return record;
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    if (select[key]) {
      picked[key] = record[key];
    }
  }
  return picked;
};

const resetInMemoryStore = () => {
  users = [];
  refreshTokens = [];
  verificationCodes = [];
  createdUserEmails.clear();
};

const installPrismaImplementations = () => {
  (prismaMock.user.findFirst as any).mockImplementation(async (args: any) => {
    const email: string | undefined = args?.where?.email;
    if (!email) return null;
    const user = users.find((entry) => entry.email === email);
    return user ? cloneUser(user) : null;
  });

  (prismaMock.user.findUnique as any).mockImplementation(async (args: any) => {
    const where = args?.where ?? {};
    let user: StoredUser | undefined;
    if (typeof where.email === 'string') {
      user = users.find((entry) => entry.email === where.email);
    } else if (typeof where.username === 'string') {
      user = users.find((entry) => entry.username === where.username);
    } else if (typeof where.id === 'string') {
      user = users.find((entry) => entry.id === where.id);
    }

    if (!user) return null;
    return applySelect(cloneUser(user) as unknown as Record<string, unknown>, args?.select) as any;
  });

  (prismaMock.user.create as any).mockImplementation(async (args: any) => {
    const now = new Date();
    const user: StoredUser = {
      id: createId('user'),
      email: args.data.email,
      password: args.data.password ?? null,
      username: args.data.username,
      role: args.data.role ?? Role.STUDENT,
      firstName: args.data.firstName ?? null,
      lastName: args.data.lastName ?? null,
      phoneNumber: args.data.phoneNumber ?? null,
      bio: args.data.bio ?? null,
      avatar: args.data.avatar ?? null,
      refreshToken: args.data.refreshToken ?? null,
      emailVerifiedAt: args.data.emailVerifiedAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    users.push(user);
    createdUserEmails.add(user.email);
    return cloneUser(user) as any;
  });

  (prismaMock.user.update as any).mockImplementation(async (args: any) => {
    const where = args?.where ?? {};
    const userIndex = users.findIndex((entry) => entry.id === where.id);
    if (userIndex === -1) {
      throw new Error('User not found');
    }

    const current = users[userIndex];
    const updated: StoredUser = {
      ...current,
      ...args.data,
      updatedAt: new Date(),
    };
    users[userIndex] = updated;
    return applySelect(cloneUser(updated) as unknown as Record<string, unknown>, args?.select) as any;
  });

  (prismaMock.user.deleteMany as any).mockImplementation(async (args: any) => {
    const before = users.length;
    const emailFilter: string[] | undefined = args?.where?.email?.in;
    if (Array.isArray(emailFilter)) {
      users = users.filter((entry) => !emailFilter.includes(entry.email));
    } else {
      users = [];
    }
    return { count: before - users.length } as any;
  });

  (prismaMock.refreshToken.create as any).mockImplementation(async (args: any) => {
    const token: StoredRefreshToken = {
      id: createId('refresh-token'),
      userId: args.data.userId,
      token: args.data.token,
      deviceInfo: args.data.deviceInfo ?? null,
      ipAddress: args.data.ipAddress ?? null,
      expiresAt: args.data.expiresAt,
      revokedAt: args.data.revokedAt ?? null,
      createdAt: new Date(),
    };
    refreshTokens.push(token);
    return cloneRefreshToken(token) as any;
  });

  (prismaMock.refreshToken.findFirst as any).mockImplementation(async (args: any) => {
    const where = args?.where ?? {};
    const token = refreshTokens.find((entry) => {
      if (typeof where.token === 'string' && entry.token !== where.token) return false;
      if (typeof where.userId === 'string' && entry.userId !== where.userId) return false;
      if (where.revokedAt === null && entry.revokedAt !== null) return false;
      if (where.expiresAt?.gt instanceof Date && !(entry.expiresAt > where.expiresAt.gt)) return false;
      return true;
    });

    if (!token) return null;
    if (args?.include?.user) {
      const user = users.find((entry) => entry.id === token.userId);
      if (!user) return null;
      return {
        ...cloneRefreshToken(token),
        user: cloneUser(user),
      } as any;
    }
    return cloneRefreshToken(token) as any;
  });

  (prismaMock.refreshToken.update as any).mockImplementation(async (args: any) => {
    const tokenIndex = refreshTokens.findIndex((entry) => entry.id === args?.where?.id);
    if (tokenIndex === -1) {
      throw new Error('Refresh token not found');
    }
    const updated = {
      ...refreshTokens[tokenIndex],
      ...args.data,
    };
    refreshTokens[tokenIndex] = updated;
    return cloneRefreshToken(updated) as any;
  });

  (prismaMock.refreshToken.updateMany as any).mockImplementation(async (args: any) => {
    let count = 0;
    refreshTokens = refreshTokens.map((entry) => {
      const matchesUser = !args?.where?.userId || entry.userId === args.where.userId;
      const matchesRevoked = args?.where?.revokedAt !== null || entry.revokedAt === null;
      if (matchesUser && matchesRevoked) {
        count += 1;
        return { ...entry, ...args.data };
      }
      return entry;
    });
    return { count } as any;
  });

  (prismaMock.verificationCode.deleteMany as any).mockImplementation(async (args: any) => {
    const before = verificationCodes.length;
    const userId: string | undefined = args?.where?.userId;
    if (userId) {
      verificationCodes = verificationCodes.filter((entry) => entry.userId !== userId);
    } else {
      verificationCodes = [];
    }
    return { count: before - verificationCodes.length } as any;
  });

  (prismaMock.verificationCode.create as any).mockImplementation(async (args: any) => {
    const record: StoredVerificationCode = {
      id: createId('verification-code'),
      userId: args.data.userId,
      codeHash: args.data.codeHash,
      expiresAt: args.data.expiresAt,
      createdAt: new Date(),
    };
    verificationCodes.push(record);
    return { ...record } as any;
  });
};

const cleanupCreatedUsers = async () => {
  const emails = [...createdUserEmails];
  if (emails.length === 0) return;
  await prismaMock.user.deleteMany({
    where: {
      email: {
        in: emails,
      },
    },
  } as any);
  createdUserEmails.clear();
};

describe('Auth endpoints integration tests', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    resetInMemoryStore();
  });

  beforeEach(() => {
    resetInMemoryStore();
    installPrismaImplementations();
  });

  afterEach(async () => {
    await cleanupCreatedUsers();
    resetInMemoryStore();
  });

  afterAll(async () => {
    await cleanupCreatedUsers();
    resetInMemoryStore();
  });

  describe('1. POST /api/v1/auth/register', () => {
    it('Success: creates new user with valid data', async () => {
      const payload = makeRegisterPayload();

      const response = await request(app).post('/api/v1/auth/register').send(payload);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toEqual(expect.any(String));
      expect(response.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringContaining('refreshToken=')]),
      );
    });

    it('Fail: duplicate email returns 409', async () => {
      const payload = makeRegisterPayload();

      await request(app).post('/api/v1/auth/register').send(payload);
      const duplicateResponse = await request(app).post('/api/v1/auth/register').send(payload);

      expect(duplicateResponse.status).toBe(409);
      expect(duplicateResponse.body.success).toBe(false);
      expect(duplicateResponse.body.message).toBe('User with this email already exists');
    });

    it('Fail: missing fields returns 400', async () => {
      const response = await request(app).post('/api/v1/auth/register').send({
        email: 'missing-fields@example.com',
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Validation Error');
    });
  });

  describe('2. POST /api/v1/auth/login', () => {
    it('Success: valid credentials returns 200 with tokens', async () => {
      const payload = makeRegisterPayload();
      await request(app).post('/api/v1/auth/register').send(payload);

      const response = await request(app).post('/api/v1/auth/login').send({
        email: payload.email,
        password: payload.password,
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toEqual(expect.any(String));
      expect(response.body.data.user.email).toBe(payload.email);
      expect(response.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringContaining('refreshToken=')]),
      );
    });

    it('Fail: wrong password returns 401', async () => {
      const payload = makeRegisterPayload();
      await request(app).post('/api/v1/auth/register').send(payload);

      const response = await request(app).post('/api/v1/auth/login').send({
        email: payload.email,
        password: 'WrongPassword123!',
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid email or password');
    });

    it('Fail: non-existent email returns 401', async () => {
      const response = await request(app).post('/api/v1/auth/login').send({
        email: 'does-not-exist@example.com',
        password: 'AnyPassword123!',
      });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid email or password');
    });
  });

  describe('3. POST /api/v1/auth/refresh', () => {
    it('Success: valid refresh token returns new access token', async () => {
      const payload = makeRegisterPayload();
      const agent = request.agent(app);

      await agent.post('/api/v1/auth/register').send(payload);
      const response = await agent.post('/api/v1/auth/refresh').send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toEqual(expect.any(String));
      expect(response.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringContaining('refreshToken=')]),
      );
    });

    it('Fail: missing token returns 401', async () => {
      const response = await request(app).post('/api/v1/auth/refresh').send({});

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Refresh token missing');
    });
  });

  describe('4. POST /api/v1/auth/logout', () => {
    it('Success: valid token returns 200', async () => {
      const payload = makeRegisterPayload();
      const agent = request.agent(app);

      await agent.post('/api/v1/auth/register').send(payload);
      const response = await agent.post('/api/v1/auth/logout').send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Logged out successfully');
    });
  });
});
