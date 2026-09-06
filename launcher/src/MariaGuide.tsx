import { useState, type ReactNode } from "react";
import { Icon } from "./icons";
import readme from "../../README.md?raw";

function inline(text: string, openLink?: (url: string) => void): ReactNode[] {
  return text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const url = link[2]!.startsWith("docs/") ? `https://github.com/mikkel32/codex-web-gpt-enhanced/blob/main/${link[2]}` : link[2]!;
      return <button className="text-button maria-guide-link" key={i} onClick={() => openLink?.(url)}>{link[1]}</button>;
    }
    return part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part;
  });
}

// Render the shipped README as React text; no raw HTML or remotely loaded content.
export default function MariaGuide({ openRepository }: { openRepository: () => void }) {
  const [linkError, setLinkError] = useState("");
  const renderInline = (value: string) => inline(value, url => {
    setLinkError("");
    void window.codexWebLauncher!.openExternal(url).catch(() => setLinkError("Couldn't open the link. Open our repository to find this page."));
  });
  const nodes: ReactNode[] = [];
  const lines = readme.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("[![CI]")) continue;
    if (line.startsWith("```")) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i]!);
      nodes.push(<pre key={i}><code>{code.join("\n")}</code></pre>);
    } else if (line.startsWith("### ")) nodes.push(<h3 key={i}>{renderInline(line.slice(4))}</h3>);
    else if (line.startsWith("## ")) nodes.push(<h2 key={i}>{renderInline(line.slice(3))}</h2>);
    else if (line.startsWith("# ")) nodes.push(<h1 key={i}>{renderInline(line.slice(2))}</h1>);
    else if (/^[-*] /.test(line)) {
      const items = [line.slice(2)];
      while (/^[-*] /.test(lines[i + 1] ?? "")) items.push(lines[++i]!.slice(2));
      nodes.push(<ul key={i}>{items.map((t, n) => <li key={n}>{renderInline(t)}</li>)}</ul>);
    } else if (line.trim()) {
      const paragraph = [line];
      while (lines[i + 1]?.trim() && !/^(#|[-*] |```)/.test(lines[i + 1]!)) paragraph.push(lines[++i]!);
      nodes.push(<p key={i}>{renderInline(paragraph.join(" "))}</p>);
    }
  }
  return <div className="maria-page maria-guide"><div className="maria-guide-heading"><span className="maria-eyebrow">THE MARIA HANDBOOK</span><button className="button-secondary" onClick={openRepository}><Icon name="github" /> Our source code</button></div><article>{linkError ? <p role="alert">{linkError}</p> : null}{nodes}</article></div>;
}
