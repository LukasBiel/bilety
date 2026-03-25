import fs from 'fs';
import path from 'path';
import type { JoinedEvent } from './types';

const EVENTS_CACHE_FILE = path.join(process.cwd(), 'data', 'events_cache.json');

export function saveEventsToFile(events: JoinedEvent[]): void {
  try {
    const dir = path.dirname(EVENTS_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(EVENTS_CACHE_FILE, JSON.stringify(events, null, 2));
  } catch (e) {
    console.error('Failed to save events to file:', e);
  }
}

export function loadEventFromFile(id: string): JoinedEvent | null {
  try {
    if (!fs.existsSync(EVENTS_CACHE_FILE)) return null;
    const events: JoinedEvent[] = JSON.parse(fs.readFileSync(EVENTS_CACHE_FILE, 'utf-8'));
    return events.find(e => e.globalEventId === id) ?? null;
  } catch (e) {
    console.error('Failed to load event from file:', e);
    return null;
  }
}
