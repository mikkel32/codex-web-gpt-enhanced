import mark from "../assets/icon.svg";

export function BrandMark({ small = false }: { small?: boolean }) {
  return <img className={`brand-mark maria-brand-mark${small ? " is-small" : ""}`} src={mark} alt="" aria-hidden="true" draggable={false} />;
}
