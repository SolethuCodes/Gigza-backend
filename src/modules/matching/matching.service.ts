import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../services/redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebsocketsGateway } from '../websockets/websockets.gateway';

const RADIUS_RINGS_KM = [5, 10, 15, 30] as const;
const EXPAND_AFTER_MS = 3 * 60 * 1000; // 3 minutes
const STATE_TTL_SECONDS = 2 * 60 * 60; // 2 hours

interface MatchState {
  ringIndex: number;       // current index into RADIUS_RINGS_KM
  dispatchedAt: string;    // ISO — when last ring was dispatched
}

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
    private readonly ws: WebsocketsGateway,
  ) {}

  // ─── Public API ────────────────────────────────────────────────

  /** Called immediately after a service request is created. */
  async initiateMatching(requestId: string): Promise<void> {
    const state: MatchState = { ringIndex: 0, dispatchedAt: new Date().toISOString() };
    await this.redis.set(this.stateKey(requestId), JSON.stringify(state), STATE_TTL_SECONDS);
    // Dispatch ring 0: 0 → 5 km
    await this.dispatchRing(requestId, 0, RADIUS_RINGS_KM[0]);
  }

  /** Called by the scheduler every minute to expand radius if needed. */
  async tryExpandRadius(requestId: string): Promise<void> {
    const raw = await this.redis.get(this.stateKey(requestId));
    if (!raw) return; // already cleaned up

    const state: MatchState = JSON.parse(raw) as MatchState;
    const elapsed = Date.now() - new Date(state.dispatchedAt).getTime();

    if (elapsed < EXPAND_AFTER_MS) return; // too soon

    if (state.ringIndex >= RADIUS_RINGS_KM.length - 1) {
      // Already at the outermost ring — nothing left to expand to
      this.logger.log(`[Matching] Request ${requestId} reached max radius (${RADIUS_RINGS_KM[RADIUS_RINGS_KM.length - 1]} km), stopping expansion`);
      await this.cleanup(requestId);
      return;
    }

    const nextRingIndex = state.ringIndex + 1;
    const fromKm = RADIUS_RINGS_KM[state.ringIndex];
    const toKm = RADIUS_RINGS_KM[nextRingIndex];

    this.logger.log(`[Matching] Expanding request ${requestId}: ${fromKm} km → ${toKm} km`);
    await this.dispatchRing(requestId, fromKm, toKm);

    const updated: MatchState = { ringIndex: nextRingIndex, dispatchedAt: new Date().toISOString() };
    await this.redis.set(this.stateKey(requestId), JSON.stringify(updated), STATE_TTL_SECONDS);
  }

  /** Call when a booking is accepted so we stop expanding. */
  async cleanup(requestId: string): Promise<void> {
    await this.redis.del(this.stateKey(requestId));
    await this.redis.del(this.notifiedKey(requestId));
  }

  // ─── Private helpers ────────────────────────────────────────────

  /** Finds providers in the (fromKm, toKm] ring and notifies them. */
  private async dispatchRing(requestId: string, fromKm: number, toKm: number): Promise<void> {
    this.logger.log(`[Matching] Legacy service-request matching is disabled for request ${requestId}`);
    return;
  }

  private stateKey(requestId: string): string {
    return `match_state:${requestId}`;
  }

  private notifiedKey(requestId: string): string {
    return `match_notified:${requestId}`;
  }

  private calcDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (v: number) => (v * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return Number((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
  }
}
