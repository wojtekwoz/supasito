const features = [
  { title: "Made from words", body: "Every part of this page came from a sentence. Change the sentence, change the page." },
  { title: "Real code underneath", body: "Next.js, Tailwind and TypeScript in a folder you own. No lock-in, no export step." },
  { title: "Ready to publish", body: "One command puts it on the web. Supasito runs it for you and hands back the link." },
];

export function Features() {
  return (
    <section id="features" className="grid gap-4 px-8 pb-24 md:grid-cols-3">
      {features.map((f) => (
        <article key={f.title} className="border border-line bg-white p-6">
          <h3 className="font-display text-2xl">{f.title}</h3>
          <p className="mt-2 text-ink-2">{f.body}</p>
        </article>
      ))}
    </section>
  );
}
