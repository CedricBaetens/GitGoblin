import { expect, it } from 'vitest';
import { renderMarkdown } from '../app/lib/markdown';

it('formats chat headings, emphasis, lists, code, tables, and links', () => {
  const html = renderMarkdown('# Update\n\n**Done** with `dayjs`.\n\n- First\n- Second\n\n```js\nconst x = 1;\n```\n\n| File | Status |\n| --- | --- |\n| app.ts | Done |\n\n[dependency include option](https://vite.dev/config/dep-optimization-options#optimizedeps-include)');
  expect(html).toContain('<h1>Update</h1>');
  expect(html).toContain('<strong>Done</strong> with <code>dayjs</code>');
  expect(html).toContain('<li>First</li>');
  expect(html).toContain('<pre><code class="language-js">const x = 1;');
  expect(html).toContain('<table>');
  expect(html).toContain('href="https://vite.dev/config/dep-optimization-options#optimizedeps-include" target="_blank" rel="noopener noreferrer">dependency include option</a>');
});

it('escapes HTML and blocks executable links in untrusted chat text', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))\n\n```html\n<script>alert(1)</script>\n```');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain('&lt;script&gt;');
});

it('autolinks plain URLs and renders unfinished streaming code fences', () => {
  expect(renderMarkdown('See https://vite.dev/config/\nnext line')).toContain('<br>');
  expect(renderMarkdown('See https://vite.dev/config/')).toContain('href="https://vite.dev/config/"');
  expect(renderMarkdown('```ts\nconst running =')).toContain('<pre><code class="language-ts">const running =');
});
