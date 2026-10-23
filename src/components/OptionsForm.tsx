import type { Option, Opts } from "../tools/registry";

export function defaultOpts(options: Option[] = []): Opts {
  const o: Opts = {};
  for (const opt of options) {
    if (opt.type === "checkbox") o[opt.name] = opt.default ? "on" : "";
    else o[opt.name] = opt.default ?? "";
  }
  return o;
}

export function visible(opt: Option, values: Opts) {
  if (!opt.showIf) return true;
  const [key, want] = opt.showIf;
  return want.startsWith("!") ? values[key] !== want.slice(1) : values[key] === want;
}

export function OptionsForm({ options, values, onChange }: { options: Option[]; values: Opts; onChange: (v: Opts) => void }) {
  const set = (k: string, v: string) => onChange({ ...values, [k]: v });
  return (
    <>
      {options.filter((o) => visible(o, values)).map((o) => {
        const id = `opt-${o.name}`;
        if (o.type === "checkbox") {
          return (
            <label className="check" key={o.name}>
              <input type="checkbox" checked={values[o.name] === "on"} onChange={(e) => set(o.name, e.target.checked ? "on" : "")} />
              {o.label}
            </label>
          );
        }
        return (
          <div className="field" key={o.name}>
            <label htmlFor={id}>{o.label}</label>
            {o.type === "select" ? (
              <select id={id} className="select" value={values[o.name]} onChange={(e) => set(o.name, e.target.value)}>
                {o.choices.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                className="input"
                type={o.type}
                value={values[o.name] ?? ""}
                placeholder={o.placeholder}
                min={o.type === "number" ? 1 : undefined}
                inputMode={o.type === "number" ? "numeric" : undefined}
                autoComplete={o.type === "password" ? "new-password" : "off"}
                onChange={(e) => set(o.name, e.target.value)}
              />
            )}
            {o.help && <div className="help">{o.help}</div>}
          </div>
        );
      })}
    </>
  );
}
