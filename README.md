# Centro Digital Premium Accounts Platform

Plataforma full-stack para venta, gestion y entrega de servicios digitales de entretenimiento.

## Roles

- Cliente: compra desde tienda, usa carrito, confirma pedidos y ve sus cuentas entregadas.
- Proveedor: ve pedidos pendientes en vivo, consulta valor proveedor y carga datos de acceso.
- Admin: gestiona pedidos, productos, usuarios, movimientos, pagos manuales al proveedor y configuracion privada.

## Flujo Funcional

1. El cliente entra a la tienda, agrega servicios al carrito y confirma el pedido.
2. El backend calcula `sale_total`, `provider_total` y `profit_total`.
3. El pedido queda internamente en `admin_payment_pending`, pero para cliente/proveedor se muestra como `Pendiente`.
4. El sistema crea un `ProviderPayout` administrativo en `pending_admin_payment`.
5. El pedido aparece inmediatamente en el panel del proveedor como `Pendiente`.
6. WhatsApp Bridge envia un aviso privado al admin con pedido, cliente, productos, venta, costo proveedor, utilidad y destino Nequi/DaviPlata.
7. El proveedor carga los datos de la cuenta.
8. El pedido pasa a `delivered`; el cliente ve la cuenta en "Mis cuentas" y recibe una notificacion interna.
9. El admin conserva el control financiero: venta cliente, costo proveedor, utilidad y pagos manuales al proveedor.

## Variables De Entorno

```env
DATABASE_URL=""
JWT_SECRET=""
APP_ENCRYPTION_KEY=""
WHATSAPP_PROVIDER_NUMBER=""
ADMIN_NOTIFICATION_PHONE=""
WHATSAPP_BRIDGE_ENABLED="true"
WHATSAPP_BRIDGE_MODE="web"
WHATSAPP_SESSION_PATH="./.whatsapp-session"
WHATSAPP_MAX_ATTEMPTS="3"
WHATSAPP_RETRY_DELAY_SECONDS="30"
VITE_API_URL=""
CORS_ORIGIN=""
ADMIN_EMAIL=""
ADMIN_NAME=""
ADMIN_CODE=""
PROVIDER_EMAIL=""
PROVIDER_NAME=""
PROVIDER_CODE=""
PROVIDER_PHONE=""
PROVIDER_NEQUI_NUMBER=""
PROVIDER_DOCUMENT=""
PORT=4002
```

Notas:
- `JWT_SECRET` debe ser fuerte y privado.
- `APP_ENCRYPTION_KEY` debe ser estable porque protege contrasenas entregadas.
- Solo `VITE_API_URL` va al navegador.
- `ADMIN_NOTIFICATION_PHONE` vive solo en backend y recibe los avisos de pedidos pendientes de pago.
- `WHATSAPP_SESSION_PATH` debe usar volumen persistente en produccion.

## Comandos Locales

```bash
npm install
docker compose up -d
npx prisma migrate deploy
npx prisma generate
npm run db:seed
npm run dev
```

Frontend local: `http://localhost:5174`

API local: `http://localhost:4002`

Health check: `GET /api/health`

## Produccion

Usa una base PostgreSQL administrada, por ejemplo Render PostgreSQL, Railway PostgreSQL, Supabase, Neon o Fly Postgres. Copia la URL de conexion en `DATABASE_URL`.

```bash
npm ci
npm run db:production
npm run start
```

`npm run db:production` ejecuta:

```bash
npx prisma migrate deploy
npx prisma generate
npm run db:seed
```

`npm run db:seed` solo carga productos base cuando la tabla `products` esta vacia. No crea usuarios demo.

No ejecutes `npm run db:seed:demo` en produccion.

### Base De Datos En Produccion

La base debe estar vacia la primera vez que ejecutes migraciones. Si ya creaste tablas manualmente en una base remota, Prisma puede rechazar `migrate deploy`. En ese caso crea una base nueva limpia o haz baseline de migraciones antes de desplegar.

Comandos recomendados para una base nueva:

```bash
npm run db:deploy
npm run db:generate
npm run db:seed
```

Despues verifica:

```bash
npx prisma validate
```

El proyecto necesita estas tablas para operar en red:

- `users`
- `products`
- `orders`
- `order_items`
- `delivered_accounts`
- `provider_payouts`
- `provider_payment_configs`
- `whatsapp_outbox`
- `notifications`
- `movements`
- `app_settings`

## Acceso Por Codigo

El ingreso a la plataforma no usa correo ni contrasena desde la pantalla inicial. Cada usuario debe tener asignado un codigo unico de 4 digitos.

Codigos demo locales:

- Cliente: `1111`
- Proveedor: `2222`
- Admin: `3333`

En produccion asigna codigos reales al crear usuarios.

## Crear Primer Admin

```bash
npm run create-admin
```

El script puede usar `ADMIN_EMAIL`, `ADMIN_NAME` y `ADMIN_CODE`, y no sobrescribe admins existentes.

## Crear Proveedor Inicial

```bash
npm run create-provider
```

El script puede usar `PROVIDER_EMAIL`, `PROVIDER_NAME`, `PROVIDER_CODE` y `PROVIDER_PHONE`.

Sin proveedor creado, el cliente puede comprar, pero no existira una cuenta de proveedor para entrar al panel y entregar cuentas.

## Configurar Proveedor

Entra como admin y abre "Configuracion privada > Proveedor".

Puedes definir:
- Nombre del proveedor.
- Numero WhatsApp del proveedor para comprobantes manuales.
- Metodo de notificacion interna: WhatsApp Bridge o solo panel.
- Metodo de pago proveedor: Nequi, DaviPlata o Bancolombia.
- Numero destino y documento opcional.
- Estado activo/inactivo.

Estos datos solo son visibles para admin.

## WhatsApp Bridge

No se usa WhatsApp Cloud API. El sistema usa un bridge interno con WhatsApp Web (`whatsapp-web.js`) controlado desde backend/admin.

Funcionamiento:
- El admin escanea el QR en el dashboard.
- La sesion queda guardada en `WHATSAPP_SESSION_PATH`.
- Al crear un pedido, el backend crea un `WhatsAppOutbox` para avisar al admin.
- El worker envia el mensaje automaticamente si la sesion esta conectada.
- Si WhatsApp falla, el pedido no falla; queda en el panel admin.

El bridge no debe enviar credenciales al cliente. Las credenciales solo se ven dentro del panel privado del cliente y, si hace falta, en la revision admin de borradores.

### Email De Respaldo

WhatsApp Bridge es el canal principal. El correo se envia como respaldo si WhatsApp no esta disponible, esta desactivado/desconectado al crear el pedido, el destino es el mismo numero vinculado o el mensaje agota sus intentos y queda fallido. El numero del WhatsApp del admin se guarda desde el panel admin en "WhatsApp del admin"; desde la seccion del bridge se puede ver estado, QR, pendientes/fallidos, reintentar, reconectar y enviar un mensaje de prueba.

Variables backend:

```env
ADMIN_NOTIFICATION_EMAIL=""
SMTP_HOST=""
SMTP_PORT=""
SMTP_SECURE=""
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""
```

`ADMIN_NOTIFICATION_EMAIL` y SMTP pueden configurarse desde el panel admin. La contraseña SMTP se cifra con `APP_ENCRYPTION_KEY` antes de guardarse en `AppSetting` y nunca se devuelve al navegador. También se pueden usar variables backend; la configuración guardada desde admin tiene prioridad.

Para Gmail usa `smtp.gmail.com`, puerto `465`, conexión segura y una contraseña de aplicación de Google. La contraseña normal de Gmail no funciona.

Si WhatsApp y correo fallan, el pedido no falla y sigue visible en el panel admin.

## Procesar Cuentas Entregadas

El proveedor no necesita entrar a la plataforma para cargar cuentas. El flujo operativo es:

- El admin recibe por WhatsApp el mensaje del proveedor con las cuentas.
- El admin abre "Procesar cuentas entregadas" en el dashboard.
- Busca o selecciona una orden pendiente de Servimil, por ejemplo `ORD-2026-000001`.
- Pega el mensaje completo.
- Pulsa "Interpretar mensaje".
- Revisa la vista previa editable.
- Aprueba la entrega o guarda un borrador.

El parser detecta servicios, correos/usuarios, contrasenas, perfiles, PIN, URL IPTV y notas. Siempre interpreta contra los productos de la orden seleccionada; no intenta adivinar pedidos sin orden. Al aprobar, el backend crea `DeliveredAccount`, cifra la contrasena, notifica internamente al cliente y la cuenta aparece en "Mis cuentas".

Formato recomendado para mensajes entrantes:

```txt
ORDEN: ORD-2026-000001
SERVICIO: NETFLIX
CORREO: correo@mail.com
CONTRASENA: clave
PERFIL: 1
PIN: 1234
```

Cada pedido tiene un numero visible unico con formato `ORD-YYYY-000001`. Ese numero aparece en WhatsApp al admin, panel admin, pagos pendientes, parser de entregas, historial cliente, Mis cuentas, historial proveedor, movimientos y linea de tiempo.

La linea de tiempo operativa guarda:
- `created_at`
- `admin_notified_at`
- `provider_payment_marked_at`
- `delivery_processed_at`
- `delivered_at`
- `client_notified_at`

La lectura automatica 24/7 de mensajes entrantes por WhatsApp queda reservada como fase 2. Mantener `WHATSAPP_INBOUND_ENABLED="false"` salvo que se active esa fase conscientemente.

## Pagos Manuales Al Proveedor

El sistema no ejecuta pagos bancarios automaticos. `ProviderPayout` es un registro administrativo.

Estados principales:
- Pedido: internamente puede usar `admin_payment_pending`, `provider_delivery_pending`, `processing`, `delivered`, `cancelled`.
- En cliente/proveedor se muestra solo `Pendiente` o `Entregado`.
- ProviderPayout: `pending_admin_payment`, `receipt_sent_to_provider`, `failed`, `cancelled`.

Endpoints admin:
- `GET /api/admin/payouts/pending`
- `PATCH /api/admin/payouts/:id/mark-receipt-sent`
- `PATCH /api/admin/payouts/:id/cancel`

## Privacidad

- Cliente no ve `provider_cost`, `provider_total`, `profit_total`, numero proveedor, numero admin ni comprobantes internos.
- Proveedor no ve `sale_total`, utilidad, numero admin ni dashboard financiero. Si ve valor proveedor para entregar pedidos.
- Admin si ve venta, costo proveedor, utilidad, metodo y numero proveedor.
- Los datos de acceso de cuentas se muestran solo en el panel privado del cliente.

## Auditoria

Movimientos relevantes:
- `order.created`
- `admin.payment_notification_whatsapp_pending`
- `admin.payment_notification_email_fallback_requested`
- `admin.payment_notification_sent`
- `admin.payment_notification_failed`
- `admin.payment_notification_email_sent`
- `admin.payment_notification_email_failed`
- `provider_payout.pending_admin_payment`
- `provider_payout.receipt_sent_to_provider`
- `order.released_to_provider`
- `account.delivered`
- `client.notification_created`
- `client.whatsapp_notification_created`
- `whatsapp.outbox_created`
- `whatsapp.inbound_received`
- `whatsapp.sent`
- `whatsapp.failed`
- `delivery.auto_parsed`
- `delivery.auto_delivered`
- `delivery.draft_created`
- `delivery.draft_approved`
- `delivery.draft_rejected`

## Checklist Antes De Publicar

- `npx prisma validate`
- `npm run typecheck`
- `npm run build`
- `npx prisma migrate deploy`
- `CORS_ORIGIN` apunta solo al dominio frontend real.
- `JWT_SECRET` y `APP_ENCRYPTION_KEY` son fuertes.
- No hay `wa.me`, `whatsappUrl`, `window.open` ni WhatsApp Cloud API.
- El proveedor ve pedidos pendientes en vivo y solo estados simples: pendiente/entregado.
- `WHATSAPP_SESSION_PATH` usa volumen persistente.

## Variables Minimas Para Subir A La Red

Backend:

```env
DATABASE_URL="postgresql://..."
DATABASE_USE_POOLER="true"
JWT_SECRET="clave-larga-y-segura"
APP_ENCRYPTION_KEY="clave-estable-de-32-caracteres-o-mas"
CORS_ORIGIN="https://tu-frontend.com"
ADMIN_NOTIFICATION_PHONE=""
ADMIN_NOTIFICATION_EMAIL=""
SMTP_HOST=""
SMTP_PORT=""
SMTP_SECURE=""
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""
WHATSAPP_BRIDGE_ENABLED="true"
WHATSAPP_BRIDGE_AUTOSTART="true"
WHATSAPP_SESSION_PATH="./.whatsapp-session"
WHATSAPP_INBOUND_ENABLED="false"
WHATSAPP_ALLOWED_INBOUND_NUMBERS=""
WHATSAPP_ADMIN_PHONE=""
WHATSAPP_RECEIVER_MODE="delivery_inbound"
AUTO_DELIVERY_CONFIDENCE_THRESHOLD="85"
```

La primera vinculacion se realiza desde `Admin > WhatsApp admin > Iniciar vinculacion`.
Escanea el QR con `WhatsApp > Dispositivos vinculados > Vincular dispositivo`.
En produccion, `WHATSAPP_SESSION_PATH` debe apuntar a almacenamiento persistente para
que la sesion no se pierda al reiniciar o volver a desplegar la aplicacion.
El comando de compilacion instala Chrome en `.cache/puppeteer`, dentro del proyecto,
para que `whatsapp-web.js` pueda iniciar en Hostinger.

Frontend:

```env
VITE_API_URL="https://tu-backend.com"
```

Luego crea usuarios reales:

```bash
ADMIN_EMAIL="admin@tu-dominio.com" ADMIN_NAME="Admin" ADMIN_CODE="3333" npm run create-admin
PROVIDER_EMAIL="proveedor@tu-dominio.com" PROVIDER_NAME="Proveedor" PROVIDER_CODE="2222" npm run create-provider
```

## Despliegue En Hostinger

Los archivos y pasos para subir esta plataforma a Hostinger estan en:

```text
deploy/hostinger/README.md
```

Para crear un ZIP listo para subir:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-hostinger-package.ps1
```

Para borrar pedidos y datos operativos de prueba antes de subir, conservando usuarios, productos y configuracion:

```bash
npm run clear:operational -- --yes
```

Recomendacion: usar Hostinger VPS o Node.js Web App. Esta plataforma necesita backend Node.js, PostgreSQL y un proceso persistente para WhatsApp Bridge; subir solo `dist/` a `public_html` no permite operar pedidos, admin ni WhatsApp.
