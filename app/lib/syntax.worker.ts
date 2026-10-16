import { highlightDiff } from './syntax';

self.onmessage = ({ data }: MessageEvent<{ id: number; text: string; path: string }>) => {
  try { self.postMessage({ id: data.id, tokens: highlightDiff(data.text, data.path) }); }
  catch { self.postMessage({ id: data.id, tokens: {} }); }
};
