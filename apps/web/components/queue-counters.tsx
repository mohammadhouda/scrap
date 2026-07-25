'use client';

import { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, ChevronRight, Server } from 'lucide-react';
import { Sparkline } from '@/components/ui/sparkline';
import { Loading } from '@/components/ui/state';
import { cn } from '@/lib/utils';
import type { QueueCount } from '@/lib/api';

const POLL_INTERVAL_MS = 2000;
const HISTORY = 30; // samples kept per series (~60s at 2s cadence)

// Semantic colors — a status palette, not arbitrary categories:
//   emerald = active / throughput (work flowing)   zinc = queued / idle
//   amber   = delayed (backing off)                red  = failed
const C = { active: '#34d399', wait: '#52525b', delay: '#fbbf24', fail: '#f87171' } as const;

const QUEUE_ORDER = ['scrape', 'discover', 'index'] as const;
type QueueName = (typeof QUEUE_ORDER)[number];

const fmt = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const rate = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1));

interface History {
  scrape: number[];
  discover: number[];
  index: number[];
  total: number[];
}

export function QueueCounters() {
  const [queues, setQueues] = useState<QueueCount[] | null>(null);
  const [error, setError] = useState(false);

  // Throughput histories (jobs/sec) + the previous completed-count sample, both
  // in refs so the 2s poll never reads a stale closure. Mutated before setState,
  // so the following render sees the fresh series.
  const hist = useRef<History>({ scrape: [], discover: [], index: [], total: [] });
  const prev = useRef<Record<string, { completed: number; t: number }>>({});

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch('/admin/queues-data', { cache: 'no-store' });
        if (!res.ok) throw new Error('failed');
        const data = (await res.json()) as QueueCount[];
        if (cancelled) return;

        const now = Date.now();
        let totalRate = 0;
        for (const q of data) {
          const p = prev.current[q.name];
          if (p) {
            const dt = (now - p.t) / 1000;
            // completed can DROP when BullMQ GCs finished jobs (age 3600) —
            // clamp so a GC never shows as negative throughput.
            const delta = Math.max(0, q.counts.completed - p.completed);
            const r = dt > 0 ? delta / dt : 0;
            push(hist.current[q.name as QueueName], r);
            totalRate += r;
          }
          prev.current[q.name] = { completed: q.counts.completed, t: now };
        }
        if (data.length > 0 && Object.keys(prev.current).length >= data.length) {
          push(hist.current.total, totalRate);
        }

        setQueues(data);
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!queues && !error) return <Loading label="Loading queue status..." />;
  if (error && !queues) return <p className="text-sm text-red-400">Could not load queue status.</p>;
  if (!queues) return null;

  const byName = Object.fromEntries(queues.map((q) => [q.name, q])) as Record<QueueName, QueueCount>;
  const totalActive = queues.reduce((s, q) => s + q.counts.active, 0);
  const totalCompleted = queues.reduce((s, q) => s + q.counts.completed, 0);
  const totalFailed = queues.reduce((s, q) => s + q.counts.failed, 0);
  const latestTotalRate = hist.current.total.at(-1) ?? 0;
  const fleetWorkers = Math.max(0, ...queues.map((q) => q.workers));

  return (
    <div className="flex flex-col gap-6">
      {/* Aggregate KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Throughput" value={`${rate(latestTotalRate)}`} unit="jobs/s" accent={C.active}>
          <Sparkline data={hist.current.total} color={C.active} height={30} className="mt-2 w-full" />
        </KpiTile>
        <KpiTile label="In flight" value={fmt(totalActive)} unit="jobs" accent={C.active} live={totalActive > 0} />
        <KpiTile label="Completed" value={fmt(totalCompleted)} unit="last hour" />
        <KpiTile
          label="Failed"
          value={fmt(totalFailed)}
          unit={totalFailed > 0 ? 'needs retry' : 'none'}
          accent={totalFailed > 0 ? C.fail : undefined}
          warn={totalFailed > 0}
        />
      </div>

      {/* Worker fleet banner */}
      <div className="flex items-center gap-2 text-sm">
        <Server className="h-4 w-4 text-zinc-500" />
        {fleetWorkers > 0 ? (
          <span className="text-zinc-400">
            <span className="font-semibold text-zinc-100">{fleetWorkers}</span> worker
            {fleetWorkers === 1 ? '' : 's'} connected · {byName.scrape.concurrency} slots each
          </span>
        ) : (
          <span className="flex items-center gap-1.5 font-medium text-red-400">
            <AlertTriangle className="h-3.5 w-3.5" /> No workers connected — the fleet is down
          </span>
        )}
      </div>

      {/* Pipeline: scrape → discover → index */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
        {QUEUE_ORDER.map((name, i) => (
          <div key={name} className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-center">
            <QueueStage q={byName[name]} series={hist.current[name]} />
            {i < QUEUE_ORDER.length - 1 ? (
              <Connector active={byName[QUEUE_ORDER[i + 1]!].counts.active > 0} />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function push(arr: number[], v: number) {
  arr.push(v);
  if (arr.length > HISTORY) arr.shift();
}

function KpiTile({
  label,
  value,
  unit,
  accent,
  live,
  warn,
  children,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: string;
  live?: boolean;
  warn?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {live ? <PulseDot color={accent ?? C.active} /> : null}
        {warn ? <AlertTriangle className="h-3 w-3 text-red-400" /> : null}
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className="text-3xl font-semibold tracking-tight tabular-nums"
          style={{ color: accent ?? '#fafafa' }}
        >
          {value}
        </span>
        <span className="text-xs text-zinc-500">{unit}</span>
      </div>
      {children}
    </div>
  );
}

function QueueStage({ q, series }: { q: QueueCount; series: number[] }) {
  const active = q.counts.active > 0;
  const capacity = q.workers * q.concurrency;
  const currentRate = series.at(-1) ?? 0;

  return (
    <div className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      {/* header: name + live/idle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold capitalize text-zinc-100">{q.name}</span>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-500',
            )}
          >
            {active ? <PulseDot color={C.active} /> : <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />}
            {active ? 'live' : 'idle'}
          </span>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 text-xs',
            q.workers > 0 ? 'text-zinc-400' : 'text-red-400',
          )}
          title="worker processes consuming this queue"
        >
          <Server className="h-3.5 w-3.5" />
          {q.workers > 0 ? (
            <>
              {q.workers} · <span className="tabular-nums">{q.counts.active}/{capacity}</span>
            </>
          ) : (
            'no workers'
          )}
        </span>
      </div>

      {/* throughput number + sparkline */}
      <div className="mt-3 flex items-baseline gap-1.5">
        <Activity className="h-4 w-4 self-center text-emerald-400" />
        <span className="text-2xl font-semibold tabular-nums text-zinc-50">{rate(currentRate)}</span>
        <span className="text-xs text-zinc-500">jobs/s</span>
      </div>
      <Sparkline data={series} color={C.active} height={36} className="mt-1 w-full" />

      {/* backlog composition bar */}
      <BacklogBar wait={q.counts.wait} active={q.counts.active} delayed={q.counts.delayed} />

      {/* footer counts */}
      <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-2 text-xs text-zinc-500">
        <span>
          <span className="tabular-nums text-zinc-300">{fmt(q.counts.completed)}</span> done ·1h
        </span>
        <span className={q.counts.failed > 0 ? 'text-red-400' : ''}>
          <span className="tabular-nums">{fmt(q.counts.failed)}</span> failed
        </span>
      </div>
    </div>
  );
}

function BacklogBar({ wait, active, delayed }: { wait: number; active: number; delayed: number }) {
  const total = wait + active + delayed;
  const seg = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0%');

  return (
    <div className="mt-3">
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-zinc-800">
        {total === 0 ? null : (
          <>
            <span style={{ width: seg(active), background: C.active }} />
            <span style={{ width: seg(wait), background: C.wait }} />
            <span style={{ width: seg(delayed), background: C.delay }} />
          </>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        <Legend color={C.active} label="active" value={active} />
        <Legend color={C.wait} label="waiting" value={wait} />
        <Legend color={C.delay} label="delayed" value={delayed} />
      </div>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label} <span className="tabular-nums text-zinc-300">{fmt(value)}</span>
    </span>
  );
}

function Connector({ active }: { active: boolean }) {
  return (
    <div className="flex shrink-0 items-center justify-center py-1 lg:py-0">
      <ChevronRight
        className={cn(
          'h-5 w-5 rotate-90 transition-colors lg:rotate-0',
          active ? 'animate-pulse text-emerald-400' : 'text-zinc-700',
        )}
      />
    </div>
  );
}

function PulseDot({ color }: { color: string }) {
  return (
    <span className="relative flex h-1.5 w-1.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: color }} />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: color }} />
    </span>
  );
}
