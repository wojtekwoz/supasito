"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-2">Something went wrong</p>
      <h1 className="mt-4 font-display text-5xl tracking-tight">This page could not be shown.</h1>
      <button onClick={reset} className="mt-8 border border-ink px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em]">
        Try again
      </button>
    </main>
  );
}
