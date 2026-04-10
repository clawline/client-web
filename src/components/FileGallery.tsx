import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AudioLines, Code2, FileImage, FileText, Loader2, Paperclip, X } from 'lucide-react';
import { cn } from '../lib/utils';

type MessageRecord = {
  id: string;
  connectionId: string;
  agentId: string;
  sender: string;
  text: string;
  timestamp: number;
  chatId?: string;
  mediaType?: string;
  mediaUrl?: string;
};

type GalleryTab = 'all' | 'image' | 'document' | 'audio' | 'code';
type GalleryKind = Exclude<GalleryTab, 'all'> | 'other';

type GalleryItem = {
  id: string;
  kind: GalleryKind;
  title: string;
  subtitle: string;
  timestamp: number;
  timeLabel: string;
  dateLabel: string;
  sizeLabel?: string;
  mediaUrl?: string;
  previewUrl?: string;
  previewText?: string;
  icon: typeof Paperclip;
};

type FileGalleryProps = {
  agentId?: string | null;
  connectionId?: string | null;
  agentName?: string | null;
  isOpen: boolean;
  isDesktop?: boolean;
  onClose: () => void;
};

const GALLERY_LIMIT = 1000;
const IMAGE_DATA_URL_PATTERN = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/i;
const CODE_BLOCK_PATTERN = /```(?:[\w-]+)?\n?([\s\S]*?)```/g;
const DOCUMENT_EXTENSIONS = new Set(['md', 'pdf', 'txt', 'doc', 'docx']);
const CODE_EXTENSIONS = new Set(['ts', 'js', 'py', 'json', 'html', 'css', 'sh']);
const TEXT_PREVIEW_EXTENSIONS = new Set(['md', 'txt', 'ts', 'js', 'py', 'json', 'html', 'css', 'sh']);

const tabs: { id: GalleryTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'document', label: 'Docs' },
  { id: 'audio', label: 'Audio' },
  { id: 'code', label: 'Code' },
];

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return '今天';

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return '昨天';

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

function formatBytes(bytes?: number) {
  if (!bytes || Number.isNaN(bytes)) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function estimateDataUrlSize(dataUrl?: string) {
  if (!dataUrl?.startsWith('data:')) return undefined;
  const [meta, payload] = dataUrl.split(',', 2);
  if (!payload) return undefined;

  if (meta.includes(';base64')) {
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
  }

  try {
    return decodeURIComponent(payload).length;
  } catch {
    return payload.length;
  }
}

function extractFileName(message: MessageRecord) {
  const attachmentName = message.text.replace(/^📎\s*/, '').trim();
  if (attachmentName && attachmentName !== message.text) {
    return attachmentName;
  }

  if (!message.mediaUrl || message.mediaUrl.startsWith('data:')) {
    return '';
  }

  try {
    const pathname = new URL(message.mediaUrl).pathname;
    return decodeURIComponent(pathname.split('/').pop() ?? '');
  } catch {
    const match = message.mediaUrl.split('?')[0].split('/').pop();
    return decodeURIComponent(match ?? '');
  }
}

function getExtension(value: string) {
  const clean = value.split('?')[0].trim();
  const dotIndex = clean.lastIndexOf('.');
  if (dotIndex === -1) return '';
  return clean.slice(dotIndex + 1).toLowerCase();
}

function hasCodeBlock(text: string) {
  return text.includes('```');
}

function hasInlineBase64Image(text: string) {
  return IMAGE_DATA_URL_PATTERN.test(text);
}

function extractInlineBase64Image(text: string) {
  return text.match(IMAGE_DATA_URL_PATTERN)?.[0];
}

function extractCodePreview(text: string) {
  const blocks: string[] = [];
  for (const match of text.matchAll(CODE_BLOCK_PATTERN)) {
    const block = match[1]?.trim();
    if (block) blocks.push(block);
  }
  return blocks.join('\n\n');
}

function decodeDataUrlToText(dataUrl: string) {
  if (!dataUrl.startsWith('data:')) return null;

  const [meta, payload] = dataUrl.split(',', 2);
  if (!payload) return null;

  try {
    if (meta.includes(';base64')) {
      const binary = window.atob(payload);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

function getKind(message: MessageRecord, fileName: string): GalleryKind | null {
  const fileExtension = getExtension(fileName || message.mediaUrl || '');

  if (message.mediaType === 'image' || hasInlineBase64Image(message.text)) {
    return 'image';
  }
  if (message.mediaType === 'voice' || message.mediaType === 'audio') {
    return 'audio';
  }
  if (CODE_EXTENSIONS.has(fileExtension) || hasCodeBlock(message.text)) {
    return 'code';
  }
  if (DOCUMENT_EXTENSIONS.has(fileExtension) || message.mediaType === 'file' || message.mediaUrl) {
    return 'document';
  }
  return null;
}

function getIcon(kind: GalleryKind) {
  if (kind === 'image') return FileImage;
  if (kind === 'audio') return AudioLines;
  if (kind === 'code') return Code2;
  if (kind === 'document') return FileText;
  return Paperclip;
}

function getTitle(message: MessageRecord, fileName: string, kind: GalleryKind) {
  if (fileName) return fileName;

  if (kind === 'image') return 'Image attachment';
  if (kind === 'audio') return message.mediaType === 'voice' ? 'Voice message' : 'Audio clip';

  const summary = message.text
    .replace(/^📎\s*/, '')
    .replace(/```[\s\S]*?```/g, 'Code snippet')
    .replace(/\s+/g, ' ')
    .trim();

  return summary || 'Attachment';
}

function getSubtitle(message: MessageRecord, kind: GalleryKind) {
  if (kind === 'code') {
    const codePreview = extractCodePreview(message.text);
    if (codePreview) {
      return codePreview.split('\n').find((line) => line.trim())?.trim() || 'Code snippet';
    }
  }

  const cleanText = message.text
    .replace(/^📎\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleanText) return cleanText;
  return kind === 'image' ? 'Image preview available' : 'Preview available';
}

function getPreviewText(message: MessageRecord, kind: GalleryKind, fileName: string) {
  if (kind === 'code') {
    const codePreview = extractCodePreview(message.text);
    if (codePreview) return codePreview;
  }

  const extension = getExtension(fileName || message.mediaUrl || '');
  if (message.mediaUrl && TEXT_PREVIEW_EXTENSIONS.has(extension)) {
    return decodeDataUrlToText(message.mediaUrl);
  }

  if (message.mediaUrl?.startsWith('data:text')) {
    return decodeDataUrlToText(message.mediaUrl);
  }

  const summary = message.text.replace(/^📎\s*/, '').trim();
  return summary || undefined;
}

function toGalleryItem(message: MessageRecord): GalleryItem | null {
  const fileName = extractFileName(message);
  const kind = getKind(message, fileName);

  if (!kind) return null;

  const previewUrl = message.mediaUrl || extractInlineBase64Image(message.text);
  const icon = getIcon(kind);
  const sizeLabel = formatBytes(estimateDataUrlSize(previewUrl));

  return {
    id: message.id,
    kind,
    title: getTitle(message, fileName, kind),
    subtitle: getSubtitle(message, kind),
    timestamp: message.timestamp,
    timeLabel: formatTime(message.timestamp),
    dateLabel: formatDateLabel(message.timestamp),
    sizeLabel,
    mediaUrl: message.mediaUrl,
    previewUrl,
    previewText: getPreviewText(message, kind, fileName),
    icon,
  };
}

function filterItemsByTab(items: GalleryItem[], activeTab: GalleryTab) {
  if (activeTab === 'all') return items;
  return items.filter((item) => item.kind === activeTab);
}

function groupItemsByDate(items: GalleryItem[]) {
  const groups = new Map<string, GalleryItem[]>();

  items.forEach((item) => {
    const existing = groups.get(item.dateLabel);
    if (existing) {
      existing.push(item);
      return;
    }

    groups.set(item.dateLabel, [item]);
  });

  return [...groups.entries()].map(([label, groupItems]) => ({
    label,
    items: groupItems.sort((left, right) => right.timestamp - left.timestamp),
  }));
}

export default function FileGallery({
  agentId,
  connectionId,
  agentName,
  isOpen,
  isDesktop,
  onClose,
}: FileGalleryProps) {
  const [activeTab, setActiveTab] = useState<GalleryTab>('all');
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSelectedItem(null);
      return;
    }

    if (!connectionId || !agentId) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    // File gallery temporarily unavailable (IndexedDB removed, API search pending)
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setItems([]);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [agentId, connectionId, isOpen]);

  const visibleItems = filterItemsByTab(items, activeTab);
  const groupedItems = groupItemsByDate(visibleItems);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/30"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 32 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className={cn(
              'fixed top-0 right-0 z-50 h-full bg-white dark:bg-card-alt shadow-2xl border-l border-border dark:border-border-dark',
              isDesktop ? 'w-[420px] max-w-[92vw]' : 'w-full'
            )}
          >
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border dark:border-border-dark">
                <div>
                  <h3 className="text-[15px] font-semibold text-text dark:text-text-inv">Files &amp; Media</h3>
                  <p className="text-[12px] text-text/45 dark:text-text-inv/45">{agentName || agentId || 'Agent'}</p>
                </div>
                <motion.button whileTap={{ scale: 0.9 }} onClick={onClose} className="p-2 text-text/55 dark:text-text-inv/55">
                  <X size={18} />
                </motion.button>
              </div>

              <div className="border-b border-border dark:border-border-dark px-3 py-3">
                <div className="grid grid-cols-5 gap-1 rounded-[20px] bg-surface/80 dark:bg-surface-dark/80 p-1">
                  {tabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                          'rounded-[16px] px-2 py-2 text-[12px] font-medium transition-colors',
                          isActive
                            ? 'bg-primary text-white shadow-lg shadow-primary/20'
                            : 'text-text/55 dark:text-text-inv/55 hover:bg-white dark:hover:bg-card-alt'
                        )}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="relative flex-1 overflow-hidden">
                <div className="h-full overflow-y-auto px-3 py-4">
                  {isLoading ? (
                    <div className="flex h-full flex-col items-center justify-center text-center">
                      <Loader2 size={24} className="animate-spin text-primary mb-3" />
                      <p className="text-[13px] text-text/40 dark:text-text-inv/40">Loading files and media…</p>
                    </div>
                  ) : groupedItems.length > 0 ? (
                    <div className="space-y-5">
                      {groupedItems.map((group) => (
                        <section key={group.label} className="space-y-2">
                          <div className="px-2">
                            <h4 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-text/40 dark:text-text-inv/40">
                              {group.label}
                            </h4>
                          </div>

                          {group.items.map((item) => {
                            const Icon = item.icon;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => setSelectedItem(item)}
                                className="w-full rounded-[20px] border border-border/70 dark:border-border-dark/70 bg-white dark:bg-[#1f2131] px-4 py-3 text-left shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/[0.03] dark:hover:bg-primary/5"
                              >
                                <div className="flex items-start gap-3">
                                  <div className="mt-0.5 rounded-2xl bg-primary/10 p-2 text-primary">
                                    <Icon size={16} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-3">
                                      <p className="truncate text-[14px] font-medium text-text dark:text-text-inv">{item.title}</p>
                                      <span className="shrink-0 text-[11px] text-text/35 dark:text-text-inv/35">{item.timeLabel}</span>
                                    </div>
                                    <p className="mt-1 line-clamp-2 text-[12px] text-text/45 dark:text-text-inv/45">{item.subtitle}</p>
                                    <div className="mt-2 flex items-center gap-2 text-[11px] text-text/35 dark:text-text-inv/35">
                                      <span className="rounded-full bg-surface dark:bg-surface-dark px-2 py-1 capitalize">{item.kind}</span>
                                      {item.sizeLabel ? <span>{item.sizeLabel}</span> : null}
                                    </div>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </section>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                      <div className="mb-4 rounded-full bg-primary/10 p-4 text-primary">
                        <Paperclip size={22} />
                      </div>
                      <p className="text-[15px] font-medium text-text dark:text-text-inv">No files found</p>
                      <p className="mt-1 text-[13px] text-text/40 dark:text-text-inv/40">
                        Attachments, audio, images, and code snippets for this agent will appear here.
                      </p>
                    </div>
                  )}
                </div>

                <AnimatePresence>
                  {selectedItem && (
                    <motion.div
                      initial={{ opacity: 0, x: 24 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 24 }}
                      className="absolute inset-0 bg-white dark:bg-card-alt"
                    >
                      <div className="flex items-center justify-between border-b border-border dark:border-border-dark px-5 py-4">
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-semibold text-text dark:text-text-inv">{selectedItem.title}</p>
                          <p className="text-[12px] text-text/40 dark:text-text-inv/40">
                            {selectedItem.dateLabel} · {selectedItem.timeLabel}
                          </p>
                        </div>
                        <motion.button whileTap={{ scale: 0.9 }} onClick={() => setSelectedItem(null)} className="p-2 text-text/55 dark:text-text-inv/55">
                          <X size={18} />
                        </motion.button>
                      </div>

                      <div className="h-[calc(100%-73px)] overflow-y-auto p-5">
                        {selectedItem.kind === 'image' && selectedItem.previewUrl ? (
                          <div className="overflow-hidden rounded-[24px] border border-border dark:border-border-dark bg-surface/70 dark:bg-surface-dark/70 p-3">
                            <img
                              src={selectedItem.previewUrl}
                              alt={selectedItem.title}
                              className="max-h-[70vh] w-full rounded-[18px] object-contain"
                            />
                          </div>
                        ) : selectedItem.kind === 'audio' && selectedItem.previewUrl ? (
                          <div className="rounded-[24px] border border-border dark:border-border-dark bg-surface/70 dark:bg-surface-dark/70 p-5">
                            <p className="mb-4 text-[13px] text-text/50 dark:text-text-inv/50">Audio preview</p>
                            <audio src={selectedItem.previewUrl} controls className="w-full" />
                          </div>
                        ) : selectedItem.kind === 'document' && selectedItem.previewUrl?.startsWith('data:application/pdf') ? (
                          <div className="overflow-hidden rounded-[24px] border border-border dark:border-border-dark bg-surface/70 dark:bg-surface-dark/70 p-3">
                            <iframe title={selectedItem.title} src={selectedItem.previewUrl} className="h-[70vh] w-full rounded-[18px]" />
                          </div>
                        ) : selectedItem.previewText ? (
                          <pre className="overflow-x-auto rounded-[24px] border border-border dark:border-border-dark bg-surface/80 dark:bg-surface-dark/80 p-4 text-[13px] leading-relaxed text-text dark:text-text-inv whitespace-pre-wrap">
                            {selectedItem.previewText}
                          </pre>
                        ) : (
                          <div className="rounded-[24px] border border-dashed border-border dark:border-border-dark bg-surface/60 dark:bg-surface-dark/60 px-5 py-8 text-center">
                            <p className="text-[14px] font-medium text-text dark:text-text-inv">Preview unavailable</p>
                            <p className="mt-1 text-[12px] text-text/40 dark:text-text-inv/40">
                              This item does not include inline preview data.
                            </p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
