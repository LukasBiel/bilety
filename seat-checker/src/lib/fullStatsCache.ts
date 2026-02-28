import fs from 'fs';
import path from 'path';
import type { CombinedEventStats } from './types';

const CACHE_DIR = path.join(process.cwd(), 'data', 'full_stats_cache');

function getCacheFilePath(eventId: string): string {
    // Sanitize ID to be safe for filenames
    const safeId = eventId.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(CACHE_DIR, `${safeId}.json`);
}

function ensureCacheDir(): void {
    try {
        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
        }
    } catch (error) {
        console.error('Error ensuring cache directory exists:', error);
    }
}

export function loadFullStats(eventId: string): CombinedEventStats | null {
    try {
        const filePath = getCacheFilePath(eventId);
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.warn(`Failed to load cached stats for ${eventId}:`, error);
    }
    return null;
}

export function saveFullStats(eventId: string, stats: CombinedEventStats): void {
    try {
        ensureCacheDir();
        const filePath = getCacheFilePath(eventId);

        // Add/Update lastFetched timestamp
        const statsToSave = {
            ...stats,
            lastFetched: new Date().toISOString()
        };

        fs.writeFileSync(filePath, JSON.stringify(statsToSave, null, 2));
    } catch (error) {
        console.error(`Failed to save cached stats for ${eventId}:`, error);
    }
}

export function clearFullStats(eventId: string): void {
    try {
        const filePath = getCacheFilePath(eventId);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        console.warn(`Failed to delete full stats cache for ${eventId}:`, error);
    }
}
