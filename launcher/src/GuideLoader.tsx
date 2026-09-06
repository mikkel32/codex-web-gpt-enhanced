import { useEffect, useState } from "react";
import type { Language } from "./types";
import { studioCopy } from "./studio-copy";

let loaded: typeof import("./MariaGuide")["default"] | undefined;
let pending: Promise<typeof import("./MariaGuide")> | undefined;
function loadGuide() {
  pending ??= import("./MariaGuide").then(module => { loaded = module.default; return module; })
    .catch(error => { pending = undefined; throw error; });
  return pending;
}

export function GuideLoader({ language, openRepository }: { language: Language; openRepository: () => void }) {
  const [Guide, setGuide] = useState(() => loaded);
  const [failed, setFailed] = useState(false);
  const s = studioCopy(language);
  useEffect(() => {
    if (Guide) return;
    let active = true;
    void loadGuide().then(module => { if (active) setGuide(() => module.default); },
      () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [Guide]);
  if (Guide) return <Guide openRepository={openRepository} />;
  return <div className="maria-page"><p role={failed ? "alert" : "status"}>{failed ? s.guideUnavailable : s.openingGuide}</p>
    {failed ? <button className="button-secondary" onClick={openRepository}>{s.guideOnline}</button> : null}</div>;
}
