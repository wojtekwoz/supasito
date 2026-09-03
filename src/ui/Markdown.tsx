import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(text || "", { async: false }) as string;
    return DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
  }, [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} onClick={(e) => {
    const a = (e.target as HTMLElement).closest("a");
    if (a && a.href) { e.preventDefault(); window.open(a.href, "_blank"); }
  }} />;
}
