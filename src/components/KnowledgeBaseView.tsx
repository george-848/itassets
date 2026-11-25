import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, Globe, Lock, Plus, Search, X } from 'lucide-react';
import { api, ApiError, type ExtendedTenantContext } from '../lib/api.ts';
import type { KnowledgeArticle } from '../types/saas.ts';
import { EmptyState } from './ui/EmptyState.tsx';

interface KnowledgeBaseViewProps {
  tenantCtx: ExtendedTenantContext | null;
  onToast: (type: 'success' | 'error', message: string) => void;
  onPlanBlocked?: (err: ApiError) => void;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

export function KnowledgeBaseView({
  tenantCtx,
  onToast,
  onPlanBlocked,
}: KnowledgeBaseViewProps) {
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<
    'ALL' | 'public_portal' | 'internal_it'
  >('ALL');
  const [selectedArticle, setSelectedArticle] =
    useState<KnowledgeArticle | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Guides');
  const [visibility, setVisibility] =
    useState<KnowledgeArticle['visibility']>('public_portal');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const perms = tenantCtx?.permissions ?? [];
  const canManage = perms.includes('kb.manage');

  const loadKb = async () => {
    setLoading(true);
    try {
      const res = await api.listKb();
      setArticles(res.articles);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to load knowledge base.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKb();
  }, [tenantCtx?.tenant.id, tenantCtx?.activeOrg.id]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createKbArticle({
        title: title.trim(),
        category: category.trim() || 'Guides',
        visibility,
        summary: summary.trim() || content.trim().slice(0, 140),
        content: content.trim(),
        tags: tagsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      onToast('success', 'Knowledge Base article published.');
      setCreateOpen(false);
      setTitle('');
      setSummary('');
      setContent('');
      setTagsRaw('');
      await loadKb();
    } catch (err) {
      if (
        err instanceof ApiError &&
        onPlanBlocked &&
        (err.code === 'FEATURE_LOCKED' || err.code === 'SUBSCRIPTION_READ_ONLY')
      ) {
        setCreateOpen(false);
        onPlanBlocked(err);
        return;
      }
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to publish article.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return articles.filter((a) => {
      if (visibilityFilter !== 'ALL' && a.visibility !== visibilityFilter) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [articles, search, visibilityFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#3B66F6]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search SOPs, guides, tags..."
              className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] pl-9 pr-3.5 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none"
            />
          </div>
          <select
            value={visibilityFilter}
            onChange={(e) =>
              setVisibilityFilter(
                e.target.value as 'ALL' | 'public_portal' | 'internal_it'
              )
            }
            className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-medium text-[var(--av-text-muted)]"
          >
            <option value="ALL">All Articles</option>
            <option value="public_portal">Public Self-Service</option>
            <option value="internal_it">Internal IT Runbooks</option>
          </select>
        </div>

        {canManage && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.985 }}
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>New KB Article</span>
          </motion.button>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-10 text-center text-xs text-[var(--av-text-subtle)]">
          Loading Knowledge Base...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)]">
          <EmptyState
            icon={BookOpen}
            title="No knowledge base articles matched"
            description="Publish onboarding guides, troubleshooting steps, and internal IT runbooks."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((art) => (
            <button
              key={art.id}
              type="button"
              onClick={() => setSelectedArticle(art)}
              className="text-left rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] hover:border-[var(--av-accent)]/50 transition-all flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2 text-[11px] font-semibold">
                  <span className="text-[var(--av-accent)]">{art.category}</span>
                  <span
                    className={`inline-flex items-center gap-1 ${
                      art.visibility === 'internal_it'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {art.visibility === 'internal_it' ? (
                      <>
                        <Lock className="h-3 w-3" />
                        <span>Internal IT</span>
                      </>
                    ) : (
                      <>
                        <Globe className="h-3 w-3" />
                        <span>Self-Service</span>
                      </>
                    )}
                  </span>
                </div>
                <h4 className="mt-2 font-display text-sm font-bold text-[var(--av-text)]">
                  {art.title}
                </h4>
                <p className="mt-1.5 text-xs text-[var(--av-text-muted)] line-clamp-3 leading-relaxed">
                  {art.summary}
                </p>
              </div>
              <div className="flex items-center justify-between text-[11px] text-[var(--av-text-subtle)] border-t border-[var(--av-border-subtle)] pt-3">
                <span>By {art.authorName}</span>
                <span className="font-mono">{art.updatedAt.slice(0, 10)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Article Reader Modal */}
      <AnimatePresence>
        {selectedArticle && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedArticle(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden"
            >
              <div className="flex items-start justify-between gap-4 border-b border-[var(--av-border-subtle)] px-6 py-4">
                <div>
                  <div className="text-xs font-semibold text-[var(--av-accent)]">
                    {selectedArticle.category} ·{' '}
                    {selectedArticle.visibility === 'internal_it'
                      ? 'Internal IT Runbook'
                      : 'Self-Service Portal'}
                  </div>
                  <h3 className="font-display text-lg font-bold text-[var(--av-text)] mt-0.5">
                    {selectedArticle.title}
                  </h3>
                </div>
                <button type="button" onClick={() => setSelectedArticle(null)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="text-xs text-[var(--av-text-subtle)]">
                  Author: {selectedArticle.authorName} · Updated{' '}
                  {selectedArticle.updatedAt.slice(0, 10)}
                </div>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--av-text)]">
                  {selectedArticle.content}
                </div>
                {selectedArticle.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-3 border-t border-[var(--av-border-subtle)] text-xs text-[var(--av-text-muted)]">
                    {selectedArticle.tags.map((tag) => (
                      <span key={tag} className="font-mono text-[var(--av-accent)]">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Article Modal */}
      <AnimatePresence>
        {createOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-lg rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Publish Knowledge Article
                </h3>
                <button type="button" onClick={() => setCreateOpen(false)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleCreate} className="p-6 space-y-3.5">
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Article title"
                  className={INPUT_CLASS}
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Category (e.g. Security, VPN)"
                    className={INPUT_CLASS}
                  />
                  <select
                    value={visibility}
                    onChange={(e) =>
                      setVisibility(e.target.value as KnowledgeArticle['visibility'])
                    }
                    className={INPUT_CLASS}
                  >
                    <option value="public_portal">Public Self-Service</option>
                    <option value="internal_it">Internal IT Only</option>
                  </select>
                </div>
                <input
                  type="text"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Short summary..."
                  className={INPUT_CLASS}
                />
                <textarea
                  rows={5}
                  required
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Full resolution steps or runbook instructions..."
                  className={INPUT_CLASS}
                />
                <input
                  type="text"
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                  placeholder="Tags (comma-separated, e.g. vpn, macos, onboarding)"
                  className={INPUT_CLASS}
                />
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setCreateOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    {submitting ? 'Publishing...' : 'Publish Article'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
