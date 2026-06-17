import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createPrismaClient } from '../server/services/database/prismaClient.js';

const prisma = createPrismaClient();
type Role = 'client' | 'provider' | 'admin';

async function upsertUser(name: string, email: string, role: Role, password: string, access_code: string) {
  const password_hash = await bcrypt.hash(password, 12);
  return prisma.user.upsert({
    where: { email },
    update: { name, role, access_code },
    create: { name, email, role, password_hash, access_code }
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Demo seed bloqueado en produccion. Define ALLOW_DEMO_SEED=true solo si entiendes el riesgo.');
  }

  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error('Define DEMO_PASSWORD con al menos 12 caracteres para crear usuarios demo.');
  }

  await upsertUser('Administrador Centro Digital', 'admin@centrodigital.local', 'admin', password, '3333');
  await upsertUser('Proveedor Principal', 'proveedor@centrodigital.local', 'provider', password, '2222');
  await upsertUser('Servimil', 'cliente@centrodigital.local', 'client', password, '1111');

  await prisma.movement.create({
    data: {
      type: 'seed.demo_users',
      description: 'Usuarios demo creados para entorno local o QA.'
    }
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error.message);
    await prisma.$disconnect();
    process.exit(1);
  });
