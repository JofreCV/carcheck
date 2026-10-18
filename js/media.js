// Fotos y vídeos: captura, compresión en el cliente y miniaturas.
// Todo se procesa en el móvil antes de guardarlo, para ocupar poco espacio en IndexedDB.

import { createMediaInfo } from './model.js';

const PHOTO_MAX_SIDE = 1280;
const PHOTO_QUALITY = 0.8;
const THUMB_MAX_SIDE = 320;
const THUMB_QUALITY = 0.7;

export class CaptureError extends Error {
  /** @param {'denied'|'unavailable'|'recording'|'processing'} code */
  constructor(code, message) {
    super(message);
    this.name = 'CaptureError';
    this.code = code;
  }
}

/** Escala (width, height) para que el lado mayor no pase de maxSide, sin ampliar nunca. */
function fitWithin(width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Dibuja una imagen, bitmap o fotograma de vídeo en un canvas y lo exporta como JPEG. */
async function renderJpeg(source, sourceWidth, sourceHeight, maxSide, quality) {
  const { width, height } = fitWithin(sourceWidth, sourceHeight, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(source, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new CaptureError('processing', 'No se ha podido comprimir la imagen');
  return { blob, width, height };
}

/**
 * Comprime una foto de la cámara (~1280 px, JPEG) y genera su miniatura.
 * @param {File} file  la foto que devuelve <input type="file" capture>
 * @returns {{ blob: Blob, info: object }}  info es el campo `media` del registro
 */
export async function processPhoto(file) {
  let bitmap;
  try {
    // createImageBitmap ya aplica la orientación EXIF, así que la foto no sale girada.
    bitmap = await createImageBitmap(file);
  } catch {
    throw new CaptureError('processing', 'No se ha podido leer la foto');
  }
  try {
    const photo = await renderJpeg(bitmap, bitmap.width, bitmap.height, PHOTO_MAX_SIDE, PHOTO_QUALITY);
    const thumb = await renderJpeg(bitmap, bitmap.width, bitmap.height, THUMB_MAX_SIDE, THUMB_QUALITY);
    return {
      blob: photo.blob,
      info: createMediaInfo({
        type: 'photo',
        mimeType: 'image/jpeg',
        size: photo.blob.size,
        width: photo.width,
        height: photo.height,
        thumbnail: thumb.blob,
      }),
    };
  } finally {
    bitmap.close();
  }
}
