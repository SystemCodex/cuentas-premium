import path from 'node:path';

process.env.PUPPETEER_CACHE_DIR ||= path.resolve('.cache', 'puppeteer');

const { downloadBrowsers } = await import('puppeteer/internal/node/install.js');
await downloadBrowsers();
