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
 * Comprime una foto (~1280 px, JPEG) y genera su miniatura.
 * @param {Blob} file  la foto de la cámara de la app o la que devuelve <input type="file" capture>
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

// ===== Vídeo =====

export const VIDEO_MAX_MS = 5000;
const VIDEO_BITS_PER_SECOND = 1_000_000; // ~1 Mbps: un clip de 5 s ocupa unos 600 KB
// Por orden de preferencia: Chrome Android graba en WebM; MP4 como último recurso.
const VIDEO_MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

export function isCameraSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

export function isInAppRecordingSupported() {
  return 'MediaRecorder' in window && isCameraSupported();
}

function pickVideoMimeType() {
  return VIDEO_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

/**
 * Abre la cámara trasera sin audio. Para vídeo, resolución moderada (≤720p) para que ocupe poco;
 * para foto (highRes), algo más, porque luego se comprime igualmente a 1280 px.
 * `zoom: true` pide además poder hacer zoom (Chrome lo incluye en el permiso de la cámara como
 * «mover la cámara»). Si ese permiso extra se deniega, se abre la cámara sin zoom.
 */
export async function openRearCamera({ highRes = false } = {}) {
  const video = {
    facingMode: { ideal: 'environment' },
    width: { ideal: highRes ? 1920 : 1280 },
    height: { ideal: highRes ? 1080 : 720 },
    frameRate: { ideal: 30 },
  };
  try {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: { ...video, zoom: true }, audio: false });
    } catch (error) {
      if (error.name !== 'NotAllowedError') throw error;
      return await navigator.mediaDevices.getUserMedia({ video, audio: false });
    }
  } catch (error) {
    const denied = error.name === 'NotAllowedError' || error.name === 'SecurityError';
    throw new CaptureError(denied ? 'denied' : 'unavailable', error.message);
  }
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

/** ¿La cámara tiene linterna controlable? (Chrome Android en la mayoría de móviles) */
export function supportsTorch(stream) {
  const track = stream?.getVideoTracks()[0];
  return Boolean(track?.getCapabilities?.().torch);
}

export function setTorch(stream, on) {
  return stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: on }] });
}

/** Zoom que admite la cámara ({ min, max }), o null si no se puede controlar. */
export function zoomRange(stream) {
  const zoom = stream?.getVideoTracks()[0]?.getCapabilities?.().zoom;
  return zoom && zoom.max > zoom.min ? { min: zoom.min, max: zoom.max } : null;
}

/** Niveles del botón de zoom: 1×, 2× y 3×, los que quepan en lo que admite la cámara. */
export function zoomLevels({ min, max }) {
  const levels = [1, 2, 3].filter((level) => level >= min && level <= max);
  return levels.length >= 2 ? levels : [min, max];
}

export function setZoom(stream, level) {
  return stream.getVideoTracks()[0].applyConstraints({ advanced: [{ zoom: level }] });
}

/**
 * Hace una foto con la cámara abierta. ImageCapture.takePhoto() usa la resolución completa
 * del sensor; si no existe o falla, se usa el fotograma que se ve en la vista previa.
 * @returns {Promise<Blob>} la foto sin comprimir (luego pasa por processPhoto)
 */
export async function takePhoto(stream, previewVideo) {
  const track = stream.getVideoTracks()[0];
  if ('ImageCapture' in window && track) {
    try {
      return await new ImageCapture(track).takePhoto();
    } catch (error) {
      console.warn('takePhoto no ha funcionado; se usa el fotograma de la vista previa', error);
    }
  }
  if (!previewVideo.videoWidth) throw new CaptureError('processing', 'La cámara aún no muestra imagen');
  const canvas = document.createElement('canvas');
  canvas.width = previewVideo.videoWidth;
  canvas.height = previewVideo.videoHeight;
  canvas.getContext('2d').drawImage(previewVideo, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) throw new CaptureError('processing', 'No se ha podido capturar la foto');
  return blob;
}

/**
 * Graba un clip de la cámara que se para solo a los maxMs.
 * @param {MediaStream} stream
 * @param {{ onTick?: (remainingMs) => void }} options  para pintar la cuenta atrás
 * @returns {{ done: Promise<{ blob: Blob, durationMs: number }>, stop: () => void }}
 */
export function recordClip(stream, { maxMs = VIDEO_MAX_MS, onTick } = {}) {
  const mimeType = pickVideoMimeType();
  let recorder;
  try {
    recorder = new MediaRecorder(stream, { ...(mimeType && { mimeType }), videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
  } catch (error) {
    return { done: Promise.reject(new CaptureError('recording', error.message)), stop: () => {} };
  }

  const chunks = [];
  let startedAt = 0;
  let tickTimer;
  let stopTimer;
  const stop = () => {
    if (recorder.state !== 'inactive') recorder.stop();
  };

  const done = new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = (event) => reject(new CaptureError('recording', event.error?.message ?? 'Error de grabación'));
    recorder.onstop = () => {
      clearInterval(tickTimer);
      clearTimeout(stopTimer);
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' });
      if (blob.size === 0) reject(new CaptureError('recording', 'La grabación está vacía'));
      else resolve({ blob, durationMs: Math.min(Date.now() - startedAt, maxMs) });
    };
  });

  recorder.start(250); // trozos de 250 ms: si algo falla a mitad, no se pierde todo
  startedAt = Date.now();
  onTick?.(maxMs);
  tickTimer = setInterval(() => onTick?.(Math.max(0, maxMs - (Date.now() - startedAt))), 100);
  stopTimer = setTimeout(stop, maxMs);

  return { done, stop };
}

/** Miniatura JPEG del fotograma que muestra ahora mismo un <video>. */
export async function captureVideoFrame(video) {
  if (!video.videoWidth) return null;
  const { blob } = await renderJpeg(video, video.videoWidth, video.videoHeight, THUMB_MAX_SIDE, THUMB_QUALITY);
  return blob;
}

/** Monta el campo `media` de un vídeo grabado dentro de la app. */
export function videoInfo(blob, { durationMs, width, height, thumbnail }) {
  return createMediaInfo({ type: 'video', mimeType: blob.type, size: blob.size, width, height, durationMs, thumbnail });
}

/**
 * Procesa un vídeo de la cámara del sistema (fallback sin MediaRecorder): saca la miniatura
 * y los metadatos. Si la miniatura falla, el vídeo se guarda igualmente sin ella.
 */
export async function processVideoFile(file) {
  const meta = await readVideoMetadata(file).catch(() => null);
  return {
    blob: file,
    info: videoInfo(file, {
      durationMs: meta?.durationMs ?? null,
      width: meta?.width ?? null,
      height: meta?.height ?? null,
      thumbnail: meta?.thumbnail ?? null,
    }),
  };
}

function readVideoMetadata(blob, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const cleanup = () => {
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };
    const timer = setTimeout(() => { cleanup(); reject(new CaptureError('processing', 'Timeout leyendo el vídeo')); }, timeoutMs);

    video.onerror = () => { cleanup(); reject(new CaptureError('processing', 'Vídeo ilegible')); };
    video.onloadeddata = () => { video.currentTime = Math.min(0.1, video.duration || 0.1); };
    video.onseeked = async () => {
      try {
        const thumbnail = await captureVideoFrame(video);
        const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : null;
        resolve({ thumbnail, durationMs, width: video.videoWidth, height: video.videoHeight });
      } catch (error) {
        reject(error);
      } finally {
        cleanup();
      }
    };
    video.src = url;
  });
}
