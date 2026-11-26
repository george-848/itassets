import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Download, FileText, Image as ImageIcon, Paperclip, Trash2, Upload } from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import type { AttachmentItem } from '../types/saas.ts';

interface AttachmentsPanelProps {
  entityType: AttachmentItem['entityType'];
  entityId: string;
  orgId?: string;
  canWrite?: boolean;
  onToast: (type: 'success' | 'error', message: string) => void;
}

export function AttachmentsPanel({
  entityType,
  entityId,
  orgId,
  canWrite = true,
  onToast,
}: AttachmentsPanelProps) {
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getAttachments(entityType, entityId);
      setItems(res.attachments);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (entityId) {
      void load();
    }
  }, [entityType, entityId]);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.size > 4 * 1024 * 1024) {
      onToast('error', 'File exceeds the 4 MB attachment limit.');
      return;
    }

    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read file.'));
        reader.readAsDataURL(file);
      });

      const res = await api.uploadAttachment({
        entityType,
        entityId,
        orgId,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataUrl,
      });
      setItems((prev) => [res.attachment, ...prev]);
      onToast('success', `Attached "${file.name}".`);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to upload attachment.'
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (att: AttachmentItem) => {
    try {
      await api.deleteAttachment(att.id);
      setItems((prev) => prev.filter((x) => x.id !== att.id));
      onToast('success', `Removed "${att.fileName}".`);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to delete attachment.'
      );
    }
  };

  return (
    <div className="rounded-lg border border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)]/35 p-3.5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--av-text)]">
          <Paperclip className="h-3.5 w-3.5 text-[var(--av-accent)]" />
          <span>Documents &amp; Receipts ({items.length})</span>
        </div>
        {canWrite && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--av-border)] bg-[var(--av-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--av-text)] hover:bg-[var(--av-surface-hover)] disabled:opacity-60"
            >
              <Upload className="h-3 w-3" />
              <span>{uploading ? 'Uploading...' : 'Attach File'}</span>
            </button>
          </>
        )}
      </div>

      {loading ? (
        <div className="text-[11px] text-[var(--av-text-subtle)]">Loading attachments...</div>
      ) : items.length === 0 ? (
        <div className="text-[11px] text-[var(--av-text-subtle)]">
          No receipts, invoices, photos, or signed PDFs attached yet (PNG, JPG, PDF, CSV up to 4 MB).
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((att) => {
            const isImage = att.mimeType.startsWith('image/');
            return (
              <div
                key={att.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {isImage ? (
                    <img
                      src={att.dataUrl}
                      alt={att.fileName}
                      className="h-9 w-9 rounded object-cover border border-[var(--av-border-subtle)] shrink-0"
                    />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded bg-[var(--av-surface-muted)] text-[var(--av-accent)] shrink-0">
                      {att.mimeType === 'application/pdf' ? (
                        <FileText className="h-4 w-4" />
                      ) : (
                        <ImageIcon className="h-4 w-4" />
                      )}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-[var(--av-text)]">
                      {att.fileName}
                    </div>
                    <div className="text-[10px] text-[var(--av-text-subtle)] tabular-nums">
                      {Math.max(1, Math.round(att.sizeBytes / 1024))} KB · {att.uploadedByName} ·{' '}
                      {att.createdAt.slice(0, 10)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <a
                    href={att.dataUrl}
                    download={att.fileName}
                    className="rounded p-1.5 text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-accent)]"
                    title="Download"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => handleDelete(att)}
                      className="rounded p-1.5 text-[var(--av-text-subtle)] hover:bg-red-500/10 hover:text-red-500"
                      title="Delete attachment"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
