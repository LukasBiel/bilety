import fs from 'fs';
import path from 'path';

const STATS_HISTORY_FILE = path.join(process.cwd(), 'data', 'stats_history.json');

export interface StatsHistoryEntry {
    biletynaTaken: number;
    ebiletTaken: number;
    kupbilecikTaken: number;
    timestamp: string;
}

export async function loadStatsHistory(eventId: string): Promise<StatsHistoryEntry | null> {
    try {
        if (fs.existsSync(STATS_HISTORY_FILE)) {
            const data = await fs.promises.readFile(STATS_HISTORY_FILE, 'utf-8');
            const history = JSON.parse(data);
            return history[eventId] || null;
        }
    } catch (error) {
        console.error('Error loading stats history:', error);
    }
    return null;
}

export async function saveStatsHistory(eventId: string, entry: StatsHistoryEntry) {
    try {
        const dir = path.dirname(STATS_HISTORY_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        let history: Record<string, StatsHistoryEntry> = {};
        if (fs.existsSync(STATS_HISTORY_FILE)) {
            const data = await fs.promises.readFile(STATS_HISTORY_FILE, 'utf-8');
            history = JSON.parse(data);
        }

        history[eventId] = entry;
        await fs.promises.writeFile(STATS_HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (error) {
        console.error('Error saving stats history:', error);
    }
}
