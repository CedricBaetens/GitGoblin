import { highlightDiff, highlightCode } from './syntax';

self.onmessage = ({ data }: MessageEvent<{ id: number; text: string; path: string; kind?: string }>) => {
  try { self.postMessage({ id: data.id, tokens: data.kind === 'code' ? highlightCode(data.text, data.path) : highlightDiff(data.text, data.path) }); }
  catch { self.postMessage({ id: data.id, tokens: {} }); }
};
