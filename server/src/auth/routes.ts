import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { HttpError } from '../middleware/errors.js';
import { currentUser, requireAuth } from './middleware.js';
import { signToken } from './tokens.js';

const registerSchema = z.object({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  name: z.string().trim().min(1).max(60),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(128),
});

// Slow down brute-force and credential-stuffing attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.NODE_ENV === 'test' ? 10_000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});

export const authRouter = Router();

authRouter.post('/register', authLimiter, async (req, res) => {
  const { email, name, password } = registerSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [email, name, passwordHash],
  );
  if (result.rowCount === 0) throw new HttpError(409, 'An account with this email already exists');
  const user = { id: result.rows[0].id, email, name };
  res.status(201).json({ token: signToken(user), user });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const result = await query<{ id: string; name: string; password_hash: string }>(
    'SELECT id, name, password_hash FROM users WHERE email = $1',
    [email],
  );
  const row = result.rows[0];
  // Same error for "no such user" and "wrong password" so attackers can't enumerate emails.
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    throw new HttpError(401, 'Invalid email or password');
  }
  const user = { id: row.id, email, name: row.name };
  res.json({ token: signToken(user), user });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: currentUser(req) });
});
