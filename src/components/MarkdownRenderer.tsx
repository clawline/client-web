import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';

import { cn } from '../lib/utils';

// Load commonly used languages lazily
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

    // Run async highlight
    void (async () => {
      // 1. Ensure language pack is loaded
      if (lang && !hljs.getLanguage(lang)) {
        try {
          await ensureLang(lang);
        } catch {
          // ignore loader errors
        }
      }

      if (cancelled) return;

      // 2. Highlight
      try {
        const result = lang && hljs.getLanguage(lang)
          ? hljs.highlight(children, { language: lang }).value
          : children; // Fallback: plain text
        if (!cancelled) {
          setHtml(result);
        }
      } catch {
        // Fallback: plain text
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lang, children]);

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border dark:border-border-dark bg-[#1e1e2e]">
      {lang && (
        <div className="flex items-center justify-between border-b border-[#313244] bg-[#181825] px-3 py-1.5">
          <span className="text-[10px] font-medium uppercase text-[#a6adc8]">{lang}</span>
        </div>
      )}
      <pre className="overflow-x-auto p-3 text-[13px] leading-normal text-[#cdd6f4]">
        <code
          className="font-mono"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
        />
      </pre>
    </div>
  );
}

type MarkdownRendererProps = {
  content: string;
  className?: string;
};

export default function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn('markdown-body min-w-0 text-[15px] leading-relaxed', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          // Paragraphs
          p: ({ children }) => <p className="mb-2 last:mb-0 break-words">{children}</p>,

          // Code blocks & inline code
          code(props) {
            const { children, className: codeClassName, node, ...rest } = props;
            const match = /language-(\w+)/.exec(codeClassName || '');
            const lang = match ? match[1] : '';
            const isBlock = match || String(children).includes('\n');

            if (isBlock) {
              return <LazyCodeBlock lang={lang}>{String(children).replace(/\n$/, '')}</LazyCodeBlock>;
            }

            return (
              <code className="rounded bg-border px-1.5 py-0.5 text-[13px] font-mono text-text dark:bg-border-dark dark:text-text-inv break-words whitespace-pre-wrap">
                {children}
              </code>
            );
          },

          // Lists
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-4">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,

          // Headings
          h1: ({ children }) => <h1 className="mt-4 mb-2 text-xl font-bold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-3 mb-2 text-lg font-bold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-base font-bold first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="mt-2 mb-1 text-sm font-bold first:mt-0">{children}</h4>,

          // Links
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all hover:text-primary/80">
              {children}
            </a>
          ),

          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-4 border-primary/30 bg-primary/5 pl-3 py-1 pr-2 italic text-text/80 dark:text-text-inv/80 rounded-r">
              {children}
            </blockquote>
          ),

          // Tables (restored via remarkGfm)
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded border border-border dark:border-border-dark">
              <table className="w-full text-left text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/50 dark:bg-card-alt border-b border-border dark:border-border-dark">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-border dark:divide-border-dark">{children}</tbody>,
          tr: ({ children }) => <tr className="hover:bg-muted/20 transition-colors">{children}</tr>,
          th: ({ children }) => <th className="px-3 py-2 font-semibold text-text dark:text-text-inv">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 align-top">{children}</td>,

          // Formatting
          strong: ({ children }) => <strong className="font-bold text-text dark:text-text-inv">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => <del className="text-text/50 dark:text-text-inv/50 line-through">{children}</del>,
          hr: () => <hr className="my-4 border-border dark:border-border-dark" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
