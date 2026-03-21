import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ZoomIn, ZoomOut, Upload, Link } from 'lucide-react';

type AvatarUploaderProps = {
  open: boolean;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
  currentAvatar?: string;
};

const CROP_SIZE = 200; // canvas size for cropping
const OUTPUT_SIZE = 128; // final avatar size

export default function AvatarUploader({ open, onClose, onSave, currentAvatar }: AvatarUploaderProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [urlMode, setUrlMode] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setImageSrc(null);
      setScale(1);
      setOffset({ x: 0, y: 0 });
      setUrlMode(false);
      setUrlInput('');
    }
  }, [open]);

  const loadImage = useCallback((src: string) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      // Fit image: scale so shortest side fills CROP_SIZE
      const minDim = Math.min(img.width, img.height);
      const fitScale = CROP_SIZE / minDim;
      setScale(fitScale);
      setOffset({ x: 0, y: 0 });
      setImageSrc(src);
    };
    img.onerror = () => {
      alert('Failed to load image');
    };
    img.src = src;
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        loadImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }, [loadImage]);

  const handleUrlSubmit = useCallback(() => {
    const url = urlInput.trim();
    if (!url) return;
    loadImage(url);
  }, [urlInput, loadImage]);

  // Draw the preview
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imageSrc) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);

    // Draw circular clipping
    ctx.save();
    ctx.beginPath();
    ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();

    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const drawX = (CROP_SIZE - drawW) / 2 + offset.x;
    const drawY = (CROP_SIZE - drawH) / 2 + offset.y;

    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    ctx.restore();

    // Draw circle border
    ctx.beginPath();
    ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [imageSrc, scale, offset]);

  // Pan via mouse/touch drag
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [offset]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [dragging, dragStart]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  // Zoom via wheel
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((prev) => Math.max(0.1, Math.min(5, prev - e.deltaY * 0.001)));
  }, []);

  const handleSave = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;

    // Render at OUTPUT_SIZE
    const output = document.createElement('canvas');
    output.width = OUTPUT_SIZE;
    output.height = OUTPUT_SIZE;
    const ctx = output.getContext('2d');
    if (!ctx) return;

    const ratio = OUTPUT_SIZE / CROP_SIZE;

    ctx.beginPath();
    ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();

    const drawW = img.width * scale * ratio;
    const drawH = img.height * scale * ratio;
    const drawX = (OUTPUT_SIZE - drawW) / 2 + offset.x * ratio;
    const drawY = (OUTPUT_SIZE - drawH) / 2 + offset.y * ratio;

    ctx.drawImage(img, drawX, drawY, drawW, drawH);

    const dataUrl = output.toDataURL('image/png');
    onSave(dataUrl);
    onClose();
  }, [scale, offset, onSave, onClose]);

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
          >
            <div className="w-full max-w-[340px] bg-white dark:bg-card-alt rounded-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border dark:border-border-dark">
                <h3 className="text-[15px] font-semibold text-text dark:text-text-inv">Set Avatar</h3>
                <button onClick={onClose} className="p-1 rounded-full hover:bg-border dark:hover:bg-border-dark transition-colors">
                  <X size={18} className="text-text/50 dark:text-text-inv/50" />
                </button>
              </div>

              {/* Content */}
              <div className="p-4">
                {!imageSrc ? (
                  /* Upload / URL entry */
                  <div className="flex flex-col items-center gap-3">
                    {currentAvatar && (
                      <img src={currentAvatar} alt="Current" className="w-16 h-16 rounded-full object-cover border-2 border-border dark:border-border-dark" />
                    )}

                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary/10 text-primary font-medium text-[14px] hover:bg-primary/20 transition-colors"
                    >
                      <Upload size={18} />
                      Upload Image
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileSelect}
                    />

                    <div className="flex items-center gap-2 w-full text-text/30 dark:text-text-inv/30 text-[12px]">
                      <div className="flex-1 h-px bg-border dark:bg-border-dark" />
                      or
                      <div className="flex-1 h-px bg-border dark:bg-border-dark" />
                    </div>

                    {urlMode ? (
                      <div className="flex gap-2 w-full">
                        <input
                          type="url"
                          value={urlInput}
                          onChange={(e) => setUrlInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                          placeholder="https://example.com/avatar.png"
                          className="flex-1 px-3 py-2 rounded-xl border border-border dark:border-border-dark bg-surface dark:bg-surface-dark text-[13px] text-text dark:text-text-inv outline-none focus:border-primary"
                          autoFocus
                        />
                        <button onClick={handleUrlSubmit} className="px-3 py-2 rounded-xl bg-primary text-white text-[13px] font-medium">
                          OK
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setUrlMode(true)}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-border dark:border-border-dark text-text/60 dark:text-text-inv/60 text-[14px] hover:bg-surface dark:hover:bg-surface-dark transition-colors"
                      >
                        <Link size={16} />
                        Paste URL
                      </button>
                    )}
                  </div>
                ) : (
                  /* Crop view */
                  <div className="flex flex-col items-center gap-3">
                    <div className="relative rounded-full overflow-hidden" style={{ width: CROP_SIZE, height: CROP_SIZE, touchAction: 'none' }}>
                      <canvas
                        ref={canvasRef}
                        width={CROP_SIZE}
                        height={CROP_SIZE}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onWheel={handleWheel}
                        className="cursor-grab active:cursor-grabbing"
                      />
                    </div>

                    {/* Zoom controls */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setScale((s) => Math.max(0.1, s - 0.1))}
                        className="p-2 rounded-full hover:bg-border dark:hover:bg-border-dark transition-colors"
                      >
                        <ZoomOut size={18} className="text-text/60 dark:text-text-inv/60" />
                      </button>
                      <input
                        type="range"
                        min="0.1"
                        max="5"
                        step="0.01"
                        value={scale}
                        onChange={(e) => setScale(parseFloat(e.target.value))}
                        className="w-[120px] accent-primary"
                      />
                      <button
                        onClick={() => setScale((s) => Math.min(5, s + 0.1))}
                        className="p-2 rounded-full hover:bg-border dark:hover:bg-border-dark transition-colors"
                      >
                        <ZoomIn size={18} className="text-text/60 dark:text-text-inv/60" />
                      </button>
                    </div>

                    <div className="flex gap-2 w-full">
                      <button
                        onClick={() => { setImageSrc(null); imgRef.current = null; }}
                        className="flex-1 py-2.5 rounded-xl border border-border dark:border-border-dark text-text/60 dark:text-text-inv/60 text-[14px] font-medium hover:bg-surface dark:hover:bg-surface-dark transition-colors"
                      >
                        Re-select
                      </button>
                      <button
                        onClick={handleSave}
                        className="flex-1 py-2.5 rounded-xl bg-primary text-white text-[14px] font-medium hover:bg-primary/90 transition-colors"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
