import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function askForAdmin() {
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_NAME && process.env.ADMIN_CODE) {
    return {
      name: process.env.ADMIN_NAME,
      email: process.env.ADMIN_EMAIL,
      accessCode: process.env.ADMIN_CODE
    };
  }

  const rl = readline.createInterface({ input, output });
  try {
    const name = (await rl.question('Nombre admin: ')).trim();
    const email = (await rl.question('Email admin: ')).trim().toLowerCase();
    const accessCode = (await rl.question('Codigo admin (4 digitos): ')).trim();
    return { name, email, accessCode };
  } finally {
    rl.close();
  }
}

async function main() {
  const { name, email, accessCode } = await askForAdmin();
  if (!name || !email || !email.includes('@')) throw new Error('Nombre/email invalidos.');
  if (!/^\d{4}$/.test(accessCode)) throw new Error('El codigo debe tener exactamente 4 digitos.');

  const codeOwner = await prisma.user.findUnique({ where: { access_code: accessCode } });
  if (codeOwner && codeOwner.email !== email) throw new Error('Ese codigo ya esta asignado a otro usuario.');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'admin') {
      throw new Error('Ya existe un usuario con ese email y no es admin.');
    }
    console.log('Admin ya existe. No se sobrescribio.');
    return;
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      access_code: accessCode,
      role: 'admin',
      password_hash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12)
    }
  });

  await prisma.movement.create({
    data: {
      user_id: user.id,
      type: 'admin.created',
      description: `Primer admin creado: ${email}`
    }
  });
  console.log(`Admin creado: ${email}`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error.message);
    await prisma.$disconnect();
    process.exit(1);
  });
