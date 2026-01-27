// Source identifiers
export type SourceType = 'biletyna' | 'ebilet' | 'kupbilecik';

// Raw event scraped from a single source
export interface RawEvent {
  source: SourceType;
  title: string;
  date: string;       // YYYY-MM-DD
  time: string;       // HH:MM
  city: string;       // miasto (normalized for matching)
  cityOriginal?: string; // miasto (original with Polish chars)
  venue: string;      // miejsce/obiekt
  eventCardUrl: string;
  buyButtonSelector: string;
}

// Source-specific data after joining
export interface SourceData {
  eventCardUrl: string;
  buyButtonSelector: string;
  venue?: string;
}

// Joined event from multiple sources
export interface JoinedEvent {
  globalEventId: string;
  title: string;
  date: string;       // YYYY-MM-DD
  time: string;       // HH:MM
  city: string;       // miasto (normalized for matching)
  cityOriginal?: string; // miasto (original with Polish chars, for eBilet URL)
  sources: {
    biletyna?: SourceData;
    ebilet?: SourceData;
    kupbilecik?: SourceData;
  };
  hasCache?: boolean;
  cacheTimestamp?: number;
  isNew?: boolean;
}

// Row statistics
export interface RowStats {
  total: number;
  free: number;
  taken: number;
}

// Stats for a single sector
export interface SectorStats {
  sectorName: string;
  rows: Record<string, RowStats>;
  freeSeats: string[];  // Format: "row-seat"
  takenSeats: string[]; // Format: "row-seat"
  totals: {
    total: number;
    free: number;
    taken: number;
  };
}

// Stats result from a single source
export interface SourceStats {
  source: SourceType;
  totals: {
    total: number;
    free: number;
    taken: number;
  };
  rows: Record<string, RowStats>;
  freeSeats: string[];
  takenSeats: string[];
  // Multi-sector support: if sectors exist, data is split per sector
  // If only one sector (or no sector info), sectors will be undefined or empty
  sectors?: SectorStats[];
  // Final URL used to scrape data (for user verification)
  finalUrl?: string;
}

// Combined event stats from all sources
export interface CombinedEventStats {
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
  // Inferred sold seats from history (SeatKey -> Source)
  inferredSold?: Record<string, SourceType>;
  diff?: {
    biletynaTaken: number;
    ebiletTaken: number;
    kupbilecikTaken: number;
    lastUpdated: string;
  };
}

// Organizer URLs configuration
export const ORGANIZER_URLS = {
  biletyna: 'https://biletyna.pl/event/index/?q=Wikart#list',
  ebilet: 'https://www.ebilet.pl/organizatorzy/wikart-malgorzata-wnuk',
  kupbilecik: 'https://wikart.kupbilecik.pl/',
} as const;
