import 'dotenv/config';
import { z } from 'zod';
export const env = z.object({ DATABASE_URL: z.string().min(1), JWT_SECRET: z.string().min(32), HOST: z.string().default('127.0.0.1'), PORT: z.coerce.number().default(3000), CORS_ORIGIN: z.string().default('http://localhost:5173') }).parse(process.env);
