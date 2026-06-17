import 'dotenv/config';
import { createPrismaClient } from '../server/services/database/prismaClient.js';

const prisma = createPrismaClient();
const confirmed = process.argv.includes('--yes') || process.env.CLEAR_OPERATIONAL_DATA_CONFIRM === 'YES';

if (!confirmed) {
  console.error('Para limpiar datos operativos ejecuta: npm run clear:operational -- --yes');
  process.exit(1);
}

async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.deliveryDraft.deleteMany();
    await tx.whatsAppInboundMessage.deleteMany();
    await tx.whatsAppOutbox.deleteMany();
    await tx.notification.deleteMany();
    await tx.movement.deleteMany();
    await tx.deliveredAccount.deleteMany();
    await tx.walletMovement.deleteMany();
    await tx.clientWallet.deleteMany();
    await tx.providerPayout.deleteMany();
    await tx.payment.deleteMany();
    await tx.orderItem.deleteMany();
    await tx.order.deleteMany();
  });
  console.log('Datos operativos eliminados. Usuarios, productos y configuracion se conservaron.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
