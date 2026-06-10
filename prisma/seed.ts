import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const products = [
  {
    name: 'Netflix Original 1 Pantalla x30 Dias',
    category: 'Netflix',
    price: 14500,
    brand_key: 'netflix',
    duration: '30 dias',
    screens: '1 pantalla',
    content_type: 'Peliculas, series, documentales, anime y originales',
    description: 'Acceso a Netflix por 30 dias para ver peliculas, series, documentales, anime y producciones originales desde dispositivos compatibles.',
    benefits: ['Peliculas y series bajo demanda.', 'Documentales, anime y contenido original.', 'Reproduccion en celular, TV, computador o tablet segun disponibilidad.', 'Entrega por panel privado despues de confirmar el pedido.']
  },
  {
    name: 'Netflix Internacional 1 Pantalla x30',
    category: 'Netflix',
    price: 15000,
    brand_key: 'netflix',
    duration: '30 dias',
    screens: '1 pantalla',
    content_type: 'Catalogo internacional de entretenimiento',
    description: 'Acceso a Netflix por 30 dias con una pantalla activa para disfrutar contenido internacional, peliculas, series, documentales y anime.',
    benefits: ['Catalogo internacional de entretenimiento.', 'Series, peliculas, anime y documentales.', 'Acceso desde dispositivos compatibles.', 'Entrega privada desde el panel del cliente.']
  },
  {
    name: 'Netflix Original 2 Pantallas x30 Dias',
    category: 'Netflix',
    price: 25000,
    brand_key: 'netflix',
    duration: '30 dias',
    screens: '2 pantallas',
    content_type: 'Entretenimiento bajo demanda',
    description: 'Acceso a Netflix por 30 dias con 2 pantallas, ideal para dos usuarios o dos dispositivos segun disponibilidad del proveedor.',
    benefits: ['Peliculas, series, anime y documentales.', 'Dos pantallas activas.', 'Contenido original y estrenos seleccionados.', 'Entrega segura por panel privado.']
  },
  {
    name: 'Netflix Cuenta Completa Original',
    category: 'Netflix',
    price: 50000,
    brand_key: 'netflix',
    duration: '30 dias',
    screens: 'Cuenta completa',
    content_type: 'Cuenta completa de entretenimiento',
    description: 'Cuenta completa de Netflix por 30 dias para disfrutar entretenimiento bajo demanda con mayor disponibilidad de perfiles y pantallas segun configuracion entregada.',
    benefits: ['Acceso completo a la cuenta entregada.', 'Peliculas, series, documentales y anime.', 'Mayor control sobre perfiles disponibles.', 'Entrega privada con datos de acceso en el panel.']
  },
  {
    name: 'Disney+ Premium 1 Pantalla x30 Dias',
    category: 'Disney+',
    price: 11000,
    brand_key: 'disney',
    duration: '30 dias',
    screens: '1 pantalla',
    content_type: 'Disney, Pixar, Marvel, Star Wars y contenido familiar',
    description: 'Acceso a Disney+ por 30 dias para ver peliculas, series, clasicos, estrenos y contenido de Disney, Pixar, Marvel, Star Wars, National Geographic, Hulu y deportes de ESPN segun plan disponible.',
    benefits: ['Disney, Pixar, Marvel y Star Wars.', 'National Geographic y contenido familiar.', 'ESPN y deportes segun disponibilidad del plan.', 'Entrega por panel privado.']
  },
  {
    name: 'Disney+ Cuenta Completa 4 Pantallas',
    category: 'Disney+',
    price: 25500,
    brand_key: 'disney',
    duration: '30 dias',
    screens: 'Hasta 4 pantallas',
    content_type: 'Cuenta completa familiar y deportes segun plan',
    description: 'Cuenta completa de Disney+ con hasta 4 pantallas segun configuracion del plan, ideal para disfrutar contenido familiar, peliculas, series y deportes.',
    benefits: ['Disney, Pixar, Marvel, Star Wars y National Geographic.', 'Series originales, clasicos y estrenos.', 'ESPN y deportes segun disponibilidad.', 'Cuenta completa entregada por panel privado.']
  },
  {
    name: 'HBO Max 1 Pantalla x30 Dias',
    category: 'HBO Max',
    price: 8500,
    brand_key: 'hbo',
    duration: '30 dias',
    screens: '1 pantalla',
    content_type: 'Series HBO, Warner, DC, Discovery y peliculas',
    description: 'Acceso a HBO Max por 30 dias para ver peliculas, series, producciones HBO, contenido Warner, DC, Discovery y deportes seleccionados segun disponibilidad regional.',
    benefits: ['Series HBO y peliculas.', 'Contenido Warner, DC y Discovery.', 'Documentales y realities.', 'Entrega privada despues de confirmar pedido.']
  },
  {
    name: 'HBO Max Cuenta Completa 4 Pantallas',
    category: 'HBO Max',
    price: 17500,
    brand_key: 'hbo',
    duration: '30 dias',
    screens: 'Hasta 4 pantallas',
    content_type: 'Cuenta completa de series premium y peliculas',
    description: 'Cuenta completa de HBO Max con hasta 4 pantallas segun configuracion del proveedor, pensada para disfrutar peliculas, series premium y contenido familiar.',
    benefits: ['HBO Originals, peliculas y series.', 'Contenido Warner, DC, Discovery y mas.', 'Deportes seleccionados segun disponibilidad.', 'Entrega en panel privado.']
  },
  {
    name: 'Amazon Prime 1 Pantalla x30 Dias',
    category: 'Amazon Prime',
    price: 8500,
    brand_key: 'amazon',
    duration: '30 dias',
    screens: '1 pantalla',
    content_type: 'Prime Video, originales y contenido bajo demanda',
    description: 'Acceso a Amazon Prime Video por 30 dias para ver peliculas, series, producciones originales, deportes y TV en vivo segun disponibilidad del catalogo.',
    benefits: ['Peliculas y series populares.', 'Producciones Amazon Originals.', 'Deportes y canales en vivo segun disponibilidad.', 'Entrega privada en el panel del cliente.']
  },
  {
    name: 'Amazon Prime Cuenta Completa 4 Pantallas',
    category: 'Amazon Prime',
    price: 25500,
    brand_key: 'amazon',
    duration: '30 dias',
    screens: 'Hasta 4 pantallas',
    content_type: 'Cuenta completa de Prime Video',
    description: 'Cuenta completa de Amazon Prime Video para disfrutar peliculas, series, originales, deportes y contenido bajo demanda desde dispositivos compatibles.',
    benefits: ['Prime Video con peliculas y series.', 'Contenido original de Amazon.', 'Deportes y TV en vivo segun disponibilidad.', 'Cuenta completa entregada por panel privado.']
  },
  {
    name: 'Crunchyroll 1 Pantalla x30 Dias',
    category: 'Crunchyroll',
    price: 8000,
    brand_key: 'crunchyroll',
    duration: '30 dias',
    screens: '1 pantalla',
    content_type: 'Anime, estrenos y peliculas anime',
    description: 'Acceso a Crunchyroll por 30 dias para ver anime, estrenos de temporada, peliculas anime y series japonesas en alta calidad segun disponibilidad.',
    benefits: ['Anime popular y estrenos.', 'Series clasicas y nuevas temporadas.', 'Peliculas anime.', 'Entrega segura desde el panel.']
  },
  {
    name: 'Crunchyroll Cuenta Completa 4 Pantallas',
    category: 'Crunchyroll',
    price: 17000,
    brand_key: 'crunchyroll',
    duration: '30 dias',
    screens: 'Hasta 4 pantallas',
    content_type: 'Cuenta completa de anime',
    description: 'Cuenta completa de Crunchyroll para disfrutar anime, peliculas y temporadas completas con varias pantallas segun configuracion entregada.',
    benefits: ['Catalogo amplio de anime.', 'Estrenos y simulcast segun disponibilidad.', 'Peliculas y series anime.', 'Cuenta entregada por panel privado.']
  },
  {
    name: 'Paramount+ 1 Pantalla x30 Dias',
    category: 'Paramount+',
    price: 8000,
    brand_key: 'paramount',
    duration: '30 dias',
    screens: '1 pantalla',
    content_type: 'Peliculas, series, TV en vivo y deportes seleccionados',
    description: 'Acceso a Paramount+ por 30 dias para ver peliculas, series, contenido original, TV en vivo y deportes seleccionados segun disponibilidad.',
    benefits: ['Peliculas y series de Paramount.', 'Contenido original.', 'TV en vivo y deportes seleccionados.', 'Entrega privada al cliente.']
  },
  {
    name: 'Paramount+ Cuenta Completa 4 Pantallas',
    category: 'Paramount+',
    price: 18000,
    brand_key: 'paramount',
    duration: '30 dias',
    screens: 'Hasta 4 pantallas',
    content_type: 'Cuenta completa de entretenimiento familiar',
    description: 'Cuenta completa de Paramount+ con hasta 4 pantallas segun configuracion, ideal para peliculas, series, entretenimiento familiar y deportes seleccionados.',
    benefits: ['Peliculas, series y originales.', 'Contenido de entretenimiento familiar.', 'Deportes y TV en vivo segun disponibilidad.', 'Entrega por panel privado.']
  },
  {
    name: 'Apple TV 1 Pantalla x30 Dias',
    category: 'Apple TV',
    price: 8500,
    brand_key: 'apple',
    duration: '30 dias',
    screens: '1 pantalla',
    content_type: 'Apple Originals, peliculas y series exclusivas',
    description: 'Acceso a Apple TV por 30 dias para ver Apple Originals, peliculas, series exclusivas, dramas, ciencia ficcion, comedias y estrenos seleccionados.',
    benefits: ['Apple Originals.', 'Series y peliculas exclusivas.', 'Estrenos semanales segun catalogo.', 'Entrega privada desde el panel.']
  },
  {
    name: 'Apple TV Cuenta Completa 4 Pantallas',
    category: 'Apple TV',
    price: 19000,
    brand_key: 'apple',
    duration: '30 dias',
    screens: 'Hasta 4 pantallas',
    content_type: 'Cuenta completa de contenido premium',
    description: 'Cuenta completa de Apple TV con acceso a peliculas y series originales de Apple, ideal para disfrutar contenido premium desde dispositivos compatibles.',
    benefits: ['Apple Originals.', 'Peliculas y series exclusivas.', 'Contenido premium sin saturacion visual.', 'Cuenta completa entregada en panel.']
  },
  {
    name: 'Plex 1 Pantalla x30 Dias',
    category: 'Plex',
    price: 8500,
    brand_key: 'plex',
    duration: '30 dias',
    screens: '1 pantalla',
    content_type: 'Peliculas, series, TV en vivo y biblioteca multimedia',
    description: 'Acceso a Plex por 30 dias para disfrutar peliculas, series, TV en vivo, documentales, deportes y contenido multimedia segun disponibilidad del servicio entregado.',
    benefits: ['Peliculas y series.', 'TV en vivo y canales seleccionados.', 'Documentales, deportes y entretenimiento.', 'Entrega privada por panel.']
  },
  {
    name: 'Plex Cuenta Completa 4 Pantallas',
    category: 'Plex',
    price: 17000,
    brand_key: 'plex',
    duration: '30 dias',
    screens: 'Hasta 4 pantallas',
    content_type: 'Cuenta completa multimedia',
    description: 'Cuenta completa de Plex para acceder a contenido multimedia, peliculas, series, TV en vivo y biblioteca organizada segun configuracion del proveedor.',
    benefits: ['Peliculas, series y TV.', 'Canales en vivo seleccionados.', 'Biblioteca multimedia organizada.', 'Entrega privada al cliente.']
  },
  {
    name: 'VIX 1 Pantalla x30 Dias',
    category: 'VIX',
    price: 8000,
    brand_key: 'vix',
    duration: '30 dias',
    screens: '1 pantalla',
    content_type: 'Contenido latino, novelas, deportes y noticias',
    description: 'Acceso a ViX por 30 dias para ver contenido en espanol, novelas, peliculas, series, realities, noticias, deportes en vivo y entretenimiento latino.',
    benefits: ['Series, novelas y peliculas en espanol.', 'Deportes y noticias segun disponibilidad.', 'Realities y entretenimiento latino.', 'Entrega por panel privado.']
  },
  {
    name: 'VIX Cuenta Completa 4 Pantallas',
    category: 'VIX',
    price: 18000,
    brand_key: 'vix',
    duration: '30 dias',
    screens: 'Hasta 4 pantallas',
    content_type: 'Cuenta completa de contenido latino',
    description: 'Cuenta completa de ViX para disfrutar contenido en espanol, novelas, peliculas, deportes, noticias y entretenimiento familiar con varias pantallas segun configuracion.',
    benefits: ['Contenido latino y en espanol.', 'Novelas, peliculas y series.', 'Deportes en vivo segun disponibilidad.', 'Cuenta completa entregada en panel.']
  },
  {
    name: 'IPTV +7.500 canales con Win+ 1 Pantalla',
    category: 'IPTV',
    price: 12000,
    brand_key: 'iptv',
    duration: '30 dias',
    screens: '1 pantalla',
    content_type: 'Canales en vivo, deportes y entretenimiento',
    description: 'Servicio IPTV con acceso a canales en vivo, entretenimiento, peliculas, deportes y Win+ para futbol colombiano segun disponibilidad del proveedor.',
    benefits: ['Mas de 7.500 canales segun configuracion.', 'Canales deportivos y de entretenimiento.', 'Win+ para futbol colombiano segun disponibilidad.', 'Entrega privada con instrucciones de acceso.']
  },
  {
    name: 'IPTV Cuenta Completa',
    category: 'IPTV',
    price: 21000,
    brand_key: 'iptv',
    duration: '30 dias',
    screens: 'Cuenta completa',
    content_type: 'Cuenta IPTV completa',
    description: 'Cuenta IPTV completa para acceder a canales en vivo, deportes, peliculas, series, entretenimiento internacional y contenido seleccionado por el proveedor.',
    benefits: ['Canales en vivo.', 'Deportes, peliculas y entretenimiento.', 'Contenido nacional e internacional.', 'Entrega por panel privado.']
  },
  {
    name: 'DIRECTV GO ORO con Win+ x30 Dias',
    category: 'DIRECTV GO',
    price: 40000,
    brand_key: 'directv',
    duration: '30 dias',
    screens: 'Segun configuracion del proveedor',
    content_type: 'TV en vivo, deportes, peliculas y canales premium',
    description: 'Acceso a DIRECTV GO / DGO por 30 dias con TV en vivo, deportes, peliculas, series, canales seleccionados y Win+ segun disponibilidad del plan.',
    benefits: ['TV en vivo y canales premium.', 'Deportes en vivo.', 'Peliculas y series.', 'Win+ segun disponibilidad del paquete.']
  },
  {
    name: 'Spotify Premium x1 Mes',
    category: 'Spotify',
    price: 12900,
    brand_key: 'spotify',
    duration: '1 mes',
    screens: 'Cuenta de audio',
    content_type: 'Musica, podcasts y descargas offline',
    description: 'Acceso a Spotify Premium por 1 mes para escuchar musica sin anuncios, descargar canciones, reproducir en cualquier orden y disfrutar podcasts desde dispositivos compatibles.',
    benefits: ['Musica sin anuncios.', 'Descargas para escuchar sin conexion.', 'Reproduccion en cualquier orden.', 'Podcasts y audio en alta calidad segun plan.']
  },
  {
    name: 'Spotify Premium x2 Meses',
    category: 'Spotify',
    price: 19000,
    brand_key: 'spotify',
    duration: '2 meses',
    screens: 'Cuenta de audio',
    content_type: 'Servicio premium de audio extendido',
    description: 'Acceso a Spotify Premium por 2 meses con musica sin anuncios, descargas, reproduccion libre, podcasts y experiencia premium de audio.',
    benefits: ['Musica sin anuncios.', 'Escucha offline.', 'Reproduccion sin restricciones.', 'Mayor duracion del servicio.']
  },
  {
    name: 'Spotify Premium x3 Meses',
    category: 'Spotify',
    price: 26000,
    brand_key: 'spotify',
    duration: '3 meses',
    screens: 'Cuenta de audio',
    content_type: 'Musica, podcasts y audio premium por 3 meses',
    description: 'Acceso a Spotify Premium por 3 meses para musica, podcasts, descargas offline, reproduccion en cualquier orden y audio de alta calidad segun disponibilidad.',
    benefits: ['Musica sin anuncios.', 'Descarga offline.', 'Reproduccion libre.', 'Servicio extendido por 3 meses.']
  }
];

async function main() {
  const productCount = await prisma.product.count();
  if (productCount === 0) {
    await prisma.product.createMany({
      data: products.map((product) => ({ ...product, provider_cost: Math.round(product.price * 0.55), active: true })),
      skipDuplicates: true
    });
  }

  const settings = {
    provider_name: 'Proveedor Principal',
    provider_whatsapp_number: process.env.WHATSAPP_PROVIDER_NUMBER || '',
    provider_notification_method: 'bridge',
    provider_notifications_active: 'true'
  };

  for (const [key, value] of Object.entries(settings)) {
    await prisma.appSetting.upsert({
      where: { key },
      update: { value, private: true },
      create: { key, value, private: true }
    });
  }

  const provider = await prisma.user.findFirst({ where: { role: 'provider' }, orderBy: { created_at: 'asc' } });
  const providerPaymentCount = await prisma.providerPaymentConfig.count();
  if (providerPaymentCount === 0) {
    await prisma.providerPaymentConfig.create({
      data: {
        provider_id: provider?.id,
        method: 'nequi',
        phone: process.env.PROVIDER_NEQUI_NUMBER || '',
        document: process.env.PROVIDER_DOCUMENT || null,
        active: Boolean(process.env.PROVIDER_NEQUI_NUMBER)
      }
    });
  }

  await prisma.movement.create({
    data: {
      type: 'seed.products',
      description: productCount === 0 ? 'Seed de productos base aplicado.' : 'Seed de productos omitido: ya existian productos.'
    }
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
