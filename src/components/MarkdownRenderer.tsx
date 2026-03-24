import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';

import { cn } from '../lib/utils';

const langLoaders: Record<string, () => Promise<{ default: LanguageFn }>> = {
  javascript: () => import('highlight.js/lib/languages/javascript'),
  js: () => import('highlight.js/lib/languages/javascript'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  ts: () => import('highlight.js/lib/languages/typescript'),
  python: () => import('highlight.js/lib/languages/python'),
  bash: () => import('highlight.js/lib/languages/bash'),
  sh: () => import('highlight.js/lib/languages/bash'),
  json: () => import('highlight.js/lib/languages/json'),
  css: () => import('highlight.js/lib/languages/css'),
  html: () => import('highlight.js/lib/languages/xml'),
  xml: () => import('highlight.js/lib/languages/xml'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  yml: () => import('highlight.js/lib/languages/yaml'),
  sql: () => import('highlight.js/lib/languages/sql'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  md: () => import('highlight.js/lib/languages/markdown'),
};

const loadedLangs = new Set<string>();

async function ensureLang(lang: string): Promise<void> {
  if (loadedLangs.has(lang) || hljs.getLanguage(lang)) {
    loadedLangs.add(lang);
    return;
  }

  const loader = langLoaders[lang];
  if (!loader) {
    return;
  }

  const mod = await loader();
  hljs.registerLanguage(lang, mod.default);
  loadedLangs.add(lang);
}

function LazyCodeBlock({ lang, children }: { lang: string; children: string }) {
  const [html, setHtml] = useState<string>(children);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (lang) {
        await ensureLang(lang);
      }
      if (cancelled) {
        return;
      }

      try {
        const result = lang && hljs.getLanguage(lang)
          ? hljs.highlight(children, { language: lang }).value
          : children;
        if (!cancelled) {
          setHtml(result);
        }
      } catch {
        // Fall back to plain text.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lang, children]);

  return (
    <pre className="my-2 overflow-x-auto rounded-lg border border-[#313244] bg-[#1e1e2e] p-3 text-[13px]">
      {lang && <span className="float-right text-[10px] uppercase text-[#6c7086]">{lang}</span>}
      <code className="text-[#cdd6f4]" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
    </pre>
  );
}

type MarkdownRendererProps = {
  content: string;
  className?: string;
};

export default function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn('min-w-0 text-[15px] leading-relaxed', className)}>
      <Markdown
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          code: ({ children, className: codeClassName }) => {
            const lang = codeClassName?.replace('language-', '') || '';
            const isBlock = !!codeClassName?.includes('language-');
            if (isBlock) {
              return <LazyCodeBlock lang={lang}>{String(children).replace(/\n$/, '')}</LazyCodeBlock>;
            }

            return (
              <code className="rounded-md border border-primary/15 bg-[#FFF5F0] px-1.5 py-0.5 font-mono text-[13px] text-text dark:border-primary/10 dark:bg-[#2d1f1a] dark:text-text-inv">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-4">{children}</ol>,
          h1: ({ children }) => <h1 className="mb-2 text-lg font-bold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-1.5 text-base font-bold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 text-sm font-bold">{children}</h3>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-info underline">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-primary pl-3 text-text/70 dark:text-text-inv/70">
              {children}
            </blockquote>
          ),
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
