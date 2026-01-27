import fs from 'fs';
import path from 'path';

const CACHE_FILE = path.join(process.cwd(), 'data', 'url_cache.json');

interface CacheEntry {
    url: string;
    source: string;
    timestamp: number;
}

interface UrlCache {
    [key: string]: CacheEntry;
}

// Ensure cache directory exists
function ensureCacheDir() {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Load cache from file
function loadCache(): UrlCache {
    try {
        ensureCacheDir();
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.warn('Failed to load URL cache:', error);
    }
    return {};
}

// Save cache to file
function saveCache(cache: UrlCache) {
    try {
        ensureCacheDir();
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (error) {
        console.error('Failed to save URL cache:', error);
    }
}

export function getCachedUrl(eventId: string, source: string): string | null {
    const cache = loadCache();
    const key = `${eventId}:${source}`;
    const entry = cache[key];

    if (entry) {
        // Optional: Add expiration logic here (e.g., 24h)
        // const age = Date.now() - entry.timestamp;
        // if (age < 24 * 60 * 60 * 1000) return entry.url;
        return entry.url;
    }
    return null;
}

export function setCachedUrl(eventId: string, source: string, url: string) {
    const cache = loadCache();
    const key = `${eventId}:${source}`;

    cache[key] = {
        url,
        source,
        timestamp: Date.now(),
    };

    saveCache(cache);
}

export function touchCachedUrl(eventId: string, source: string) {
    const cache = loadCache();
    const key = `${eventId}:${source}`;

    if (cache[key]) {
        cache[key].timestamp = Date.now();
        saveCache(cache);
    }
}

export function clearCachedUrl(eventId: string, source: string) {
    const cache = loadCache();
    const key = `${eventId}:${source}`;

    if (cache[key]) {
        delete cache[key];
        saveCache(cache);
    }
}

export function hasCachedData(eventId: string): boolean {
    const cache = loadCache();
    // Check if any key starts with eventId:
    return Object.keys(cache).some(key => key.startsWith(`${eventId}:`));
}

export function getCacheTimestamp(eventId: string): number | null {
    const cache = loadCache();
    let maxTimestamp = 0;
    let found = false;

    for (const key of Object.keys(cache)) {
        if (key.startsWith(`${eventId}:`)) {
            const entry = cache[key];
            if (entry.timestamp > maxTimestamp) {
                maxTimestamp = entry.timestamp;
                found = true;
            }
        }
    }

    return found ? maxTimestamp : null;
}
