import { expect, it, vi } from 'vitest';
import { maxImageBytes, uploadChatImage, validateChatImages } from '../app/lib/chat-images';

it('validates the same image formats and size limits as T3', () => {
  expect(() => validateChatImages([{ type: 'image/png', size: maxImageBytes }])).not.toThrow();
  for (const file of [{ type: 'image/svg+xml', size: 10 }, { type: 'image/png', size: 0 }, { type: 'image/jpeg', size: maxImageBytes + 1 }])
    expect(() => validateChatImages([file])).toThrow();
  expect(() => validateChatImages(Array(101).fill({ type: 'image/gif', size: 1 }))).toThrow('100');
  expect(() => validateChatImages(Array(9).fill({ type: 'image/webp', size: maxImageBytes }))).toThrow('80 MiB');
});

it('uploads the exact image bytes to the signed URL before returning a sendable attachment', async () => {
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'screenshot.png', { type: 'image/png' });
  const rpc = vi.fn().mockResolvedValue({ attachmentId: 'image-123', relativeUrl: '/api/attachments/upload/signed' });
  const upload = vi.fn().mockResolvedValue(undefined);
  const attachment = await uploadChatImage(file, rpc, upload);
  expect(rpc).toHaveBeenCalledWith('attachments.createUploadUrl', { type: 'image', name: 'screenshot.png', mimeType: 'image/png', sizeBytes: 4 });
  expect(upload).toHaveBeenCalledWith('/api/attachments/upload/signed', 'image/png', [137, 80, 78, 71]);
  expect(attachment).toEqual({ type: 'image', id: 'image-123', name: 'screenshot.png', mimeType: 'image/png', sizeBytes: 4 });
  expect(attachment).not.toHaveProperty('dataUrl');
});

it('does not return a sendable attachment when signing or uploading fails', async () => {
  const file = new File(['png'], 'screenshot.png', { type: 'image/png' });
  const upload = vi.fn();
  await expect(uploadChatImage(file, vi.fn().mockRejectedValue(new Error('Disconnected')), upload)).rejects.toThrow('Disconnected');
  expect(upload).not.toHaveBeenCalled();
  await expect(uploadChatImage(file, vi.fn().mockResolvedValue({ relativeUrl: '/api/attachments/upload/signed' }),
    vi.fn().mockRejectedValue(new Error('Upload failed')))).rejects.toThrow('Upload failed');
});
