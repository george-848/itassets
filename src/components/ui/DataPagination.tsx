import { ChevronLeft, ChevronRight } from 'lucide-react';

interface DataPaginationProps {
  totalItems: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  itemLabel?: string;
}

export function DataPagination({
  totalItems,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  itemLabel = 'records',
}: DataPaginationProps) {
  if (totalItems === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIdx = (safePage - 1) * pageSize + 1;
  const endIdx = Math.min(totalItems, safePage * pageSize);

  const pageNumbers: (number | 'ellipsis')[] = [];
  if (totalPages <= 5) {
    for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
  } else {
    pageNumbers.push(1);
    if (safePage > 3) pageNumbers.push('ellipsis');
    const start = Math.max(2, safePage - 1);
    const end = Math.min(totalPages - 1, safePage + 1);
    for (let i = start; i <= end; i++) pageNumbers.push(i);
    if (safePage < totalPages - 2) pageNumbers.push('ellipsis');
    pageNumbers.push(totalPages);
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-[var(--av-border-subtle)] bg-[var(--av-surface)] px-4 py-3 text-xs text-[var(--av-text-subtle)]">
      <div className="flex items-center gap-3">
        <span className="tabular-nums">
          Showing{' '}
          <strong className="font-semibold text-[var(--av-text)]">
            {startIdx}–{endIdx}
          </strong>{' '}
          of{' '}
          <strong className="font-semibold text-[var(--av-text)]">
            {totalItems}
          </strong>{' '}
          {itemLabel}
        </span>
        <div className="hidden sm:flex items-center gap-1.5 border-l border-[var(--av-border)] pl-3">
          <span>Rows:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              onPageSizeChange(Number(e.target.value));
              onPageChange(1);
            }}
            aria-label="Rows per page"
            className="rounded-md border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-2 py-1 text-xs font-medium text-[var(--av-text)] focus:border-[var(--av-accent)] focus:outline-none"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-1 self-end sm:self-auto">
        <button
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1}
          aria-label="Previous page"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        {pageNumbers.map((num, idx) =>
          num === 'ellipsis' ? (
            <span
              key={`ellipsis-${idx}`}
              className="px-1.5 text-[var(--av-text-subtle)]"
            >
              …
            </span>
          ) : (
            <button
              key={num}
              type="button"
              onClick={() => onPageChange(num)}
              aria-current={num === safePage ? 'page' : undefined}
              className={`inline-flex h-8 min-w-[2rem] items-center justify-center rounded-lg px-2 text-xs font-medium tabular-nums transition-colors ${
                num === safePage
                  ? 'bg-[var(--av-accent)] text-white shadow-xs'
                  : 'border border-[var(--av-border)] bg-[var(--av-surface)] text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)]'
              }`}
            >
              {num}
            </button>
          )
        )}

        <button
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= totalPages}
          aria-label="Next page"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
