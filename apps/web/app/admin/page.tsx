import { QueueCounters } from '@/components/queue-counters';

export default function AdminDashboard() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
      <p className="text-sm text-slate-500">Live queue status, refreshed every 2 seconds.</p>
      <QueueCounters />
    </div>
  );
}
