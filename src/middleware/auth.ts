import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getOrCreateUser } from '../db/users.ts';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;

    await getOrCreateUser(
      decodedToken.uid,
      decodedToken.email ?? '',
      typeof decodedToken.name === 'string' ? decodedToken.name : null
    );

    return next();
  } catch (error) {
    console.error('Authentication or user sync failed:', error);
    if (error instanceof Error && error.message === 'Unable to synchronize user account.') {
      return res.status(503).json({ error: error.message });
    }
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};
