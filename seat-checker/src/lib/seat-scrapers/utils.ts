import type { SectorStats } from '../types';

// Roman numeral to Arabic conversion (must match frontend normalization!)
export const ROMAN_MAP: Record<string, number> = {
    'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5,
    'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10,
    'XI': 11, 'XII': 12, 'XIII': 13, 'XIV': 14, 'XV': 15,
    'XVI': 16, 'XVII': 17, 'XVIII': 18, 'XIX': 19, 'XX': 20,
    'XXI': 21, 'XXII': 22, 'XXIII': 23, 'XXIV': 24, 'XXV': 25,
    'XXVI': 26, 'XXVII': 27, 'XXVIII': 28, 'XXIX': 29, 'XXX': 30,
};

export function normalizeRowName(row: string): string {
    const trimmed = row.trim().toUpperCase();

    // Check if it's a pure Roman numeral
    if (ROMAN_MAP[trimmed] !== undefined) {
        return String(ROMAN_MAP[trimmed]);
    }

    // Try to extract number from strings like "Rząd 5" or "Row V"
    const match = trimmed.match(/(\d+|[IVXLC]+)$/);
    if (match) {
        const numPart = match[1];
        if (ROMAN_MAP[numPart] !== undefined) {
            return String(ROMAN_MAP[numPart]);
        }
        return numPart; // Already Arabic number
    }

    return trimmed.toLowerCase();
}

export function normalizeSeatKey(seatKey: string): string {
    const parts = seatKey.split('-');
    if (parts.length >= 2) {
        const row = normalizeRowName(parts[0]);
        const seat = parts.slice(1).join('-');
        return `${row}-${seat}`;
    }
    return seatKey;
}

// Match ebilet/biletyna sector to kupbilecik sector by row structure similarity
// matchedSectors: Set of sector names already matched (to prevent duplicates)
export function matchSectorByStructure(
    ebiletRows: Map<string, { total: number; free: number; taken: number }>,
    kupbilecikSectors: SectorStats[],
    matchedSectors?: Set<string>
): SectorStats | null {
    let bestMatch: SectorStats | null = null;
    let bestScore = 0;

    const ebiletRowNames = Array.from(ebiletRows.keys());
    const ebiletRowCount = ebiletRowNames.length;
    const ebiletTotalSeats = Array.from(ebiletRows.values()).reduce((sum, r) => sum + r.total, 0);

    // Normalize eBilet row names for comparison
    const normalizedEbiletRows = new Set(ebiletRowNames.map(normalizeRowName));

    for (const sector of kupbilecikSectors) {
        // Skip already-matched sectors
        if (matchedSectors?.has(sector.sectorName)) {
            continue;
        }

        const kbRowNames = Object.keys(sector.rows);
        const kbRowCount = kbRowNames.length;
        const kbTotalSeats = sector.totals.total;

        // Stricter check 1: if row counts differ by more than 30%, skip this sector entirely
        const rowCountDiff = Math.abs(ebiletRowCount - kbRowCount) / Math.max(ebiletRowCount, kbRowCount, 1);
        if (rowCountDiff > 0.3) {
            continue;
        }

        // Score based on:
        // 1. Row count similarity (0-30 points) - EXACT match gets 30
        // 2. Total seat count similarity (0-30 points) - EXACT match gets 30
        // 3. Row NAME matching (0-40 points) - NEW!
        let score = 0;

        // Row count similarity (exact match = 30pts, else scaled)
        if (ebiletRowCount === kbRowCount) {
            score += 30;
        } else {
            score += Math.max(0, 30 - rowCountDiff * 100); // Stronger penalty for row mismatch
        }

        // Seat count similarity (EXACT match = 30pts, else scaled)
        const seatDiffPercent = Math.abs(ebiletTotalSeats - kbTotalSeats) / Math.max(ebiletTotalSeats, kbTotalSeats, 1);
        if (ebiletTotalSeats === kbTotalSeats) {
            score += 30;
        } else {
            score += Math.max(0, 30 - (seatDiffPercent * 150));
        }

        // Row NAME matching - compare normalized row names
        const normalizedKbRows = new Set(kbRowNames.map(normalizeRowName));
        let matchingRowNames = 0;
        for (const normalizedRow of normalizedEbiletRows) {
            if (normalizedKbRows.has(normalizedRow)) {
                matchingRowNames++;
            }
        }
        const rowNameMatchRatio = matchingRowNames / Math.max(ebiletRowCount, 1);
        score += rowNameMatchRatio * 40;

        console.log(`Sector matching: Candidate(${ebiletRowCount} rows, ${ebiletTotalSeats} seats) vs ${sector.sectorName}(${kbRowCount} rows, ${kbTotalSeats} seats) - score=${score.toFixed(1)}, rowNameMatch=${matchingRowNames}/${ebiletRowCount}`);

        if (score > bestScore) {
            bestScore = score;
            bestMatch = sector;
        }
    }

    // Only return match if score is reasonably high (raised threshold)
    if (bestScore >= 50 && bestMatch) {
        // Mark this sector as matched
        if (matchedSectors) {
            matchedSectors.add(bestMatch.sectorName);
        }
        console.log(`Sector match result: score=${bestScore.toFixed(1)}, matched="${bestMatch.sectorName}"`);
        return bestMatch;
    }

    console.log(`Sector match result: score=${bestScore.toFixed(1)}, no match (threshold=50)`);
    return null;
}
