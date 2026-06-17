import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createPrismaClient } from '../server/services/database/prismaClient.js';

const prisma = createPrismaClient();

async function askForProvider() {
  if (process.env.PROVIDER_EMAIL && process.env.PROVIDER_NAME && process.env.PROVIDER_CODE) {
    return {
      name: process.env.PROVIDER_NAME,
      email: process.env.PROVIDER_EMAIL,
      accessCode: process.env.PROVIDER_CODE,
      phone: process.env.PROVIDER_PHONE || ''
    };
  }

  const rl = readline.createInterface({ input, output });
  try {
    const name = (await rl.question('Nombre proveedor: ')).trim();
    const email = (await rl.question('Email proveedor: ')).trim().toLowerCase();
    const phone = (await rl.question('Telefono proveedor (opcional): ')).trim();
    const accessCode = (await rl.question('Codigo proveedor (4 digitos): ')).trim();
    return { name, email, phone, accessCode };
  } finally {
    rl.close();
  }
}

async function main() {
  const { name, email, phone, accessCode } = await askForProvider();
  if (!name || !email || !email.includes('@')) throw new Error('Nombre/email invalidos.');
  if (!/^\d{4}$/.test(accessCode)) throw new Error('El codigo debe tener exactamente 4 digitos.');

  const codeOwner = await prisma.user.findUnique({ where: { access_code: accessCode } });
  if (codeOwner && codeOwner.email !== email) throw new Error('Ese codigo ya esta asignado a otro usuario.');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'provider') {
      throw new Error('Ya existe un usuario con ese email y no es proveedor.');
    }
    console.log('Proveedor ya existe. No se sobrescribio.');
    return;
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      access_code: accessCode,
      phone: phone || null,
      role: 'provider',
      password_hash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12)
    }
  });

  await prisma.movement.create({
    data: {
      user_id: user.id,
      type: 'provider.created',
      description: `Proveedor creado: ${email}`
    }
  });
  console.log(`Proveedor creado: ${email}`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error.message);
    await prisma.$disconnect();
    process.exit(1);
  });
