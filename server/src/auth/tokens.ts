import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ email: user.email, name: user.name }, config.JWT_SECRET, {
    subject: user.id,
    expiresIn: config.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });
}

/** Returns the user if the token is valid, otherwise null. Never throws. */
export function verifyToken(token: string | undefined | null): AuthUser | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload;
    if (!payload.sub) return null;
    return { id: payload.sub, email: payload.email, name: payload.name };
  } catch {
    return null;
  }
}
