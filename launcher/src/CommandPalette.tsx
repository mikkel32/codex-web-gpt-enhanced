import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";
import { copyFor } from "./i18n";
import { studioCopy } from "./studio-copy";
import type { Language, Surface } from "./types";

export function CommandPalette({ open, close, navigate, language }: {
  open: boolean; close: () => void; navigate: (surface: Surface) => void; language: Language;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const c = copyFor(language);
  const s = studioCopy(language);
  const pages: { id: Surface; label: string; icon: IconName }[] = [
    { id: "home", label: c.overview, icon: "globe" },
    { id: "browser", label: c.browser, icon: "browser" },
    { id: "setup", label: c.setup, icon: "setup" },
    { id: "mcp", label: s.tools, icon: "mcp" },
    { id: "activity", label: c.activity, icon: "activity" },
    { id: "settings", label: c.settings, icon: "settings" },
    { id: "updates", label: language === "en" ? "Updates" : language === "ja" ? "アップデート" : "更新", icon: "update" },
    { id: "guide", label: c.guide, icon: "logs" },
  ];
  const results = pages.filter(page => page.label.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  useEffect(() => {
    if (open) { setQuery(""); setSelected(0); dialog.current?.showModal(); input.current?.focus(); }
    else dialog.current?.close();
  }, [open]);
  const choose = (surface: Surface) => { close(); navigate(surface); };
  return <dialog ref={dialog} className="command-palette" aria-label={s.command} onCancel={close}
    onClick={event => { if (event.target === dialog.current) close(); }}>
    <div className="command-inner">
      <div className="command-input"><Icon name="globe" /><input ref={input} placeholder={s.search} aria-label={s.search}
        value={query} role="combobox" aria-expanded="true" aria-controls="command-results"
        aria-activedescendant={results[selected] ? `command-${results[selected]!.id}` : undefined}
        onChange={event => { setQuery(event.target.value); setSelected(0); }}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setSelected(value => results.length ? (value + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length : 0);
          } else if (event.key === "Enter" && results[selected]) { event.preventDefault(); choose(results[selected]!.id); }
        }} /><button className="icon-button" aria-label={s.closeHint} onClick={close}><Icon name="close" /></button></div>
      <div className="command-results" id="command-results" role="listbox">
        {results.map((page, index) => <button key={page.id} id={`command-${page.id}`} role="option" aria-selected={index === selected}
          className={index === selected ? "is-selected" : ""} onMouseMove={() => setSelected(index)} onClick={() => choose(page.id)}>
          <Icon name={page.icon} /><span>{page.label}</span><Icon name="forward" />
        </button>)}
        {!results.length ? <p className="command-empty">{s.noResults}</p> : null}
      </div>
      <footer><span><kbd>↑ ↓</kbd> {s.keyboardHint}</span><span><kbd>↵</kbd> {s.selectHint}</span><span><kbd>esc</kbd> {s.closeHint}</span></footer>
    </div>
  </dialog>;
}
