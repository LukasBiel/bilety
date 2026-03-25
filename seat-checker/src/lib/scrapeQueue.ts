// Limits concurrent Playwright scraping jobs to prevent server overload.
// All callers queue up and run one at a time.
const MAX_CONCURRENT = 1;

let active = 0;
const queue: Array<() => void> = [];

export async function acquireScrapeSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  return new Promise((resolve) => {
    queue.push(() => {
      active++;
      resolve();
    });
  });
}

export function releaseScrapeSlot(): void {
  active--;
  const next = queue.shift();
  if (next) next();
}
