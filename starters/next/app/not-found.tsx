import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-2">404</p>
      <h1 className="mt-4 font-display text-5xl tracking-tight">This page does not exist.</h1>
      <Link href="/" className="mt-8 border border-ink px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em]">
        Back to the start
      </Link>
    </main>
  );
}
