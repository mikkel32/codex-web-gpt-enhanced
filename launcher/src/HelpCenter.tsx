import { useState } from "react";
import { guidedCopy } from "./guided-copy";
import { GuideLoader } from "./GuideLoader";
import { Icon } from "./icons";
import type { Language, Surface } from "./types";

export function HelpCenter({ language, navigate, openRepository }: {
  language: Language; navigate: (surface: Surface) => void; openRepository: () => void;
}) {
  const text = guidedCopy(language);
  const [handbook, setHandbook] = useState(false);
  return <div className="maria-page guided-help">
    <header className="guided-page-heading"><span className="maria-eyebrow">MARIA / {text.help}</span><h1>{text.helpTitle}</h1><p>{text.helpBody}</p></header>
    <div className="guided-help-actions"><button type="button" className="button-primary" onClick={() => navigate("home")}>{text.helpSetup}<Icon name="forward" /></button>
      <button type="button" className="button-secondary" onClick={() => navigate("activity")}>{text.helpActivity}</button></div>
    <section className="guided-faq">{text.helpQuestions.map(([question, answer]) => <details key={question}><summary>{question}<Icon name="chevron" /></summary><p>{answer}</p></details>)}</section>
    <details className="guided-handbook" onToggle={event => setHandbook(event.currentTarget.open)}><summary>{text.handbook}<Icon name="chevron" /></summary>
      {handbook ? <GuideLoader language={language} openRepository={openRepository} /> : null}</details>
  </div>;
}
