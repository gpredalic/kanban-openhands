/**
 * Skeleton — YouTube-style shimmer placeholders for loading states.
 *
 * Used across all views (Board, Workflow, History, Analytics) to show
 * meaningful loading feedback instead of blank screens or frozen UI.
 * The shimmer animation is defined in globals.css (.kb-skeleton).
 */

/** A single shimmer bar. */
export function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`kb-skeleton rounded-lg ${className}`} />;
}

/** A skeleton task card — mimics the shape of a real TaskCard. */
export function SkeletonCard() {
  return (
    <div className="kb-glass rounded-2xl p-4">
      <div className="mb-3 flex items-center gap-2">
        <SkeletonBar className="h-5 w-16" />
        <SkeletonBar className="h-5 w-12" />
      </div>
      <SkeletonBar className="mb-2 h-4 w-3/4" />
      <SkeletonBar className="mb-4 h-3 w-1/2" />
      <div className="flex items-center justify-between">
        <SkeletonBar className="h-5 w-20" />
        <div className="flex gap-1.5">
          <SkeletonBar className="h-7 w-7 rounded-lg" />
          <SkeletonBar className="h-7 w-7 rounded-lg" />
          <SkeletonBar className="h-7 w-7 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** A skeleton column — mimics the shape of a real KanbanColumn. */
export function SkeletonColumn() {
  return (
    <div className="kb-glass flex flex-col rounded-2xl p-3">
      <div className="mb-3 flex items-center justify-between px-1.5">
        <div className="flex items-center gap-2.5">
          <SkeletonBar className="h-2.5 w-2.5 rounded-full" />
          <SkeletonBar className="h-4 w-20" />
        </div>
        <SkeletonBar className="h-6 w-6 rounded-full" />
      </div>
      <div className="flex flex-col gap-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}

/** A skeleton row — mimics the shape of a run/execution row. */
export function SkeletonRow() {
  return (
    <div className="kb-glass flex items-center gap-3 rounded-2xl px-4 py-3">
      <SkeletonBar className="h-4 w-4 rounded-full" />
      <div className="min-w-0 flex-1">
        <SkeletonBar className="mb-1.5 h-4 w-1/2" />
        <SkeletonBar className="h-3 w-3/4" />
      </div>
      <div className="shrink-0 text-right">
        <SkeletonBar className="mb-1 h-3 w-24" />
        <SkeletonBar className="h-3 w-16" />
      </div>
    </div>
  );
}

/** A skeleton stat card — mimics the shape of a StatsCards item. */
export function SkeletonStat() {
  return (
    <div className="kb-glass rounded-2xl p-4">
      <SkeletonBar className="mb-2 h-3 w-16" />
      <SkeletonBar className="h-6 w-12" />
    </div>
  );
}

/** A skeleton workflow node — mimics the shape of a workflow node. */
export function SkeletonNode() {
  return (
    <div className="kb-glass flex items-center gap-3 rounded-xl px-4 py-3">
      <SkeletonBar className="h-8 w-8 rounded-lg" />
      <div className="flex-1">
        <SkeletonBar className="mb-1.5 h-4 w-24" />
        <SkeletonBar className="h-3 w-16" />
      </div>
      <SkeletonBar className="h-5 w-14 rounded-full" />
    </div>
  );
}
