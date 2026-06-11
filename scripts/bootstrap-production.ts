import 'dotenv/config';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Role = 'client' | 'provider' | 'admin';

type InitialUserConfig = {
  role: Role;
  name?: string;
  email?: string;
  accessCode?: string;
  phone?: string;
};

const users: InitialUserConfig[] = [
  {
    role: 'client',
    name: process.env.CLIENT_NAME,
    email: process.env.CLIENT_EMAIL,
    accessCode: process.env.CLIENT_CODE,
    phone: process.env.CLIENT_PHONE
  },
  {
    role: 'provider',
    name: process.env.PROVIDER_NAME,
    email: process.env.PROVIDER_EMAIL,
    accessCode: process.env.PROVIDER_CODE,
    phone: process.env.PROVIDER_PHONE
  },
  {
    role: 'admin',
    name: process.env.ADMIN_NAME,
    email: process.env.ADMIN_EMAIL,
    accessCode: process.env.ADMIN_CODE
  }
];

async function ensureUser(config: InitialUserConfig) {
  const existing = await prisma.user.findFirst({ where: { role: config.role } });
  if (existing) return existing;

  if (!config.name || !config.email || !config.accessCode) {
    throw new Error(
      `No existe usuario ${config.role}. Configura ${config.role.toUpperCase()}_NAME, ` +
      `${config.role.toUpperCase()}_EMAIL y ${config.role.toUpperCase()}_CODE.`
    );
  }
  if (!config.email.includes('@')) throw new Error(`Email invalido para ${config.role}.`);
  if (!/^\d{4}$/.test(config.accessCode)) {
    throw new Error(`El codigo de ${config.role} debe tener exactamente 4 digitos.`);
  }

  const codeOwner = await prisma.user.findUnique({ where: { access_code: config.accessCode } });
  if (codeOwner) throw new Error(`El codigo de ${config.role} ya pertenece a otro usuario.`);

  const user = await prisma.user.create({
    data: {
      name: config.name,
      email: config.email.toLowerCase(),
      access_code: config.accessCode,
      phone: config.phone || null,
      role: config.role,
      password_hash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12)
    }
  });

  await prisma.movement.create({
    data: {
      user_id: user.id,
      type: `${config.role}.created`,
      description: `Usuario inicial ${config.role} creado para produccion.`
    }
  });
  return user;
}

async function main() {
  const [client, provider, admin] = await Promise.all(users.map(ensureUser));

  const providerPayment = await prisma.providerPaymentConfig.findFirst({
    where: { OR: [{ provider_id: provider.id }, { provider_id: null }] },
    orderBy: { created_at: 'asc' }
  });

  if (providerPayment) {
    await prisma.providerPaymentConfig.update({
      where: { id: providerPayment.id },
      data: {
        provider_id: provider.id,
        phone: process.env.PROVIDER_NEQUI_NUMBER || providerPayment.phone,
        document: process.env.PROVIDER_DOCUMENT || providerPayment.document,
        active: Boolean(process.env.PROVIDER_NEQUI_NUMBER || providerPayment.phone)
      }
    });
  }

  console.log(`Usuarios listos: cliente=${client.id}, proveedor=${provider.id}, admin=${admin.id}`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
