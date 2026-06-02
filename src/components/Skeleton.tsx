interface SkeletonProps {
  className?: string
  width?: string | number
  height?: string | number
}

function Skeleton({ className = '', width, height }: SkeletonProps) {
  return (
    <div
      className={`bg-ex-surface/50 rounded animate-pulse ${className}`}
      style={{ width, height }}
    />
  )
}

export function StockTableSkeleton() {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="grid grid-cols-[2fr_80px_100px_100px_100px_140px] gap-4 px-6 py-3 border-b border-ex-border">
        <Skeleton width="40px" height="12px" />
        <Skeleton width="40px" height="12px" className="ml-auto" />
        <Skeleton width="40px" height="12px" className="ml-auto" />
        <Skeleton width="40px" height="12px" className="ml-auto" />
        <Skeleton width="40px" height="12px" className="ml-auto" />
        <Skeleton width="40px" height="12px" className="ml-auto" />
      </div>

      {/* Rows */}
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[2fr_80px_100px_100px_100px_140px] gap-4 px-6 py-3 border-b border-ex-border/30"
        >
          <div className="space-y-1">
            <Skeleton width="80px" height="14px" />
            <Skeleton width="120px" height="10px" />
          </div>
          <div className="flex justify-end">
            <Skeleton width="8px" height="8px" className="rounded-full" />
          </div>
          <Skeleton width="60px" height="14px" className="ml-auto" />
          <Skeleton width="50px" height="14px" className="ml-auto" />
          <Skeleton width="70px" height="14px" className="ml-auto" />
          <div className="flex justify-end">
            <Skeleton width="120px" height="32px" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function StatsCardSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-ex-surface border border-ex-border rounded-lg p-4 space-y-2">
          <Skeleton width="60px" height="10px" />
          <Skeleton width="80px" height="20px" />
        </div>
      ))}
    </div>
  )
}

export function ChartSkeleton() {
  return (
    <div className="bg-ex-surface border border-ex-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <Skeleton width="100px" height="12px" />
        <Skeleton width="60px" height="12px" />
      </div>
      <Skeleton width="100%" height="420px" />
    </div>
  )
}

export function ProgressSkeleton() {
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <Skeleton width="200px" height="12px" />
        <Skeleton width="40px" height="12px" />
      </div>
      <Skeleton width="100%" height="8px" className="rounded-full" />
      <div className="flex justify-between">
        <Skeleton width="150px" height="10px" />
        <Skeleton width="80px" height="10px" />
      </div>
    </div>
  )
}

export function RepoTabsSkeleton() {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} width="120px" height="36px" className="rounded-lg" />
      ))}
    </div>
  )
}
