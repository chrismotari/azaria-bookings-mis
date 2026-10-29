import { z } from 'zod';

// Mirrors Django's validators that can be checked here; the server applies the rest.
export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .refine((value) => !/^\d+$/.test(value), 'Your password cannot be entirely numeric.');
