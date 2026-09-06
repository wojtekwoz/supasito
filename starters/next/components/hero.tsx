export function Hero() {
  return (
    <section className="px-6 pb-16 pt-24 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-2">Welcome</p>
      <h1 className="mx-auto mt-4 max-w-3xl font-display text-6xl leading-[1.02] tracking-tight text-balance">
        Say what you want. Watch it change.
      </h1>
      <p className="mx-auto mt-6 max-w-xl text-lg text-ink-2">
        This is your new site. Tell Supasito what it should say and look like, or click any element in the preview and describe the change.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <a href="#contact" className="bg-ink px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-paper">
          Get in touch
        </a>
        <a href="#features" className="border border-ink px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em]">
          How it works
        </a>
      </div>
    </section>
  );
}
