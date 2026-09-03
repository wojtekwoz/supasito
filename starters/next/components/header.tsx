import Link from "next/link";

const nav = [
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#contact", label: "Contact" },
];

export function Header() {
  return (
    <header className="flex items-center justify-between px-8 py-5">
      <Link href="/" className="font-semibold tracking-tight">
        New site
      </Link>
      <nav className="flex gap-6 text-[11px] uppercase tracking-[0.14em] text-ink-2">
        {nav.map((item) => (
          <a key={item.href} href={item.href} className="hover:text-ink">
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
