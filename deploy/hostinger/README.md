# Despliegue en Hostinger

Esta plataforma no es una pagina estatica simple. Necesita:

- Backend Node.js/Express.
- PostgreSQL.
- Prisma migrations.
- Proceso persistente para WhatsApp Bridge.
- Carpeta persistente para `.whatsapp-session`.

Por eso el despliegue recomendado es **Hostinger VPS** o **Hostinger Node.js Web App** si tu plan lo permite. Subir solo `dist/` a `public_html` no sirve para operar el sistema completo.

## Opcion recomendada: Hostinger VPS

### 1. Preparar servidor

En el VPS instala Node.js LTS, npm, PM2, Nginx y PostgreSQL o conecta una base PostgreSQL administrada.

```bash
node -v
npm -v
pm2 -v
nginx -v
```

### 2. Subir el proyecto

Sube el ZIP generado por `scripts/build-hostinger-package.ps1` o sube el proyecto por SFTP/Git a:

```bash
/home/USER/premium-accounts-platform
```

No subas:

- `node_modules`
- `.env` con secretos al repositorio
- `.whatsapp-session` vieja si quieres vincular desde cero

### 3. Crear `.env`

Copia:

```bash
cp deploy/hostinger/.env.production.example .env
```

Edita `.env` y completa:

- `DATABASE_URL`
- `JWT_SECRET`
- `APP_ENCRYPTION_KEY`
- `CORS_ORIGIN`
- `FRONTEND_ORIGIN`
- `ADMIN_NOTIFICATION_PHONE`
- SMTP si quieres correo de respaldo

Importante: `ADMIN_NOTIFICATION_PHONE` debe ir en formato internacional, por ejemplo:

```env
ADMIN_NOTIFICATION_PHONE="573001112233"
```

### 4. Instalar dependencias y construir

```bash
npm install
npm run db:generate
npm run build
```

### 5. Migrar base de datos

```bash
npm run db:deploy
```

Si la tabla de productos esta vacia:

```bash
npm run db:seed
```

Si estas preparando una base que tenia pruebas locales y quieres borrar pedidos/datos operativos sin borrar usuarios, productos ni configuracion:

```bash
npm run clear:operational -- --yes
```

Para crear admin/proveedor si no existen:

```bash
npm run create-admin
npm run create-provider
```

### 6. Probar local en el VPS

```bash
NODE_ENV=production PORT=4002 npm run start
```

Abre:

```bash
curl http://127.0.0.1:4002/api/health
```

Debe responder:

```json
{"ok":true}
```

### 7. Configurar PM2

Edita `deploy/hostinger/ecosystem.config.cjs` y cambia:

```js
cwd: '/home/USER/premium-accounts-platform'
```

Luego:

```bash
mkdir -p logs
pm2 start deploy/hostinger/ecosystem.config.cjs
pm2 save
pm2 startup
```

### 8. Configurar Nginx

Copia la plantilla:

```bash
sudo cp deploy/hostinger/nginx-premium-accounts.conf /etc/nginx/sites-available/premium-accounts-platform
sudo ln -s /etc/nginx/sites-available/premium-accounts-platform /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Edita el archivo y cambia `tudominio.com`.

### 9. SSL

Con Certbot:

```bash
sudo certbot --nginx -d tudominio.com -d www.tudominio.com
```

Luego actualiza `.env`:

```env
CORS_ORIGIN="https://tudominio.com"
FRONTEND_ORIGIN="https://tudominio.com"
```

Reinicia:

```bash
pm2 restart premium-accounts-platform
```

### 10. WhatsApp Bridge

Entra como admin y abre:

```text
WhatsApp admin
```

Escanea el QR.

Recomendacion importante:

- Vincula el Bridge con un numero empresarial/interno.
- Configura `ADMIN_NOTIFICATION_PHONE` con otro numero destino.

Si usas el mismo numero vinculado como destino, WhatsApp puede enviar el mensaje, pero no generar notificacion push.

La carpeta `.whatsapp-session` debe estar en disco persistente. No la borres si no quieres escanear QR otra vez.

## Opcion Hostinger Node.js Web App

Si tu plan muestra la opcion **Node.js Web App**:

1. Sube el repositorio o ZIP.
2. Configura variables de entorno en hPanel.
3. Build command:

```bash
npm install && npm run db:generate && npm run build
```

4. Start command:

```bash
npm run start
```

5. Configura `NODE_ENV=production`.
6. Revisa que el plan permita proceso persistente y escritura en `.whatsapp-session`.

Si el proceso se duerme o no conserva sesion, usa VPS.

## Opcion solo frontend

Solo para mostrar la tienda sin backend, API, DB ni WhatsApp:

```bash
npm run build
```

Sube el contenido de `dist/` a `public_html` y agrega `frontend-only.htaccess` como `.htaccess`.

No recomendado para esta plataforma real.

## Checklist final

- `https://tudominio.com/api/health` responde `{"ok":true}`.
- Admin entra con codigo configurado.
- Productos cargan.
- Servimil crea pedido.
- Admin recibe aviso por WhatsApp o correo.
- WhatsApp Bridge queda `connected`.
- `CORS_ORIGIN` usa el dominio real.
- `.whatsapp-session` queda en ruta persistente.
- Base PostgreSQL tiene migraciones aplicadas.
