import { useEffect, useState } from "react";

/** Minimal hash router: "#/tool/merge" -> ["tool", "merge"]. Hash routing works on any static host. */
export function useRoute() {
  const read = () => location.hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const go = (path: string) => {
  location.hash = path;
};

/** Files dropped on the home page, handed to the tool the user picks. */
let pending: File[] = [];
export const handoff = {
  set(files: File[]) {
    pending = files;
  },
  take() {
    const f = pending;
    pending = [];
    return f;
  },
};
