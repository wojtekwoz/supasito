import { site } from "@/site";

export function Footer() {
  return (
    <footer id="contact" className="border-t border-line px-8 py-8 text-sm text-ink-2">
      © {site.name} · {site.email}
    </footer>
  );
}
