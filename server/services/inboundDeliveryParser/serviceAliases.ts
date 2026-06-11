export const serviceAliases: Array<{ key: string; aliases: string[] }> = [
  { key: 'netflix', aliases: ['netflix', 'nflx'] },
  { key: 'disney', aliases: ['disney', 'disney+', 'disney plus'] },
  { key: 'hbo', aliases: ['hbo', 'hbo max', 'max'] },
  { key: 'amazon', aliases: ['amazon', 'amazon prime', 'prime video', 'amazon prime video'] },
  { key: 'crunchyroll', aliases: ['crunchyroll', 'crunchy'] },
  { key: 'paramount', aliases: ['paramount', 'paramount+'] },
  { key: 'apple', aliases: ['apple tv', 'appletv'] },
  { key: 'plex', aliases: ['plex'] },
  { key: 'vix', aliases: ['vix', 'vix+'] },
  { key: 'iptv', aliases: ['iptv', 'smarters'] },
  { key: 'directv', aliases: ['directv', 'dgo', 'directv go'] },
  { key: 'spotify', aliases: ['spotify'] }
];

export function serviceKeyFromText(text: string) {
  const normalized = text.toLowerCase();
  return serviceAliases.find((entry) => entry.aliases.some((alias) => normalized.includes(alias)))?.key || '';
}
