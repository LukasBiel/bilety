import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Snapshot statystyk przy zapisie (do porównywania zmian)
interface StatsSnapshot {
  biletynaTaken: number;
  ebiletTaken: number;
  kupbilecikTaken: number;
}

// Structure for storing seat overrides
// Key format: "sectorName::row-seat" for multi-sector or "row-seat" for single-sector
// Value: hex color string
interface SeatOverrides {
  eventId: string;
  lastUpdated: string;
  overrides: Record<string, string>;
  statsSnapshot?: StatsSnapshot;
}

// Get the data directory path
function getDataDir(): string {
  return path.join(process.cwd(), 'data', 'overrides');
}

// Get the file path for a specific event's overrides
function getOverridesFilePath(eventId: string): string {
  // Sanitize eventId to be a safe filename
  const safeId = eventId.replace(/[^a-zA-Z0-9-_]/g, '_');
  return path.join(getDataDir(), `${safeId}.json`);
}

// Ensure the data directory exists
async function ensureDataDir(): Promise<void> {
  const dataDir = getDataDir();
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

// GET - Retrieve saved overrides for an event
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    const filePath = getOverridesFilePath(id);

    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const data: SeatOverrides = JSON.parse(fileContent);

      return NextResponse.json({
        success: true,
        data: {
          eventId: data.eventId,
          lastUpdated: data.lastUpdated,
          overrides: data.overrides,
          statsSnapshot: data.statsSnapshot,
        },
      });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - no overrides saved yet
        return NextResponse.json({
          success: true,
          data: {
            eventId: id,
            lastUpdated: null,
            overrides: {},
          },
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('Error reading overrides:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read overrides',
    }, { status: 500 });
  }
}

// POST - Save overrides for an event
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { overrides, statsSnapshot } = body;

    if (!overrides || typeof overrides !== 'object') {
      return NextResponse.json({
        success: false,
        error: 'Invalid overrides data',
      }, { status: 400 });
    }

    await ensureDataDir();

    const data: SeatOverrides = {
      eventId: id,
      lastUpdated: new Date().toISOString(),
      overrides: overrides,
      statsSnapshot: statsSnapshot,
    };

    const filePath = getOverridesFilePath(id);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

    return NextResponse.json({
      success: true,
      message: 'Overrides saved successfully',
      data: {
        eventId: id,
        lastUpdated: data.lastUpdated,
        overridesCount: Object.keys(overrides).length,
      },
    });
  } catch (error) {
    console.error('Error saving overrides:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save overrides',
    }, { status: 500 });
  }
}

// DELETE - Remove all overrides for an event
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    const filePath = getOverridesFilePath(id);

    try {
      await fs.unlink(filePath);
      return NextResponse.json({
        success: true,
        message: 'Overrides deleted successfully',
      });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - nothing to delete
        return NextResponse.json({
          success: true,
          message: 'No overrides to delete',
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('Error deleting overrides:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete overrides',
    }, { status: 500 });
  }
}
