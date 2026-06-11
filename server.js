import http from 'node:http';

const port = Number(process.env.PORT || 3000);

function startupCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('JWT_SECRET debe tener')) return 'WEAK_JWT_SECRET';
  if (message.includes('APP_ENCRYPTION_KEY debe tener')) return 'WEAK_ENCRYPTION_KEY';
  if (message.includes('Variables requeridas faltantes')) return 'MISSING_ENVIRONMENT_VARIABLES';
  if (message.includes('JWT_SECRET es requerido')) return 'MISSING_JWT_SECRET';
  return 'APPLICATION_STARTUP_FAILED';
}

try {
  await import('./build/server/index.js');
} catch (error) {
  const code = startupCode(error);
  console.error(`[startup:${code}]`, error instanceof Error ? error.stack || error.message : error);

  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }

    const body = JSON.stringify({
      ok: false,
      code,
      message: 'La aplicacion no pudo iniciar. Revisa las variables y los registros de ejecucion.'
    });
    res.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
  });

  server.listen(port, '0.0.0.0', () => {
    console.error(`[startup:${code}] Servidor de diagnostico activo en el puerto ${port}.`);
  });
}
