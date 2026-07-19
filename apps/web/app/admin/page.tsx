import { QueueCounters } from '@/components/queue-counters';

export default function AdminDashboard() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Dashboard</h1>
        <p className="text-sm text-zinc-500">Live queue status, refreshed every 2 seconds.</p>
      </div>
      <QueueCounters />
    </div>
  );
}
