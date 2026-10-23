/**
 * Parse page ranges like "1-3, 5, 8-last" into 0-based indexes.
 * Order is preserved, so "3,1,2" can be used to reorder pages.
 */
export function parseRanges(text: string, count: number): number[] {
  const src = (text || "").trim().toLowerCase().replace(/\blast\b/g, String(count)).replace(/end/g, String(count));
  if (!src) throw new Error("Enter the pages, for example 1-3, 5");
  const pages: number[] = [];
  for (const part of src.split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    let nums: number[];
    if (m) {
      const a = m[1] ? +m[1] : 1;
      const b = m[2] ? +m[2] : count;
      const step = b >= a ? 1 : -1;
      nums = [];
      for (let n = a; step > 0 ? n <= b : n >= b; n += step) nums.push(n);
    } else if (/^\d+$/.test(part)) {
      nums = [+part];
    } else {
      throw new Error(`"${part}" isn't a page range. Use something like 1-3, 5`);
    }
    for (const n of nums) {
      if (n < 1 || n > count) throw new Error(`Page ${n} doesn't exist. This PDF has ${count} page${count === 1 ? "" : "s"}.`);
      pages.push(n - 1);
    }
  }
  return pages;
}

/** "1-2; 5-last" -> [[0,1],[4,...]] */
export function parseGroups(text: string, count: number): number[][] {
  const groups = (text || "").split(";").map((g) => g.trim()).filter(Boolean).map((g) => parseRanges(g, count));
  if (!groups.length) throw new Error("Enter groups like 1-3; 4-6; 7-last");
  return groups;
}
