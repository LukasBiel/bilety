'use client';

import { useState, useEffect, useMemo } from 'react';

// Types
interface SourceData {
  eventCardUrl: string;
  buyButtonSelector: string;
  venue?: string;
}

interface JoinedEvent {
  globalEventId: string;
  title: string;
  date: string;
  time: string;
  city: string;
  sources: {
    biletyna?: SourceData;
    ebilet?: SourceData;
    kupbilecik?: SourceData;
  };
  hasCache?: boolean;
  cacheTimestamp?: number;
  isNew?: boolean;
}

interface RowStats {
  total: number;
  free: number;
  taken: number;
}

interface SectorStats {
  sectorName: string;
  rows: Record<string, RowStats>;
  freeSeats: string[];
  takenSeats: string[];
  totals: {
    total: number;
    free: number;
    taken: number;
  };
}

interface SourceStats {
  source: 'biletyna' | 'ebilet' | 'kupbilecik';
  totals: {
    total: number;
    free: number;
    taken: number;
  };
  rows: Record<string, RowStats>;
  freeSeats: string[];
  takenSeats: string[];
  sectors?: SectorStats[];
  finalUrl?: string;
}

interface CombinedEventStats {
  globalEventId: string;
  title: string;
  date: string;
  perSource: {
    biletyna?: SourceStats;
    ebilet?: SourceStats;
    kupbilecik?: SourceStats;
  };
  combinedTotals: {
    total: number;
    free: number;
    taken: number;
  };
  inferredSold?: Record<string, 'biletyna' | 'ebilet' | 'kupbilecik'>;
  diff?: {
    biletynaTaken: number;
    ebiletTaken: number;
    kupbilecikTaken: number;
    lastUpdated: string;
  };
}

type SourceType = 'biletyna' | 'ebilet' | 'kupbilecik';

const SOURCE_COLORS = {
  biletyna: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-500' },
  ebilet: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-500' },
  kupbilecik: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-500' },
};

const SOURCE_LABELS = {
  biletyna: 'B',
  ebilet: 'E',
  kupbilecik: 'K',
};

// Kolory dla wizualizacji miejsc (7 kolorow)
const SEAT_COLORS = {
  biletyna: {
    free: '#DDA0DD',      // jasny fioletowy
    taken: '#800080',     // ciemny fioletowy
  },
  ebilet: {
    free: '#FFFF99',      // jasny zolty
    taken: '#DAA520',     // ciemny zloty/zolty (goldenrod - jasniejszy)
  },
  kupbilecik: {
    free: '#FF9999',      // jasny czerwony
    taken: '#8B0000',     // ciemny czerwony
  },
  noData: '#808080',      // szary
  // Kolory specjalne (tylko do recznego malowania)
  notForSale: '#000000',  // czarny - miejsca nie w sprzedazy
  otherSource: '#5DADE2', // niebieski (ciemniejszy) - bilety z innych bileterii
  boxOffice: '#1ABC9C',   // turkusowy zielonkawy - do kupienia w kasie na miejscu
};

// Konwersja rzymskich na arabskie
const ROMAN_MAP: Record<string, number> = {
  'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5,
  'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10,
  'XI': 11, 'XII': 12, 'XIII': 13, 'XIV': 14, 'XV': 15,
  'XVI': 16, 'XVII': 17, 'XVIII': 18, 'XIX': 19, 'XX': 20,
  'XXI': 21, 'XXII': 22, 'XXIII': 23, 'XXIV': 24, 'XXV': 25,
  'XXVI': 26, 'XXVII': 27, 'XXVIII': 28, 'XXIX': 29, 'XXX': 30,
};

function normalizeRowName(row: string): string {
  // Sprawdz czy to liczba rzymska (uppercase)
  const upperRow = row.toUpperCase().trim();
  if (ROMAN_MAP[upperRow] !== undefined) {
    return String(ROMAN_MAP[upperRow]);
  }
  // Jesli to juz liczba arabska, zwroc ja
  return row.trim();
}

function normalizeSeatKey(seatKey: string): string {
  const parts = seatKey.split('-');
  if (parts.length >= 2) {
    const row = normalizeRowName(parts[0]);
    const seat = parts.slice(1).join('-');
    return `${row}-${seat}`;
  }
  return seatKey;
}

// Helper: check if kupbilecik has multiple sectors
function hasMultipleSectors(perSource: CombinedEventStats['perSource']): boolean {
  const kupbilecik = perSource.kupbilecik;
  return !!(kupbilecik?.sectors && kupbilecik.sectors.length > 1);
}

// Get kupbilecik sectors as the base
function getKupbilecikSectors(perSource: CombinedEventStats['perSource']): SectorStats[] {
  return perSource.kupbilecik?.sectors || [];
}

// Helper to get sector data from source stats
function getSectorData(sourceStats: SourceStats | undefined, sectorName: string): SectorStats | null {
  if (!sourceStats?.sectors) return null;
  return sourceStats.sectors.find(s => s.sectorName === sectorName) || null;
}

// Get all unique sector names from all sources (legacy, for fallback)
function getUnifiedSectors(perSource: CombinedEventStats['perSource']): string[] {
  const sectorNames = new Set<string>();

  for (const portal of ['biletyna', 'ebilet', 'kupbilecik'] as SourceType[]) {
    const sourceStats = perSource[portal];
    if (sourceStats?.sectors) {
      for (const sector of sourceStats.sectors) {
        sectorNames.add(sector.sectorName);
      }
    }
  }

  return Array.from(sectorNames).sort();
}

// Calculate similarity between two sector structures (0-100)
function calculateSectorSimilarity(
  sector1Rows: Record<string, RowStats>,
  sector2Rows: Record<string, RowStats>
): number {
  const rows1 = Object.keys(sector1Rows);
  const rows2 = Object.keys(sector2Rows);

  if (rows1.length === 0 || rows2.length === 0) return 0;

  // Normalize row names for comparison
  const normalizedRows1 = rows1.map(r => normalizeRowName(r));
  const normalizedRows2 = rows2.map(r => normalizeRowName(r));

  // Count matching rows
  const matchingRows = normalizedRows1.filter(r => normalizedRows2.includes(r)).length;
  const rowSimilarity = (matchingRows * 2) / (rows1.length + rows2.length);

  // Compare total seat counts
  const total1 = Object.values(sector1Rows).reduce((sum, r) => sum + r.total, 0);
  const total2 = Object.values(sector2Rows).reduce((sum, r) => sum + r.total, 0);
  const seatDiff = Math.abs(total1 - total2) / Math.max(total1, total2, 1);
  const seatSimilarity = Math.max(0, 1 - seatDiff);

  // Combined score (row structure more important)
  return (rowSimilarity * 60 + seatSimilarity * 40);
}

// Find best matching kupbilecik sector for a given sector from another source
function findMatchingKupbilecikSector(
  otherSectorRows: Record<string, RowStats>,
  kupbilecikSectors: SectorStats[],
  threshold: number = 50
): SectorStats | null {
  let bestMatch: SectorStats | null = null;
  let bestScore = 0;

  for (const kbSector of kupbilecikSectors) {
    const score = calculateSectorSimilarity(otherSectorRows, kbSector.rows);
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      bestMatch = kbSector;
    }
  }

  return bestMatch;
}

// Calculate visualization for a kupbilecik sector with overlaid data from other sources
function calculateSectorVisualizationWithBase(
  kbSector: SectorStats,
  perSource: CombinedEventStats['perSource'],
  inferredSold?: Record<string, SourceType>
) {
  const portals: SourceType[] = ['biletyna', 'ebilet', 'kupbilecik'];

  // Use kupbilecik's seat layout as the base
  const seatsPerRow = new Map<string, string[]>();
  const seatStatuses = new Map<string, Record<SourceType, 'free' | 'taken' | null>>();

  // Initialize from kupbilecik sector
  for (const seat of kbSector.freeSeats) {
    const normalizedSeat = normalizeSeatKey(seat);
    seatStatuses.set(normalizedSeat, { biletyna: null, ebilet: null, kupbilecik: 'free' });

    const parts = normalizedSeat.split('-');
    const row = parts[0];
    const seatName = parts.slice(1).join('-');
    if (!seatsPerRow.has(row)) seatsPerRow.set(row, []);
    seatsPerRow.get(row)!.push(seatName);
  }

  for (const seat of kbSector.takenSeats) {
    const normalizedSeat = normalizeSeatKey(seat);
    seatStatuses.set(normalizedSeat, { biletyna: null, ebilet: null, kupbilecik: 'taken' });

    const parts = normalizedSeat.split('-');
    const row = parts[0];
    const seatName = parts.slice(1).join('-');
    if (!seatsPerRow.has(row)) seatsPerRow.set(row, []);
    if (!seatsPerRow.get(row)!.includes(seatName)) {
      seatsPerRow.get(row)!.push(seatName);
    }
  }

  // Find matching sectors from biletyna and ebilet
  for (const portal of ['biletyna', 'ebilet'] as SourceType[]) {
    const sourceStats = perSource[portal];
    if (!sourceStats?.sectors) continue;

    // Find best matching sector
    // 1. Try exact name match (backend rewrites names on match) - TRUST BACKEND ONLY
    let matchingSector = sourceStats.sectors.find(s => s.sectorName === kbSector.sectorName);

    // REMOVED: Fallback similarity check. 
    // Allowing frontend to guess based on shape causes "recycling" of sectors 
    // (e.g. using Loża Lewa data for Loża Prawa because they look similar).

    if (!matchingSector) continue;

    if (!matchingSector) continue;

    // Overlay data from matching sector
    for (const seat of matchingSector.freeSeats) {
      const normalizedSeat = normalizeSeatKey(seat);
      if (seatStatuses.has(normalizedSeat)) {
        seatStatuses.get(normalizedSeat)![portal] = 'free';
      }
    }

    for (const seat of matchingSector.takenSeats) {
      const normalizedSeat = normalizeSeatKey(seat);
      if (seatStatuses.has(normalizedSeat)) {
        seatStatuses.get(normalizedSeat)![portal] = 'taken';
      }
    }
  }

  // Sort seats in each row numerically
  for (const [row, seats] of seatsPerRow) {
    seats.sort((a, b) => {
      const numA = parseInt(a) || 0;
      const numB = parseInt(b) || 0;
      return numA - numB;
    });
  }

  // Determine rows with free seats per portal
  const rowsWithFree: Record<SourceType, Set<string>> = {
    biletyna: new Set(), ebilet: new Set(), kupbilecik: new Set(),
  };

  for (const [seatKey, statuses] of seatStatuses) {
    const row = seatKey.split('-')[0];
    for (const portal of portals) {
      if (statuses[portal] === 'free') {
        rowsWithFree[portal].add(row);
      }
    }
  }

  // Calculate colors
  const seatColors = new Map<string, string>();
  let totalSeatsCount = 0;
  const colorStats = {
    biletynaFree: 0, biletynaTaken: 0,
    ebiletFree: 0, ebiletTaken: 0,
    kupbilecikFree: 0, kupbilecikTaken: 0,
    noData: 0,
  };

  for (const [row, seatNames] of seatsPerRow) {
    for (const seatName of seatNames) {
      const seatKey = `${row}-${seatName}`;
      totalSeatsCount++;

      const statuses = seatStatuses.get(seatKey) || { biletyna: null, ebilet: null, kupbilecik: null };

      // Check if free on any portal
      let freeOnPortal: SourceType | null = null;
      for (const portal of portals) {
        if (statuses[portal] === 'free') {
          freeOnPortal = portal;
          break;
        }
      }

      if (freeOnPortal) {
        seatColors.set(seatKey, SEAT_COLORS[freeOnPortal].free);
        if (freeOnPortal === 'biletyna') colorStats.biletynaFree++;
        else if (freeOnPortal === 'ebilet') colorStats.ebiletFree++;
        else colorStats.kupbilecikFree++;

        continue;
      }



      // Check history for "Sold" inference
      const uniqueKey = `${kbSector.sectorName}:${seatKey}`;
      if (inferredSold && inferredSold[uniqueKey]) {
        const soldSource = inferredSold[uniqueKey];
        seatColors.set(seatKey, SEAT_COLORS[soldSource].taken);

        if (soldSource === 'biletyna') colorStats.biletynaTaken++;
        else if (soldSource === 'ebilet') colorStats.ebiletTaken++;
        else colorStats.kupbilecikTaken++;
        continue;
      }

      seatColors.set(seatKey, SEAT_COLORS.noData);
      colorStats.noData++;
    }
  }

  // Sort rows
  const sortedRows = Array.from(seatsPerRow.keys()).sort((a, b) => {
    const numA = parseInt(a);
    const numB = parseInt(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });

  return {
    sectorName: kbSector.sectorName,
    seatColors,
    seatsPerRow,
    sortedRows,
    totalSeats: totalSeatsCount,
    colorStats,
  };
}

// Legacy function for sectors not from kupbilecik
function calculateSectorVisualization(
  sectorName: string,
  perSource: CombinedEventStats['perSource']
) {
  const portals: SourceType[] = ['biletyna', 'ebilet', 'kupbilecik'];
  const seatStatuses = new Map<string, Record<SourceType, 'free' | 'taken' | null>>();

  // Collect seats for this sector from each portal
  for (const portal of portals) {
    const sourceStats = perSource[portal];
    if (!sourceStats?.sectors) continue;

    const sector = sourceStats.sectors.find(s => s.sectorName === sectorName);
    if (!sector) continue;

    for (const seat of sector.freeSeats) {
      const normalizedSeat = normalizeSeatKey(seat);
      if (!seatStatuses.has(normalizedSeat)) {
        seatStatuses.set(normalizedSeat, { biletyna: null, ebilet: null, kupbilecik: null });
      }
      seatStatuses.get(normalizedSeat)![portal] = 'free';
    }

    for (const seat of sector.takenSeats) {
      const normalizedSeat = normalizeSeatKey(seat);
      if (!seatStatuses.has(normalizedSeat)) {
        seatStatuses.set(normalizedSeat, { biletyna: null, ebilet: null, kupbilecik: null });
      }
      seatStatuses.get(normalizedSeat)![portal] = 'taken';
    }
  }

  // Build row structure
  const rowSeatsPerPortal = new Map<string, Map<SourceType, Set<number>>>();
  for (const [seatKey] of seatStatuses) {
    const parts = seatKey.split('-');
    const row = parts[0];
    const seatNum = parseInt(parts[1]) || 0;

    if (!rowSeatsPerPortal.has(row)) {
      rowSeatsPerPortal.set(row, new Map());
      for (const p of portals) {
        rowSeatsPerPortal.get(row)!.set(p, new Set());
      }
    }

    const statuses = seatStatuses.get(seatKey)!;
    for (const portal of portals) {
      if (statuses[portal] !== null) {
        rowSeatsPerPortal.get(row)!.get(portal)!.add(seatNum);
      }
    }
  }

  // Choose best portal's layout per row
  const seatsPerRow = new Map<string, number[]>();
  for (const [row, portalSeats] of rowSeatsPerPortal) {
    let maxSeats = 0;
    let bestPortal: SourceType | null = null;
    for (const portal of portals) {
      const seats = portalSeats.get(portal)!;
      if (seats.size > maxSeats) {
        maxSeats = seats.size;
        bestPortal = portal;
      }
    }
    if (bestPortal) {
      const seats = Array.from(portalSeats.get(bestPortal)!).sort((a, b) => a - b);
      seatsPerRow.set(row, seats);
    }
  }

  // Determine rows with free seats per portal
  const rowsWithFree: Record<SourceType, Set<string>> = {
    biletyna: new Set(), ebilet: new Set(), kupbilecik: new Set(),
  };
  for (const portal of portals) {
    const sectorData = getSectorData(perSource[portal], sectorName);
    if (!sectorData) continue;
    for (const [row, rowStats] of Object.entries(sectorData.rows)) {
      if (rowStats.free > 0) {
        rowsWithFree[portal].add(normalizeRowName(row));
      }
    }
  }

  // Calculate colors
  const seatColors = new Map<string, string>();
  let totalSeatsCount = 0;
  const colorStats = {
    biletynaFree: 0, biletynaTaken: 0,
    ebiletFree: 0, ebiletTaken: 0,
    kupbilecikFree: 0, kupbilecikTaken: 0,
    noData: 0,
  };

  for (const [row, seatNums] of seatsPerRow) {
    for (const seatNum of seatNums) {
      const seatKey = `${row}-${seatNum}`;
      totalSeatsCount++;

      const statuses = seatStatuses.get(seatKey) || { biletyna: null, ebilet: null, kupbilecik: null };

      // Check if free on any portal
      let freeOnPortal: SourceType | null = null;
      for (const portal of portals) {
        if (getSectorData(perSource[portal], sectorName) && statuses[portal] === 'free') {
          freeOnPortal = portal;
          break;
        }
      }

      if (freeOnPortal) {
        seatColors.set(seatKey, SEAT_COLORS[freeOnPortal].free);
        if (freeOnPortal === 'biletyna') colorStats.biletynaFree++;
        else if (freeOnPortal === 'ebilet') colorStats.ebiletFree++;
        else colorStats.kupbilecikFree++;
        continue;
      }

      // Seat is taken - check which portal has free in this row
      const portalsWithFreeInRow: SourceType[] = [];
      for (const portal of portals) {
        if (getSectorData(perSource[portal], sectorName) && rowsWithFree[portal].has(row)) {
          portalsWithFreeInRow.push(portal);
        }
      }

      if (portalsWithFreeInRow.length === 1) {
        const takenOnPortal = portalsWithFreeInRow[0];
        seatColors.set(seatKey, SEAT_COLORS[takenOnPortal].taken);
        if (takenOnPortal === 'biletyna') colorStats.biletynaTaken++;
        else if (takenOnPortal === 'ebilet') colorStats.ebiletTaken++;
        else colorStats.kupbilecikTaken++;
        continue;
      }

      seatColors.set(seatKey, SEAT_COLORS.noData);
      colorStats.noData++;
    }
  }

  // Sort rows
  const sortedRows = Array.from(seatsPerRow.keys()).sort((a, b) => {
    const numA = parseInt(a);
    const numB = parseInt(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });

  return {
    sectorName,
    seatColors,
    seatsPerRow,
    sortedRows,
    totalSeats: totalSeatsCount,
    colorStats,
  };
}

// Funkcja do obliczania kolorow i statystyk dla wizualizacji
function calculateSeatVisualization(
  perSource: CombinedEventStats['perSource'],
  inferredSold?: Record<string, SourceType>,
  defaultSectorName?: string
) {
  const portals: SourceType[] = ['biletyna', 'ebilet', 'kupbilecik'];

  // Zbierz statusy miejsc z kazdego portalu (z normalizacja)
  // Klucz: znormalizowany seatKey, wartosc: status per portal
  const seatStatuses = new Map<string, Record<SourceType, 'free' | 'taken' | null>>();

  for (const portal of portals) {
    const stats = perSource[portal];
    if (!stats) continue;

    for (const seat of stats.freeSeats) {
      const normalizedSeat = normalizeSeatKey(seat);
      if (!seatStatuses.has(normalizedSeat)) {
        seatStatuses.set(normalizedSeat, { biletyna: null, ebilet: null, kupbilecik: null });
      }
      seatStatuses.get(normalizedSeat)![portal] = 'free';
    }

    for (const seat of stats.takenSeats) {
      const normalizedSeat = normalizeSeatKey(seat);
      if (!seatStatuses.has(normalizedSeat)) {
        seatStatuses.set(normalizedSeat, { biletyna: null, ebilet: null, kupbilecik: null });
      }
      seatStatuses.get(normalizedSeat)![portal] = 'taken';
    }
  }

  // Dla kazdego rzedu znajdz portal z najwieksza liczba miejsc
  // i uzyj jego ukladu jako bazowego
  const rowSeatsPerPortal = new Map<string, Map<SourceType, Set<number>>>();

  for (const [seatKey] of seatStatuses) {
    const parts = seatKey.split('-');
    const row = parts[0];
    const seatNum = parseInt(parts[1]) || 0;

    if (!rowSeatsPerPortal.has(row)) {
      rowSeatsPerPortal.set(row, new Map());
      for (const p of portals) {
        rowSeatsPerPortal.get(row)!.set(p, new Set());
      }
    }

    // Sprawdz ktore portale maja to miejsce
    const statuses = seatStatuses.get(seatKey)!;
    for (const portal of portals) {
      if (statuses[portal] !== null) {
        rowSeatsPerPortal.get(row)!.get(portal)!.add(seatNum);
      }
    }
  }

  // Dla kazdego rzedu wybierz uklad z portalu z najwieksza liczba miejsc
  const seatsPerRow = new Map<string, number[]>();

  for (const [row, portalSeats] of rowSeatsPerPortal) {
    let maxSeats = 0;
    let bestPortal: SourceType | null = null;

    for (const portal of portals) {
      const seats = portalSeats.get(portal)!;
      if (seats.size > maxSeats) {
        maxSeats = seats.size;
        bestPortal = portal;
      }
    }

    if (bestPortal) {
      const seats = Array.from(portalSeats.get(bestPortal)!).sort((a, b) => a - b);
      seatsPerRow.set(row, seats);
    }
  }

  // Okresl ktore rzedy maja wolne miejsca na kazdym portalu
  const rowsWithFree: Record<SourceType, Set<string>> = {
    biletyna: new Set(),
    ebilet: new Set(),
    kupbilecik: new Set(),
  };

  for (const portal of portals) {
    const stats = perSource[portal];
    if (!stats) continue;
    for (const [row, rowStats] of Object.entries(stats.rows)) {
      if (rowStats.free > 0) {
        rowsWithFree[portal].add(normalizeRowName(row));
      }
    }
  }

  // Oblicz JEDEN kolor dla kazdego miejsca (7 mozliwych kolorow)
  // Logika:
  // 1. Jesli WOLNE na portalu X -> jasny kolor X
  // 2. Jesli ZAJETE, ale w rzedzie portal X ma wolne miejsca -> ciemny kolor X (kupione na X)
  // 3. Jesli caly rzad zajety wszedzie -> szary (brak danych)
  const seatColors = new Map<string, string>();

  // Statystyki per portal
  const portalStats: Record<SourceType, { free: number; taken: number; noData: number }> = {
    biletyna: { free: 0, taken: 0, noData: 0 },
    ebilet: { free: 0, taken: 0, noData: 0 },
    kupbilecik: { free: 0, taken: 0, noData: 0 },
  };

  // Globalne statystyki (per typ koloru)
  const colorStats = {
    biletynaFree: 0,
    biletynaTaken: 0,
    ebiletFree: 0,
    ebiletTaken: 0,
    kupbilecikFree: 0,
    kupbilecikTaken: 0,
    noData: 0,
  };

  // Iteruj tylko po miejscach z wybranego ukladu
  let totalSeatsCount = 0;
  for (const [row, seatNums] of seatsPerRow) {
    for (const seatNum of seatNums) {
      const seatKey = `${row}-${seatNum}`;
      totalSeatsCount++;

      const statuses = seatStatuses.get(seatKey) || { biletyna: null, ebilet: null, kupbilecik: null };

      // 1. Sprawdz czy miejsce jest WOLNE na ktorymkolwiek portalu
      let freeOnPortal: SourceType | null = null;
      for (const portal of portals) {
        if (perSource[portal] && statuses[portal] === 'free') {
          freeOnPortal = portal;
          break;
        }
      }

      if (freeOnPortal) {
        // Miejsce wolne - jasny kolor tego portalu
        seatColors.set(seatKey, SEAT_COLORS[freeOnPortal].free);
        if (freeOnPortal === 'biletyna') colorStats.biletynaFree++;
        else if (freeOnPortal === 'ebilet') colorStats.ebiletFree++;
        else colorStats.kupbilecikFree++;
        portalStats[freeOnPortal].free++;
        portalStats[freeOnPortal].free++;
        continue;
      }



      // Check history for "Sold" inference
      if (inferredSold && defaultSectorName) {
        // Note: History uses "SectorName:Row-Seat" format
        const uniqueKey = `${defaultSectorName}:${seatKey}`;
        if (inferredSold[uniqueKey]) {
          const soldSource = inferredSold[uniqueKey];
          seatColors.set(seatKey, SEAT_COLORS[soldSource].taken);

          if (soldSource === 'biletyna') colorStats.biletynaTaken++;
          else if (soldSource === 'ebilet') colorStats.ebiletTaken++;
          else colorStats.kupbilecikTaken++;
          portalStats[soldSource].taken++;
          continue;
        }
      }


      /*
      if (portalsWithFreeInRow.length > 1) {
        // Wiecej niz 1 portal ma wolne w tym rzedzie - nie wiemy gdzie kupione
        seatColors.set(seatKey, SEAT_COLORS.noData);
        colorStats.noData++;
        continue;
      }
      */

      // 3. Caly rzad zajety wszedzie - brak danych
      seatColors.set(seatKey, SEAT_COLORS.noData);
      colorStats.noData++;
    }
  }


  // Sortuj rzedy
  const sortedRows = Array.from(seatsPerRow.keys()).sort((a, b) => {
    const numA = parseInt(a);
    const numB = parseInt(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });

  // Znajdz portale ktore maja dane
  const availablePortals = portals.filter(p => perSource[p] !== undefined);

  return {
    seatColors,
    seatsPerRow,
    sortedRows,
    portalStats,
    totalSeats: totalSeatsCount,
    availablePortals,
    colorStats,
  };
}

export default function Home() {
  const [events, setEvents] = useState<JoinedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [sourceDetails, setSourceDetails] = useState<Array<{ source: string; count: number; error?: string }> | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<JoinedEvent | null>(null);
  const [eventStats, setEventStats] = useState<CombinedEventStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [titleFilter, setTitleFilter] = useState<string | null>(null);

  // Stan do edycji kolorow miejsc
  const [editedColors, setEditedColors] = useState<Map<string, string>>(new Map());
  const [colorPickerSeat, setColorPickerSeat] = useState<string | null>(null);
  const [colorPickerRow, setColorPickerRow] = useState<string | null>(null);
  const [fillGapsMode, setFillGapsMode] = useState(false); // Checkbox in row picker

  // Paint Mode - wybrany kolor do malowania (null = tryb wyłączony)
  const [paintModeColor, setPaintModeColor] = useState<string | null>(null);

  // Stan do persystencji overrides
  const [savedOverrides, setSavedOverrides] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [overridesLastUpdated, setOverridesLastUpdated] = useState<string | null>(null);
  // Snapshot statystyk z ostatniego zapisu (do pokazywania zmian)
  const [savedStatsSnapshot, setSavedStatsSnapshot] = useState<{
    biletynaTaken: number;
    ebiletTaken: number;
    kupbilecikTaken: number;
  } | null>(null);

  // Pomocnik: czy kolor jest "ciemny" (sold/taken)
  const isDarkColor = (color: string): boolean => {
    return color === SEAT_COLORS.biletyna.taken ||
      color === SEAT_COLORS.ebilet.taken ||
      color === SEAT_COLORS.kupbilecik.taken;
  };

  // Pomocnik: czy kolor jest "jasny" (free)
  const isLightColor = (color: string): boolean => {
    return color === SEAT_COLORS.biletyna.free ||
      color === SEAT_COLORS.ebilet.free ||
      color === SEAT_COLORS.kupbilecik.free;
  };

  // Pomocnik: czy kolor to "brak danych" (szary)
  const isNoDataColor = (color: string): boolean => {
    return color === SEAT_COLORS.noData;
  };

  // Pomocnik: czy kolor jest "specjalny" (ręcznie ustawiany przez usera - najwyższy priorytet)
  const isSpecialColor = (color: string): boolean => {
    return color === SEAT_COLORS.notForSale ||
      color === SEAT_COLORS.otherSource ||
      color === SEAT_COLORS.boxOffice;
  };

  /**
   * Merger Logic - łączy Live Data z User Overrides według reguł siły:
   *
   * Priority Stack (od najwyższego):
   * 1. Live Data: SOLD (ciemny) - rzeczywista sprzedaż zawsze wygrywa
   * 2. User Override: SOLD (ciemny) - użytkownik poprawia/koryguje
   * 3. User Override: FREE (jasny) - użytkownik koryguje
   * 4. Live Data: FREE (jasny) - scraper znalazł wolne
   * 5. Live Data: NO DATA (szary) - brak danych ze scrapera
   *
   * Scenariusze:
   * - "Row 7 Fix": Live=NoData, User=Sold → User (uzupełnia lukę)
   * - "Real Sale": Live=Sold, User=Free → Live (rzeczywista sprzedaż)
   * - "Correction": Live=Free, User=Sold → User (wie lepiej)
   * - "Re-availability": Live=Free, User=Sold → User (override silniejszy)
   */
  const mergeColors = (liveColor: string, userOverride: string | undefined): string => {
    // Jeśli nie ma user override, użyj live data
    if (!userOverride) {
      return liveColor;
    }

    // NAJWYŻSZY PRIORYTET: Kolory specjalne od usera (notForSale, otherSource, boxOffice)
    // Te kolory zawsze wygrywają bo user wie lepiej niż scraping
    if (isSpecialColor(userOverride)) {
      return userOverride;
    }

    // Scenariusz: Live Data SOLD (ciemny) - zawsze wygrywa (rzeczywista sprzedaż)
    if (isDarkColor(liveColor)) {
      return liveColor;
    }

    // Scenariusz: User Override SOLD (ciemny) - użytkownik koryguje
    // (Live może być FREE lub NO DATA)
    if (isDarkColor(userOverride)) {
      return userOverride;
    }

    // Scenariusz: User Override FREE (jasny)
    // (Live może być FREE lub NO DATA)
    if (isLightColor(userOverride)) {
      // Jeśli live też jest free (jasny), user override nadal ma priorytet
      // (pozwala zmienić z którego portalu jest wolne)
      return userOverride;
    }

    // Domyślnie zwróć live color
    return liveColor;
  };

  // Zapisz overrides do serwera
  const saveOverrides = async (statsSnapshot?: { biletynaTaken: number; ebiletTaken: number; kupbilecikTaken: number }) => {
    if (!selectedEvent) return;

    setIsSaving(true);
    try {
      // Konwertuj Map na Record dla JSON
      const overridesObj: Record<string, string> = {};
      for (const [key, value] of editedColors) {
        overridesObj[key] = value;
      }

      const response = await fetch(`/api/events/${selectedEvent.globalEventId}/overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: overridesObj, statsSnapshot }),
      });

      const data = await response.json();
      if (data.success) {
        setSavedOverrides(overridesObj);
        setOverridesLastUpdated(data.data.lastUpdated);
        if (statsSnapshot) {
          setSavedStatsSnapshot(statsSnapshot);
        }
      } else {
        console.error('Failed to save overrides:', data.error);
      }
    } catch (err) {
      console.error('Error saving overrides:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Załaduj overrides z serwera
  const loadOverrides = async (eventId: string): Promise<Record<string, string>> => {
    try {
      const response = await fetch(`/api/events/${eventId}/overrides`);
      const data = await response.json();

      if (data.success && data.data.overrides) {
        setSavedOverrides(data.data.overrides);
        setOverridesLastUpdated(data.data.lastUpdated);
        if (data.data.statsSnapshot) {
          setSavedStatsSnapshot(data.data.statsSnapshot);
        }
        return data.data.overrides;
      }
    } catch (err) {
      console.error('Error loading overrides:', err);
    }
    return {};
  };

  // Lista wszystkich dostepnych kolorow do wyboru
  const ALL_COLORS = [
    { key: 'biletynaFree', color: SEAT_COLORS.biletyna.free, label: 'Wolne (Biletyna)' },
    { key: 'biletynaTaken', color: SEAT_COLORS.biletyna.taken, label: 'Kupione (Biletyna)' },
    { key: 'ebiletFree', color: SEAT_COLORS.ebilet.free, label: 'Wolne (eBilet)' },
    { key: 'ebiletTaken', color: SEAT_COLORS.ebilet.taken, label: 'Kupione (eBilet)' },
    { key: 'kupbilecikFree', color: SEAT_COLORS.kupbilecik.free, label: 'Wolne (KupBilecik)' },
    { key: 'kupbilecikTaken', color: SEAT_COLORS.kupbilecik.taken, label: 'Kupione (KupBilecik)' },
    { key: 'noData', color: SEAT_COLORS.noData, label: 'Brak danych' },
    // Kolory specjalne (reczne malowanie)
    { key: 'notForSale', color: SEAT_COLORS.notForSale, label: 'Nie w sprzedazy' },
    { key: 'otherSource', color: SEAT_COLORS.otherSource, label: 'Inna bileteria' },
    { key: 'boxOffice', color: SEAT_COLORS.boxOffice, label: 'Kasa (na miejscu)' },
  ];

  // Funkcja do zmiany koloru pojedynczego miejsca
  const changeSeatColor = (seatKey: string, newColor: string) => {
    setEditedColors(prev => {
      const newMap = new Map(prev);
      newMap.set(seatKey, newColor);
      return newMap;
    });
    setColorPickerSeat(null);
  };

  // Funkcja do zmiany koloru calego rzedu
  const changeRowColor = (row: string, newColor: string, seatsInRow: number[]) => {
    setEditedColors(prev => {
      const newMap = new Map(prev);
      for (const seatNum of seatsInRow) {
        newMap.set(`${row}-${seatNum}`, newColor);
      }
      return newMap;
    });
    setColorPickerRow(null);
  };

  // Funkcja do obliczania statystyk z uwzglednieniem edycji
  const calculateStatsFromColors = (
    baseColors: Map<string, string>,
    edited: Map<string, string>,
    totalSeats: number
  ) => {
    const stats = {
      biletynaFree: 0,
      biletynaTaken: 0,
      ebiletFree: 0,
      ebiletTaken: 0,
      kupbilecikFree: 0,
      kupbilecikTaken: 0,
      noData: 0,
      // Nowe kategorie specjalne
      notForSale: 0,
      otherSource: 0,
      boxOffice: 0,
    };

    // Policz kolory z uwzględnieniem reguł mergowania
    for (const [seatKey, baseColor] of baseColors) {
      const color = mergeColors(baseColor, edited.get(seatKey));
      // Najpierw sprawdz kolory specjalne (maja priorytet bo sa recznie ustawiane)
      if (color === SEAT_COLORS.notForSale) stats.notForSale++;
      else if (color === SEAT_COLORS.otherSource) stats.otherSource++;
      else if (color === SEAT_COLORS.boxOffice) stats.boxOffice++;
      else if (color === SEAT_COLORS.biletyna.free) stats.biletynaFree++;
      else if (color === SEAT_COLORS.biletyna.taken) stats.biletynaTaken++;
      else if (color === SEAT_COLORS.ebilet.free) stats.ebiletFree++;
      else if (color === SEAT_COLORS.ebilet.taken) stats.ebiletTaken++;
      else if (color === SEAT_COLORS.kupbilecik.free) stats.kupbilecikFree++;
      else if (color === SEAT_COLORS.kupbilecik.taken) stats.kupbilecikTaken++;
      else stats.noData++;
    }

    return stats;
  };

  // Fetch events on mount
  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/events');
      const data = await response.json();

      if (data.success) {
        setEvents(data.events);
        setLastUpdated(data.lastUpdated);
        setSourceDetails(data.sourceDetails || null);
      } else {
        setError(data.error || 'Failed to fetch events');
      }
    } catch (err) {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  const refreshEvents = async () => {
    try {
      setRefreshing(true);
      setError(null);
      const response = await fetch('/api/events', { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        setEvents(data.events);
        setLastUpdated(data.lastUpdated);
        setSourceDetails(data.sourceDetails || null);
      } else {
        setError(data.error || 'Failed to refresh events');
      }
    } catch (err) {
      setError('Connection error');
    } finally {
      setRefreshing(false);
    }
  };

  const fetchEventStats = async (event: JoinedEvent) => {
    setSelectedEvent(event);
    setEventStats(null);
    setStatsError(null);
    setStatsLoading(true);
    setEditedColors(new Map());
    setSavedOverrides({});
    setOverridesLastUpdated(null);

    try {
      // Równolegle pobierz statystyki i zapisane overrides
      const [statsResponse, overrides] = await Promise.all([
        fetch(`/api/events/${event.globalEventId}/stats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event }),
        }),
        loadOverrides(event.globalEventId),
      ]);

      const statsData = await statsResponse.json();

      if (statsData.success) {
        setEventStats(statsData.stats);

        // Jeśli są zapisane overrides, zastosuj je do editedColors
        if (Object.keys(overrides).length > 0) {
          const newEditedColors = new Map<string, string>();
          for (const [key, value] of Object.entries(overrides)) {
            newEditedColors.set(key, value);
          }
          setEditedColors(newEditedColors);
        }

        // Update events list optimistic cache state
        setEvents(prev => prev.map(e => {
          if (e.globalEventId === event.globalEventId) {
            return { ...e, hasCache: true, cacheTimestamp: Date.now() };
          }
          return e;
        }));
      } else {
        setStatsError(statsData.error || 'Failed to fetch stats');
      }
    } catch (err) {
      setStatsError('Connection error');
    } finally {
      setStatsLoading(false);
    }
  };

  const closeModal = () => {
    setSelectedEvent(null);
    setEventStats(null);
    setStatsError(null);
    setEditedColors(new Map());
    setColorPickerSeat(null);
    setColorPickerRow(null);
    setPaintModeColor(null);
    setSavedOverrides({});
    setOverridesLastUpdated(null);
    setSavedStatsSnapshot(null);
  };

  const clearCache = async () => {
    if (!selectedEvent) return;

    if (confirm('Czy na pewno chcesz usunąć WSZYSTKIE zapamiętane dane (linki, mapy, edycje)?\n\nTo wymusi pobranie świeżych danych z portali.')) {
      try {
        await Promise.all([
          fetch(`/api/events/${selectedEvent.globalEventId}/stats`, { method: 'DELETE' }),
          fetch(`/api/events/${selectedEvent.globalEventId}/overrides`, { method: 'DELETE' })
        ]);
        closeModal();
      } catch (err) {
        alert('Błąd usuwania danych');
      }
    }
  };

  const getSourcesList = (event: JoinedEvent): SourceType[] => {
    return (['biletyna', 'ebilet', 'kupbilecik'] as SourceType[])
      .filter(source => event.sources[source]);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const [year, month, day] = dateStr.split('-');
      return `${day}.${month}.${year}`;
    } catch {
      return dateStr;
    }
  };

  const formatCity = (city: string) => {
    if (!city) return '';
    // Capitalize first letter
    return city.charAt(0).toUpperCase() + city.slice(1);
  };



  // Group events by fuzzy title matching
  const groupedEvents = useMemo(() => {
    const groups: { label: string; events: JoinedEvent[] }[] = [];

    // Sort events by title length (shortest first) to pick best label
    const sortedEvents = [...events].sort((a, b) => a.title.length - b.title.length);

    for (const event of sortedEvents) {
      const existingGroup = groups.find(g => areTitlesSimilar(g.label, event.title));
      if (existingGroup) {
        existingGroup.events.push(event);
      } else {
        groups.push({ label: event.title, events: [event] });
      }
    }

    // Sort groups alphabetically by label
    return groups.sort((a, b) => a.label.localeCompare(b.label));
  }, [events]);

  const displayedEvents = titleFilter
    ? groupedEvents.find(g => g.label === titleFilter)?.events || []
    : events;

  return (
    <main className="container mx-auto px-4 py-8 max-w-5xl">
      <h1 className="text-3xl font-bold text-gray-800 mb-2 text-center">
        Seat Checker
      </h1>
      <p className="text-gray-500 text-center mb-8">
        Zbiorcza lista wydarzen z trzech portali biletowych
      </p>

      {/* Header with refresh */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex justify-between items-center mb-3">
          <div className="text-sm text-gray-500">
            {lastUpdated && (
              <span>Ostatnia aktualizacja: {new Date(lastUpdated).toLocaleString('pl-PL')}</span>
            )}
          </div>
          <button
            onClick={refreshEvents}
            disabled={refreshing || loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {refreshing ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Odswiezanie...</span>
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Odswiez liste</span>
              </>
            )}
          </button>
        </div>

        {/* Source details */}
        {sourceDetails && (
          <div className="flex gap-4 text-sm">
            {sourceDetails.map(s => (
              <div key={s.source} className="flex items-center gap-1">
                <span className={`w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold ${SOURCE_COLORS[s.source as SourceType]?.bg} ${SOURCE_COLORS[s.source as SourceType]?.text}`}>
                  {SOURCE_LABELS[s.source as SourceType]}
                </span>
                <span className="text-gray-600">{s.count}</span>
                {s.error && <span className="text-red-500" title={s.error}>(!)</span>}
              </div>
            ))}
            <div className="text-gray-500">
              | Zjoinowane: {events.length}
            </div>
          </div>
        )}

        {/* Filter Dropdown */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Filtruj po nazwie:</label>
            <select
              className="flex-1 max-w-md border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm py-1.5"
              value={titleFilter || ''}
              onChange={(e) => setTitleFilter(e.target.value || null)}
            >
              <option value="">Wszystkie wydarzenia</option>
              {groupedEvents.map(group => (
                <option key={group.label} value={group.label}>
                  {group.label} ({group.events.length})
                </option>
              ))}
            </select>
            {titleFilter && (
              <span className="text-sm text-gray-500 ml-2">
                Znaleziono: {displayedEvents.length}
              </span>
            )}
          </div>
        </div>
      </div>



      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md mb-6">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center items-center py-20">
          <div className="text-center">
            <svg className="animate-spin h-10 w-10 mx-auto text-blue-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-gray-600">Ladowanie wydarzen...</p>
          </div>
        </div>
      )}

      {/* Events list */}
      {!loading && displayedEvents.length > 0 && (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="divide-y divide-gray-100">
            {displayedEvents.map((event) => (
              <div
                key={event.globalEventId}
                className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => fetchEventStats(event)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-medium text-gray-900 truncate flex items-center gap-2">
                      {event.title}
                      {event.isNew && (
                        <span className="shrink-0 px-2 py-0.5 text-xs font-bold text-white bg-green-600 rounded-full animate-pulse">NOWE</span>
                      )}
                      {event.hasCache ? (
                        <div className="flex items-center gap-1">
                          <span className="shrink-0 text-blue-600" title="Dane zapisane w pamięci lokalnej (szybki dostęp)">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                            </svg>
                          </span>
                          {event.cacheTimestamp && (
                            <span className="text-xs text-gray-400">
                              {new Date(event.cacheTimestamp).toLocaleString('pl-PL', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="shrink-0 text-gray-300" title="Brak zapisanych danych (wymagane pobranie)">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                          </svg>
                        </span>
                      )}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {formatDate(event.date)}
                      </span>
                      {event.time && (
                        <span className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {event.time}
                        </span>
                      )}
                      {event.city && (
                        <span className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          {formatCity(event.city)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 ml-4">
                    {/* Source badges */}
                    <div className="flex gap-1">
                      {getSourcesList(event).map((source) => (
                        <span
                          key={source}
                          className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold ${SOURCE_COLORS[source].bg} ${SOURCE_COLORS[source].text}`}
                          title={source}
                        >
                          {SOURCE_LABELS[source]}
                        </span>
                      ))}
                    </div>

                    {/* Arrow */}
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && events.length === 0 && !error && (
        <div className="text-center py-20">
          <p className="text-gray-500 mb-4">Nie znaleziono wydarzen</p>
          <button
            onClick={refreshEvents}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Sprobuj ponownie
          </button>
        </div>
      )}

      {/* Event stats modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-[85vw] w-full max-h-[95vh] overflow-y-auto">
            {/* Modal header */}
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{selectedEvent.title}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {formatDate(selectedEvent.date)} {selectedEvent.time && `o ${selectedEvent.time}`}
                  {selectedEvent.city && ` | ${formatCity(selectedEvent.city)}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={clearCache}
                  className="px-3 py-1 text-xs font-medium bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100 transition-colors"
                  title="Usuń wszystkie zapamiętane dane (statusy miejsc, linki) i pobierz je od nowa"
                >
                  Resetuj dane
                </button>
                <button
                  onClick={closeModal}
                  className="text-gray-400 hover:text-gray-600 p-1"
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6">
              {/* Loading stats */}
              {statsLoading && (
                <div className="flex justify-center items-center py-16">
                  <div className="text-center">
                    <svg className="animate-spin h-10 w-10 mx-auto text-blue-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="text-gray-600">Pobieranie statystyk miejsc...</p>
                    <p className="text-sm text-gray-400 mt-1">To moze potrwac kilka sekund</p>
                  </div>
                </div>
              )}

              {/* Stats error */}
              {statsError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
                  {statsError}
                </div>
              )}

              {/* Stats content */}
              {eventStats && (() => {
                const defaultSectorName = getKupbilecikSectors(eventStats.perSource)[0]?.sectorName;
                const viz = calculateSeatVisualization(eventStats.perSource, eventStats.inferredSold, defaultSectorName);
                const portals: SourceType[] = ['biletyna', 'ebilet', 'kupbilecik'];
                const isMultiSector = hasMultipleSectors(eventStats.perSource);

                // Dla multi-sector, zbierz wszystkie seatColors ze wszystkich sektorów
                let allSeatColors = viz.seatColors;
                let totalSeatsCount = viz.totalSeats;

                if (isMultiSector) {
                  allSeatColors = new Map<string, string>();
                  totalSeatsCount = 0;
                  const kbSectors = getKupbilecikSectors(eventStats.perSource);
                  for (const kbSector of kbSectors) {
                    const sectorViz = calculateSectorVisualizationWithBase(kbSector, eventStats.perSource, eventStats.inferredSold);
                    for (const [seatKey, color] of sectorViz.seatColors) {
                      // Klucz z prefiksem sektora (tak jak w editedColors)
                      const fullKey = `${kbSector.sectorName}::${seatKey}`;
                      allSeatColors.set(fullKey, color);
                      totalSeatsCount++;
                    }
                  }
                }

                // Oblicz statystyki z uwzglednieniem edycji (uzywane w obu sekcjach)
                const currentStats = calculateStatsFromColors(allSeatColors, editedColors, totalSeatsCount);
                const totalFree = currentStats.biletynaFree + currentStats.ebiletFree + currentStats.kupbilecikFree;

                // Oblicz procent sprzedanych per portal (kupione / (kupione + wolne) dla danego portalu)
                const biletynaTotal = currentStats.biletynaFree + currentStats.biletynaTaken;
                const ebiletTotal = currentStats.ebiletFree + currentStats.ebiletTaken;
                const kupbilecikTotal = currentStats.kupbilecikFree + currentStats.kupbilecikTaken;

                const biletynaSoldPct = biletynaTotal > 0 ? ((currentStats.biletynaTaken / biletynaTotal) * 100).toFixed(1) : '0.0';
                const ebiletSoldPct = ebiletTotal > 0 ? ((currentStats.ebiletTaken / ebiletTotal) * 100).toFixed(1) : '0.0';
                const kupbilecikSoldPct = kupbilecikTotal > 0 ? ((currentStats.kupbilecikTaken / kupbilecikTotal) * 100).toFixed(1) : '0.0';

                return (
                  <div className="space-y-6">
                    {/* Combined totals - globalne statystyki */}
                    <div className="bg-gray-50 rounded-lg p-6">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-semibold text-gray-800">Statystyki zbiorcze</h3>
                        {editedColors.size > 0 && (
                          <span className="text-xs text-blue-600">(uwzględnia {editedColors.size} edycji)</span>
                        )}
                      </div>

                      {/* Glowne liczby */}
                      <div className="grid grid-cols-3 gap-4 text-center mb-6">
                        <div>
                          <div className="text-3xl font-bold text-gray-800">{totalSeatsCount}</div>
                          <div className="text-sm text-gray-500">Wszystkich miejsc</div>
                        </div>
                        <div>
                          <div className="text-3xl font-bold text-green-600">{totalFree}</div>
                          <div className="text-sm text-gray-500">Wolnych</div>
                        </div>
                        <div>
                          <div className="text-3xl font-bold text-gray-500">{currentStats.noData}</div>
                          <div className="text-sm text-gray-500">Brak danych</div>
                        </div>
                      </div>

                      {/* Rozklad per portal */}
                      <div className="grid grid-cols-3 gap-4">
                        {/* Biletyna */}
                        <div className="border rounded-lg p-3" style={{ borderColor: SEAT_COLORS.biletyna.taken }}>
                          <div className="font-medium text-gray-700 mb-2">Biletyna</div>
                          <div className="flex items-center gap-2 text-sm mb-1">
                            <span className="w-4 h-4 rounded-full" style={{ backgroundColor: SEAT_COLORS.biletyna.free }}></span>
                            <span>Wolne: {currentStats.biletynaFree}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm mb-1">
                            <span className="w-4 h-4 rounded-full" style={{ backgroundColor: SEAT_COLORS.biletyna.taken }}></span>
                            <span>Kupione: {currentStats.biletynaTaken}</span>
                            {eventStats.diff && (
                              <span className="text-xs text-green-600 font-medium" title={`Wzrost od ostatniej aktualizacji: ${new Date(eventStats.diff.lastUpdated).toLocaleTimeString()}`}>+{eventStats.diff.biletynaTaken}</span>
                            )}
                            {!eventStats.diff && savedStatsSnapshot && currentStats.biletynaTaken > savedStatsSnapshot.biletynaTaken && (
                              <span className="text-xs text-green-600 font-medium">+{currentStats.biletynaTaken - savedStatsSnapshot.biletynaTaken}</span>
                            )}
                          </div>
                          {biletynaTotal > 0 && (
                            <div className="text-xs text-gray-500 mt-1 pt-1 border-t">
                              Sprzedane: {biletynaSoldPct}%
                            </div>
                          )}
                        </div>

                        {/* eBilet */}
                        <div className="border rounded-lg p-3" style={{ borderColor: SEAT_COLORS.ebilet.taken }}>
                          <div className="font-medium text-gray-700 mb-2">eBilet</div>
                          <div className="flex items-center gap-2 text-sm mb-1">
                            <span className="w-4 h-4 rounded-full" style={{ backgroundColor: SEAT_COLORS.ebilet.free }}></span>
                            <span>Wolne: {currentStats.ebiletFree}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm mb-1">
                            <span className="w-4 h-4 rounded-full" style={{ backgroundColor: SEAT_COLORS.ebilet.taken }}></span>
                            <span>Kupione: {currentStats.ebiletTaken}</span>
                            {eventStats.diff && (
                              <span className="text-xs text-green-600 font-medium" title={`Wzrost od ostatniej aktualizacji: ${new Date(eventStats.diff.lastUpdated).toLocaleTimeString()}`}>+{eventStats.diff.ebiletTaken}</span>
                            )}
                            {!eventStats.diff && savedStatsSnapshot && currentStats.ebiletTaken > savedStatsSnapshot.ebiletTaken && (
                              <span className="text-xs text-green-600 font-medium">+{currentStats.ebiletTaken - savedStatsSnapshot.ebiletTaken}</span>
                            )}
                          </div>
                          {ebiletTotal > 0 && (
                            <div className="text-xs text-gray-500 mt-1 pt-1 border-t">
                              Sprzedane: {ebiletSoldPct}%
                            </div>
                          )}
                        </div>

                        {/* KupBilecik */}
                        <div className="border rounded-lg p-3" style={{ borderColor: SEAT_COLORS.kupbilecik.taken }}>
                          <div className="font-medium text-gray-700 mb-2">KupBilecik</div>
                          <div className="flex items-center gap-2 text-sm mb-1">
                            <span className="w-4 h-4 rounded-full" style={{ backgroundColor: SEAT_COLORS.kupbilecik.free }}></span>
                            <span>Wolne: {currentStats.kupbilecikFree}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm mb-1">
                            <span className="w-4 h-4 rounded-full" style={{ backgroundColor: SEAT_COLORS.kupbilecik.taken }}></span>
                            <span>Kupione: {currentStats.kupbilecikTaken}</span>
                            {eventStats.diff && (
                              <span className="text-xs text-green-600 font-medium" title={`Wzrost od ostatniej aktualizacji: ${new Date(eventStats.diff.lastUpdated).toLocaleTimeString()}`}>+{eventStats.diff.kupbilecikTaken}</span>
                            )}
                            {!eventStats.diff && savedStatsSnapshot && currentStats.kupbilecikTaken > savedStatsSnapshot.kupbilecikTaken && (
                              <span className="text-xs text-green-600 font-medium">+{currentStats.kupbilecikTaken - savedStatsSnapshot.kupbilecikTaken}</span>
                            )}
                          </div>
                          {kupbilecikTotal > 0 && (
                            <div className="text-xs text-gray-500 mt-1 pt-1 border-t">
                              Sprzedane: {kupbilecikSoldPct}%
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Brak danych i specjalne kategorie */}
                      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-gray-500">
                        <div className="flex items-center gap-2">
                          <span className="w-4 h-4 rounded-full" style={{ backgroundColor: SEAT_COLORS.noData }}></span>
                          <span>Brak danych: {currentStats.noData}</span>
                        </div>
                        {currentStats.boxOffice > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="w-4 h-4 rounded-full" style={{ backgroundColor: SEAT_COLORS.boxOffice }}></span>
                            <span>Kasa (na miejscu): {currentStats.boxOffice}</span>
                          </div>
                        )}
                        {currentStats.otherSource > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="w-4 h-4 rounded-full" style={{ backgroundColor: SEAT_COLORS.otherSource }}></span>
                            <span>Inna bileteria: {currentStats.otherSource}</span>
                          </div>
                        )}
                        {currentStats.notForSale > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="w-4 h-4 rounded-full border border-gray-400" style={{ backgroundColor: SEAT_COLORS.notForSale }}></span>
                            <span>Nie w sprzedazy: {currentStats.notForSale}</span>
                          </div>
                        )}
                      </div>

                      {/* Source Verification Links */}
                      {(eventStats.perSource.biletyna?.finalUrl || eventStats.perSource.ebilet?.finalUrl || eventStats.perSource.kupbilecik?.finalUrl) && (
                        <div className="mt-4 pt-4 border-t">
                          <div className="text-sm font-medium text-gray-700 mb-2">Linki do zrodel (weryfikacja):</div>
                          <div className="flex flex-wrap gap-3 text-sm">
                            {eventStats.perSource.biletyna?.finalUrl && (
                              <a
                                href={eventStats.perSource.biletyna.finalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2 py-1 rounded bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors"
                              >
                                <span className="w-4 h-4 flex items-center justify-center rounded-full bg-purple-500 text-white text-xs font-bold">B</span>
                                Biletyna
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            )}
                            {eventStats.perSource.ebilet?.finalUrl && (
                              <a
                                href={eventStats.perSource.ebilet.finalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2 py-1 rounded bg-yellow-100 text-yellow-700 hover:bg-yellow-200 transition-colors"
                              >
                                <span className="w-4 h-4 flex items-center justify-center rounded-full bg-yellow-500 text-white text-xs font-bold">E</span>
                                eBilet
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            )}
                            {eventStats.perSource.kupbilecik?.finalUrl && (
                              <a
                                href={eventStats.perSource.kupbilecik.finalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                              >
                                <span className="w-4 h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold">K</span>
                                KupBilecik
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Wizualizacja miejsc */}
                    <div className="bg-white border rounded-lg overflow-hidden">
                      <div className="px-4 py-3 bg-gray-50 border-b flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-gray-700">
                            Mapa miejsc
                            {hasMultipleSectors(eventStats.perSource) && (
                              <span className="text-sm font-normal text-gray-500 ml-2">
                                ({getKupbilecikSectors(eventStats.perSource).length} sektorów z KupBilecik)
                              </span>
                            )}
                          </span>
                          {overridesLastUpdated && (
                            <span className="text-xs text-gray-400">
                              Zapisano: {new Date(overridesLastUpdated).toLocaleString('pl-PL')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {editedColors.size > 0 && (
                            <button
                              onClick={() => setEditedColors(new Map())}
                              className="text-sm text-gray-500 hover:text-gray-700"
                            >
                              Resetuj zmiany ({editedColors.size})
                            </button>
                          )}
                          {(editedColors.size > 0 || Object.keys(savedOverrides).length > 0) && (
                            <button
                              onClick={() => saveOverrides({
                                biletynaTaken: currentStats.biletynaTaken,
                                ebiletTaken: currentStats.ebiletTaken,
                                kupbilecikTaken: currentStats.kupbilecikTaken,
                              })}
                              disabled={isSaving}
                              className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                            >
                              {isSaving ? (
                                <>
                                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  <span>Zapisywanie...</span>
                                </>
                              ) : (
                                <>
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                                  </svg>
                                  <span>Zapisz</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Paint Mode Palette */}
                      <div className="px-4 py-2 bg-blue-50 border-b flex items-center gap-3 flex-wrap">
                        <span className="text-sm font-medium text-gray-700">Tryb malowania:</span>
                        <div className="flex items-center gap-1">
                          {ALL_COLORS.map((c) => (
                            <button
                              key={c.key}
                              className={`w-7 h-7 rounded-full border-2 transition-all ${paintModeColor === c.color
                                ? 'border-blue-600 scale-110 ring-2 ring-blue-300'
                                : 'border-gray-300 hover:border-gray-400 hover:scale-105'
                                }`}
                              style={{ backgroundColor: c.color }}
                              title={c.label}
                              onClick={() => setPaintModeColor(paintModeColor === c.color ? null : c.color)}
                            />
                          ))}
                        </div>
                        {paintModeColor && (
                          <button
                            onClick={() => setPaintModeColor(null)}
                            className="ml-2 px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
                          >
                            Wylacz malowanie
                          </button>
                        )}
                        {paintModeColor && (
                          <span className="text-xs text-blue-600 ml-2">
                            Klikaj miejsca aby je pomalowac
                          </span>
                        )}
                      </div>

                      {/* Statystyki procentowe */}
                      <div className="px-4 py-3 bg-gray-100 border-b text-sm">
                        <div className="flex flex-wrap gap-4 justify-center">
                          <span className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: SEAT_COLORS.biletyna.free }}></span>
                            Biletyna: {currentStats.biletynaFree + currentStats.biletynaTaken} ({totalSeatsCount > 0 ? (((currentStats.biletynaFree + currentStats.biletynaTaken) / totalSeatsCount) * 100).toFixed(1) : 0}%)
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: SEAT_COLORS.ebilet.free }}></span>
                            eBilet: {currentStats.ebiletFree + currentStats.ebiletTaken} ({totalSeatsCount > 0 ? (((currentStats.ebiletFree + currentStats.ebiletTaken) / totalSeatsCount) * 100).toFixed(1) : 0}%)
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: SEAT_COLORS.kupbilecik.free }}></span>
                            KupBilecik: {currentStats.kupbilecikFree + currentStats.kupbilecikTaken} ({totalSeatsCount > 0 ? (((currentStats.kupbilecikFree + currentStats.kupbilecikTaken) / totalSeatsCount) * 100).toFixed(1) : 0}%)
                          </span>
                          {currentStats.boxOffice > 0 && (
                            <span className="flex items-center gap-1">
                              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: SEAT_COLORS.boxOffice }}></span>
                              Kasa: {currentStats.boxOffice} ({totalSeatsCount > 0 ? ((currentStats.boxOffice / totalSeatsCount) * 100).toFixed(1) : 0}%)
                            </span>
                          )}
                          <span className="text-gray-500">
                            | Razem wolne: {totalFree + currentStats.boxOffice} ({totalSeatsCount > 0 ? (((totalFree + currentStats.boxOffice) / totalSeatsCount) * 100).toFixed(1) : 0}%)
                          </span>
                        </div>
                      </div>

                      {/* Multi-sector view - uses kupbilecik as base map */}
                      {hasMultipleSectors(eventStats.perSource) ? (
                        <div className="p-4 overflow-y-auto max-h-[80vh]">
                          {getKupbilecikSectors(eventStats.perSource).map((kbSector) => {
                            const sectorViz = calculateSectorVisualizationWithBase(kbSector, eventStats.perSource, eventStats.inferredSold);
                            if (sectorViz.totalSeats === 0) return null;

                            return (
                              <div key={kbSector.sectorName} className="mb-8 last:mb-0">
                                <div className="text-center font-semibold text-gray-700 mb-3 pb-2 border-b">
                                  {sectorViz.sectorName}
                                  <span className="text-sm font-normal text-gray-500 ml-2">
                                    ({sectorViz.totalSeats} miejsc)
                                  </span>
                                </div>
                                <div className="overflow-x-auto">
                                  <div className="flex flex-col items-center min-w-fit">
                                    {sectorViz.sortedRows.map((row) => {
                                      const seatNames = sectorViz.seatsPerRow.get(row) || [];
                                      const sectorRowKey = `${kbSector.sectorName}::${row}`;
                                      const isRowPickerOpen = colorPickerRow === sectorRowKey;

                                      return (
                                        <div key={`${kbSector.sectorName}-${row}`} className="flex items-center gap-2 mb-1 relative">
                                          {/* Numer rzedu - kliknij aby zmienic kolor calego rzedu */}
                                          <span
                                            className="w-8 text-sm text-gray-600 text-right pr-2 flex-shrink-0 font-medium cursor-pointer hover:text-blue-600 hover:underline"
                                            onClick={() => setColorPickerRow(isRowPickerOpen ? null : sectorRowKey)}
                                            title="Kliknij aby zmienić kolor całego rzędu"
                                          >
                                            {row}
                                          </span>

                                          {/* Row color picker dropdown for multi-sector */}
                                          {isRowPickerOpen && (() => {
                                            const seatKeysInRow = seatNames.map(sn => `${kbSector.sectorName}::${row}-${sn}`);
                                            const hasEditedSeatsInRow = seatKeysInRow.some(sk => editedColors.has(sk));
                                            return (
                                              <div className="absolute left-10 top-0 z-20 bg-white border rounded-lg shadow-lg p-2 flex flex-wrap gap-1 w-48">
                                                <div className="w-full text-xs text-gray-500 mb-1">Zmień cały rząd {row}:</div>
                                                <div className="w-full flex items-center gap-2 mb-2 px-1 cursor-pointer" onClick={() => setFillGapsMode(!fillGapsMode)}>
                                                  <div className={`w-3 h-3 border rounded-sm flex items-center justify-center ${fillGapsMode ? 'bg-blue-600 border-blue-600' : 'border-gray-400'}`}>
                                                    {fillGapsMode && <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                                                  </div>
                                                  <span className="text-xs text-gray-700 select-none">Tylko braki danych</span>
                                                </div>
                                                {ALL_COLORS.map((c) => (
                                                  <div
                                                    key={c.key}
                                                    className="w-6 h-6 rounded-full border border-gray-300 cursor-pointer hover:scale-110 transition-transform"
                                                    style={{ backgroundColor: c.color }}
                                                    title={c.label}
                                                    onClick={() => {
                                                      setEditedColors(prev => {
                                                        const newMap = new Map(prev);
                                                        for (const seatName of seatNames) {
                                                          const key = `${kbSector.sectorName}::${row}-${seatName}`;

                                                          if (fillGapsMode) {
                                                            const coreKey = `${row}-${seatName}`;
                                                            const baseColor = sectorViz.seatColors.get(coreKey);
                                                            if (baseColor === SEAT_COLORS.noData) {
                                                              newMap.set(key, c.color);
                                                            }
                                                          } else {
                                                            newMap.set(key, c.color);
                                                          }
                                                        }
                                                        return newMap;
                                                      });
                                                      setColorPickerRow(null);
                                                    }}
                                                  />
                                                ))}
                                                {hasEditedSeatsInRow && (
                                                  <button
                                                    className="w-full text-xs text-blue-600 mt-1 hover:text-blue-800"
                                                    onClick={() => {
                                                      setEditedColors(prev => {
                                                        const newMap = new Map(prev);
                                                        for (const sk of seatKeysInRow) {
                                                          newMap.delete(sk);
                                                        }
                                                        return newMap;
                                                      });
                                                      setColorPickerRow(null);
                                                    }}
                                                  >
                                                    Przywróć oryginał
                                                  </button>
                                                )}
                                                <button
                                                  className="w-full text-xs text-gray-500 mt-1 hover:text-gray-700"
                                                  onClick={() => setColorPickerRow(null)}
                                                >
                                                  Anuluj
                                                </button>
                                              </div>
                                            );
                                          })()}

                                          <div className="flex gap-1">
                                            {seatNames.map((seatName) => {
                                              const seatKey = `${row}-${seatName}`;
                                              const fullSeatKey = `${kbSector.sectorName}::${seatKey}`;
                                              const baseColor = sectorViz.seatColors.get(seatKey) || SEAT_COLORS.noData;
                                              const color = mergeColors(baseColor, editedColors.get(fullSeatKey));
                                              const isEdited = editedColors.has(fullSeatKey);
                                              const currentOverride = editedColors.get(fullSeatKey);
                                              const savedOverride = savedOverrides[fullSeatKey];
                                              // Unsaved if current state differs from saved state (treating undefined/missing as null)
                                              const isUnsaved = (currentOverride ?? null) !== (savedOverride ?? null);

                                              const isInferred = eventStats.inferredSold && eventStats.inferredSold[`${kbSector.sectorName}:${seatKey}`];
                                              const isPickerOpen = colorPickerSeat === fullSeatKey;

                                              let borderClass = 'border-gray-400';
                                              if (isUnsaved) borderClass = 'border-blue-500 border-2';
                                              else if (isInferred) borderClass = 'border-green-500 border-2';

                                              return (
                                                <div key={`${kbSector.sectorName}-${seatKey}`} className="relative">
                                                  <div
                                                    className={`w-5 h-5 rounded-full border cursor-pointer hover:scale-110 transition-transform ${borderClass} ${paintModeColor ? 'cursor-crosshair' : ''}`}
                                                    style={{ backgroundColor: color }}
                                                    title={`${sectorViz.sectorName}: Rząd ${row}, Miejsce ${seatName}${isEdited ? ' (edytowane)' : ''}${paintModeColor ? ' (kliknij aby pomalować)' : ''}`}
                                                    onClick={() => {
                                                      if (paintModeColor) {
                                                        // Paint mode - od razu maluj
                                                        setEditedColors(prev => {
                                                          const newMap = new Map(prev);
                                                          newMap.set(fullSeatKey, paintModeColor);
                                                          return newMap;
                                                        });
                                                      } else {
                                                        // Normalny tryb - otwórz picker
                                                        setColorPickerSeat(isPickerOpen ? null : fullSeatKey);
                                                      }
                                                    }}
                                                  />

                                                  {/* Seat color picker dropdown for multi-sector */}
                                                  {isPickerOpen && (
                                                    <div className="absolute top-6 left-0 z-20 bg-white border rounded-lg shadow-lg p-2 flex flex-wrap gap-1 w-48">
                                                      <div className="w-full text-xs text-gray-500 mb-1">{sectorViz.sectorName}: Rząd {row}, Miejsce {seatName}:</div>
                                                      {ALL_COLORS.map((c) => (
                                                        <div
                                                          key={c.key}
                                                          className="w-6 h-6 rounded-full border border-gray-300 cursor-pointer hover:scale-110 transition-transform"
                                                          style={{ backgroundColor: c.color }}
                                                          title={c.label}
                                                          onClick={() => {
                                                            setEditedColors(prev => {
                                                              const newMap = new Map(prev);
                                                              newMap.set(fullSeatKey, c.color);
                                                              return newMap;
                                                            });
                                                            setColorPickerSeat(null);
                                                          }}
                                                        />
                                                      ))}
                                                      {isEdited && (
                                                        <button
                                                          className="w-full text-xs text-blue-600 mt-1 hover:text-blue-800"
                                                          onClick={() => {
                                                            setEditedColors(prev => {
                                                              const newMap = new Map(prev);
                                                              newMap.delete(fullSeatKey);
                                                              return newMap;
                                                            });
                                                            setColorPickerSeat(null);
                                                          }}
                                                        >
                                                          Przywróć oryginał
                                                        </button>
                                                      )}
                                                      <button
                                                        className="w-full text-xs text-gray-500 mt-1 hover:text-gray-700"
                                                        onClick={() => setColorPickerSeat(null)}
                                                      >
                                                        Anuluj
                                                      </button>
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        /* Single sector view - original logic */
                        <div className="p-4 overflow-x-auto">
                          <div className="flex flex-col items-center min-w-fit">
                            {viz.sortedRows.map((row) => {
                              const seatNums = viz.seatsPerRow.get(row) || [];
                              const isRowPickerOpen = colorPickerRow === row;

                              return (
                                <div key={row} className="flex items-center gap-2 mb-1 relative">
                                  {/* Numer rzedu - kliknij aby zmienic kolor calego rzedu */}
                                  <span
                                    className="w-8 text-sm text-gray-600 text-right pr-2 flex-shrink-0 font-medium cursor-pointer hover:text-blue-600 hover:underline"
                                    onClick={() => setColorPickerRow(isRowPickerOpen ? null : row)}
                                    title="Kliknij aby zmienić kolor całego rzędu"
                                  >
                                    {row}
                                  </span>

                                  {/* Row color picker dropdown */}
                                  {isRowPickerOpen && (() => {
                                    const hasEditedSeatsInRow = seatNums.some(sn => editedColors.has(`${row}-${sn}`));
                                    return (
                                      <div className="absolute left-10 top-0 z-20 bg-white border rounded-lg shadow-lg p-2 flex flex-wrap gap-1 w-48">
                                        <div className="w-full text-xs text-gray-500 mb-1">Zmień cały rząd {row}:</div>
                                        <div className="w-full flex items-center gap-2 mb-2 px-1 cursor-pointer" onClick={() => setFillGapsMode(!fillGapsMode)}>
                                          <div className={`w-3 h-3 border rounded-sm flex items-center justify-center ${fillGapsMode ? 'bg-blue-600 border-blue-600' : 'border-gray-400'}`}>
                                            {fillGapsMode && <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                                          </div>
                                          <span className="text-xs text-gray-700 select-none">Tylko braki danych</span>
                                        </div>
                                        {ALL_COLORS.map((c) => (
                                          <div
                                            key={c.key}
                                            className="w-6 h-6 rounded-full border border-gray-300 cursor-pointer hover:scale-110 transition-transform"
                                            style={{ backgroundColor: c.color }}
                                            title={c.label}
                                            onClick={() => {
                                              setEditedColors(prev => {
                                                const newMap = new Map(prev);
                                                for (const sn of seatNums) {
                                                  const key = `${row}-${sn}`;
                                                  if (fillGapsMode) {
                                                    const baseColor = viz.seatColors.get(key);
                                                    if (baseColor === SEAT_COLORS.noData) {
                                                      newMap.set(key, c.color);
                                                    }
                                                  } else {
                                                    newMap.set(key, c.color);
                                                  }
                                                }
                                                return newMap;
                                              });
                                              setColorPickerRow(null);
                                            }}
                                          />
                                        ))}
                                        {hasEditedSeatsInRow && (
                                          <button
                                            className="w-full text-xs text-blue-600 mt-1 hover:text-blue-800"
                                            onClick={() => {
                                              setEditedColors(prev => {
                                                const newMap = new Map(prev);
                                                for (const sn of seatNums) {
                                                  newMap.delete(`${row}-${sn}`);
                                                }
                                                return newMap;
                                              });
                                              setColorPickerRow(null);
                                            }}
                                          >
                                            Przywróć oryginał
                                          </button>
                                        )}
                                        <button
                                          className="w-full text-xs text-gray-500 mt-1 hover:text-gray-700"
                                          onClick={() => setColorPickerRow(null)}
                                        >
                                          Anuluj
                                        </button>
                                      </div>
                                    );
                                  })()}

                                  <div className="flex gap-1">
                                    {seatNums.map((seatNum) => {
                                      const seatKey = `${row}-${seatNum}`;
                                      const baseColor = viz.seatColors.get(seatKey) || SEAT_COLORS.noData;
                                      const color = mergeColors(baseColor, editedColors.get(seatKey));
                                      const isEdited = editedColors.has(seatKey);

                                      const currentOverride = editedColors.get(seatKey);
                                      const savedOverride = savedOverrides[seatKey];
                                      const isUnsaved = (currentOverride ?? null) !== (savedOverride ?? null);

                                      // Inferred logic for single sector
                                      const uniqueKey = defaultSectorName ? `${defaultSectorName}:${seatKey}` : '';
                                      const isInferred = uniqueKey && eventStats.inferredSold && eventStats.inferredSold[uniqueKey];

                                      const isPickerOpen = colorPickerSeat === seatKey;

                                      let borderClass = 'border-gray-400';
                                      if (isUnsaved) borderClass = 'border-blue-500 border-2';
                                      else if (isInferred) borderClass = 'border-green-500 border-2';

                                      return (
                                        <div key={seatKey} className="relative">
                                          <div
                                            className={`w-5 h-5 rounded-full border cursor-pointer hover:scale-110 transition-transform ${borderClass} ${paintModeColor ? 'cursor-crosshair' : ''}`}
                                            style={{ backgroundColor: color }}
                                            title={`Rząd ${row}, Miejsce ${seatNum}${isEdited ? ' (edytowane)' : ''}${paintModeColor ? ' (kliknij aby pomalować)' : ''}`}
                                            onClick={() => {
                                              if (paintModeColor) {
                                                // Paint mode - od razu maluj
                                                setEditedColors(prev => {
                                                  const newMap = new Map(prev);
                                                  newMap.set(seatKey, paintModeColor);
                                                  return newMap;
                                                });
                                              } else {
                                                // Normalny tryb - otwórz picker
                                                setColorPickerSeat(isPickerOpen ? null : seatKey);
                                              }
                                            }}
                                          />

                                          {/* Seat color picker dropdown */}
                                          {isPickerOpen && (
                                            <div className="absolute top-6 left-0 z-20 bg-white border rounded-lg shadow-lg p-2 flex flex-wrap gap-1 w-48">
                                              <div className="w-full text-xs text-gray-500 mb-1">Rząd {row}, Miejsce {seatNum}:</div>
                                              {ALL_COLORS.map((c) => (
                                                <div
                                                  key={c.key}
                                                  className="w-6 h-6 rounded-full border border-gray-300 cursor-pointer hover:scale-110 transition-transform"
                                                  style={{ backgroundColor: c.color }}
                                                  title={c.label}
                                                  onClick={() => changeSeatColor(seatKey, c.color)}
                                                />
                                              ))}
                                              {isEdited && (
                                                <button
                                                  className="w-full text-xs text-blue-600 mt-1 hover:text-blue-800"
                                                  onClick={() => {
                                                    setEditedColors(prev => {
                                                      const newMap = new Map(prev);
                                                      newMap.delete(seatKey);
                                                      return newMap;
                                                    });
                                                    setColorPickerSeat(null);
                                                  }}
                                                >
                                                  Przywróć oryginał
                                                </button>
                                              )}
                                              <button
                                                className="w-full text-xs text-gray-500 mt-1 hover:text-gray-700"
                                                onClick={() => setColorPickerSeat(null)}
                                              >
                                                Anuluj
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Legenda - 7 kolorow */}
                      <div className="p-4 border-t">
                        <div className="mt-4 pt-4">
                          <div className="text-sm text-gray-600">
                            <div className="font-medium mb-2">Legenda:</div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              {/* Biletyna */}
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded-full border border-gray-400" style={{ backgroundColor: SEAT_COLORS.biletyna.free }}></div>
                                  <span>Wolne (Biletyna)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded-full border border-gray-400" style={{ backgroundColor: SEAT_COLORS.biletyna.taken }}></div>
                                  <span>Kupione (Biletyna)</span>
                                </div>
                              </div>
                              {/* eBilet */}
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded-full border border-gray-400" style={{ backgroundColor: SEAT_COLORS.ebilet.free }}></div>
                                  <span>Wolne (eBilet)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded-full border border-gray-400" style={{ backgroundColor: SEAT_COLORS.ebilet.taken }}></div>
                                  <span>Kupione (eBilet)</span>
                                </div>
                              </div>
                              {/* KupBilecik */}
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded-full border border-gray-400" style={{ backgroundColor: SEAT_COLORS.kupbilecik.free }}></div>
                                  <span>Wolne (KupBilecik)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded-full border border-gray-400" style={{ backgroundColor: SEAT_COLORS.kupbilecik.taken }}></div>
                                  <span>Kupione (KupBilecik)</span>
                                </div>
                              </div>
                              {/* Brak danych */}
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded-full border border-gray-400" style={{ backgroundColor: SEAT_COLORS.noData }}></div>
                                  <span>Brak danych</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function areTitlesSimilar(title1: string, title2: string): boolean {
  if (title1 === title2) return true;

  const norm1 = normalizeTitle(title1);
  const norm2 = normalizeTitle(title2);

  if (norm1 === norm2) return true;

  // Check if one contains the other
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    // Only allow if length difference is small (e.g. " - VIP" or " 2024")
    const lenDiff = Math.abs(norm1.length - norm2.length);
    if (lenDiff < 10) return true;
  }

  return false;
}
