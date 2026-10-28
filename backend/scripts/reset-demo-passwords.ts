import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  const users = [
    'admin@fifiabe.mg',
    'superadmin@fifiabe.mg',
    'operateur.tana@fifiabe.mg',
    'operateur.antalaha@fifiabe.mg',
    'operateur.andapa@fifiabe.mg',
    'operateur.sambava@fifiabe.mg',
    'operateur.ampanefena@fifiabe.mg',
    'operateur.vohemar@fifiabe.mg',
    'chauffeur.test@fifiabe.mg',
  ];

  for (const email of users) {
    const newPassword = crypto.randomBytes(8).toString('hex') + 'A!';
    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { email },
      data: { passwordHash: hash },
    });
    console.log(email + ' -> ' + newPassword);
  }
}

main().finally(() => prisma.$disconnect());
