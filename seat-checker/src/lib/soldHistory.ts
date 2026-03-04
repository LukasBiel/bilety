import * as fs from 'fs/promises';
import * as path from 'path';
import type { SourceType } from './types';

// Osobna kategoria śledzenia sprzedanych biletów
// Klucz: "SectorName:Row-Seat", Wartość: Źródło, z którego bilet zniknął na stałe
export type SoldHistory = Record<string, SourceType>;

function getDataDir(): string {
    return path.join(process.cwd(), 'data', 'sold_history');
}

function getSoldHistoryFilePath(eventId: string): string {
    const safeId = eventId.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(getDataDir(), `${safeId}.json`);
}

export async function ensureSoldHistoryDir(): Promise<void> {
    const dataDir = getDataDir();
    try {
        await fs.access(dataDir);
    } catch {
        await fs.mkdir(dataDir, { recursive: true });
    }
}

// Zwraca historię WSZYSTKICH dotychczas sprzedanych biletów (trwały zapis)
export async function loadSoldHistory(eventId: string): Promise<SoldHistory> {
    try {
        await ensureSoldHistoryDir();
        const filePath = getSoldHistoryFilePath(eventId);
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return {};
        }
        console.error('Error loading sold history:', error);
        return {};
    }
}

// Dodaje NOWE sprzedane bilety do istniejącego pliku (NIGDY NIE KASUJE STARYCH)
export async function appendToSoldHistory(eventId: string, newSoldSeats: SoldHistory): Promise<SoldHistory> {
    try {
        if (Object.keys(newSoldSeats).length === 0) return await loadSoldHistory(eventId);

        const currentHistory = await loadSoldHistory(eventId);

        // Łączymy stare sprzedaże z nowymi
        const updatedHistory = { ...currentHistory, ...newSoldSeats };

        await ensureSoldHistoryDir();
        const filePath = getSoldHistoryFilePath(eventId);
        await fs.writeFile(filePath, JSON.stringify(updatedHistory, null, 2));

        return updatedHistory;
    } catch (error) {
        console.error('Error appending to sold history:', error);
        return {};
    }
}

export async function clearSoldHistory(eventId: string): Promise<void> {
    try {
        const filePath = getSoldHistoryFilePath(eventId);
        await fs.unlink(filePath);
    } catch (error: any) {
        if (error.code !== 'ENOENT') {
            console.error('Error clearing sold history:', error);
        }
    }
}
