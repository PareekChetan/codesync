import type { Request, RequestHandler } from 'express';
import { HttpError } from '../middleware/errors.js';
import { verifyToken, type AuthUser } from './tokens.js';

const USER = Symbol('user');
type WithUser = { [USER]?: AuthUser };

export const requireAuth: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  (req as WithUser)[USER] = user;
  next();
};

/** The signed-in user. Only call this in routes behind requireAuth. */
export function currentUser(req: Request): AuthUser {
  const user = (req as WithUser)[USER];
  if (!user) throw new HttpError(401, 'Authentication required');
  return user;
}
