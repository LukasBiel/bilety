import * as fs from 'fs/promises';
import * as path from 'path';

export type SourceType = 'biletyna' | 'ebilet' | 'kupbilecik';

// Key format: "SectorName:Row-Seat"
export type SeatHistory = Record<string, SourceType>;

function getDataDir(): string {
    return path.join(process.cwd(), 'data', 'history');
}

function getHistoryFilePath(eventId: string): string {
    const safeId = eventId.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(getDataDir(), `${safeId}.json`);
}

export async function ensureHistoryDir(): Promise<void> {
    const dataDir = getDataDir();
    try {
        await fs.access(dataDir);
    } catch {
        await fs.mkdir(dataDir, { recursive: true });
    }
}

export async function loadHistory(eventId: string): Promise<SeatHistory> {
    try {
        await ensureHistoryDir();
        const filePath = getHistoryFilePath(eventId);
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return {};
        }
        console.error('Error loading history:', error);
        return {};
    }
}

export async function saveHistory(eventId: string, history: SeatHistory): Promise<void> {
    try {
        await ensureHistoryDir();
        const filePath = getHistoryFilePath(eventId);
        await fs.writeFile(filePath, JSON.stringify(history, null, 2));
    } catch (error) {
        console.error('Error saving history:', error);
    }
}

export async function clearHistory(eventId: string): Promise<void> {
    try {
        const filePath = getHistoryFilePath(eventId);
        await fs.unlink(filePath);
    } catch (error: any) {
        if (error.code !== 'ENOENT') {
            console.error('Error clearing history:', error);
        }
    }
}
