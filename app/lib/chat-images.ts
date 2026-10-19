import type { T3ImageAttachment } from './types';

export const imageMimeTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const maxImageBytes = 10 * 1024 * 1024;

export function validateChatImages(files: readonly { type: string; size: number }[]) {
  if (files.length > 100) throw new Error('Attach up to 100 images per message.');
  for (const file of files) {
    if (!imageMimeTypes.includes(file.type)) throw new Error('Paste a PNG, JPEG, WebP, or GIF image.');
    if (!file.size || file.size > maxImageBytes) throw new Error('Each image must be between 1 byte and 10 MiB.');
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > 80 * 1024 * 1024)
    throw new Error('Images can total up to 80 MiB per message.');
}
export async function uploadChatImage(
  file: File,
  rpc: (tag: string, payload: unknown) => Promise<any>,
  upload: (relativeUrl: string, mimeType: string, bytes: number[]) => Promise<void>,
): Promise<T3ImageAttachment> {
  validateChatImages([file]);
  const metadata = { type: 'image' as const, name: file.name.trim().slice(0, 255) || 'image.png', mimeType: file.type, sizeBytes: file.size };
  const signed = await rpc('attachments.createUploadUrl', metadata);
  await upload(signed.relativeUrl, file.type, Array.from(new Uint8Array(await file.arrayBuffer())));
  return { ...metadata, id: signed.attachmentId };
}
