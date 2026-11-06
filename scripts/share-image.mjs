// One source of truth for which share card belongs to a page: /sons/chuva/ -> og-sons-chuva.jpg.
// A page without a card of its own keeps the site cover, so adding a card is a file, not an edit.
import { existsSync } from 'node:fs';
import path from 'node:path';

export const COVER_IMAGE = 'og-cover.jpg';
export const shareImageFile = route => `og-${route.replace(/^\/|\/$/g, '').replace(/\//g, '-')}.jpg`;
export const resolveShareImage = (assetsDir, route) => {
  const file = shareImageFile(route);
  return existsSync(path.join(assetsDir, file)) ? file : COVER_IMAGE;
};
export const shareImageAlt = (file, title) => file === COVER_IMAGE
  ? 'Acalmo — um lugar para desacelerar.'
  : `Cartão do Acalmo: ${title}.`;
