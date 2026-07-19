import Link from 'next/link';
import { getAdminToken, logout } from './actions';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const token = await getAdminToken();

  if (!token) {
    return <div className="mx-auto max-w-5xl">{children}</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/admin" className="font-medium text-slate-900">
            Dashboard
          </Link>
          <Link href="/admin/sources" className="text-slate-600 hover:text-slate-900">
            Sources
          </Link>
          <Link href="/admin/dlq" className="text-slate-600 hover:text-slate-900">
            Dead-letter queue
          </Link>
        </nav>
        <form action={logout}>
          <button type="submit" className="text-sm text-slate-500 hover:text-slate-900">
            Log out
          </button>
        </form>
      </div>
      {children}
    </div>
  );
}
