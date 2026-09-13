import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** Which of the recipient's notification toggles gates this push. */
export type PushCategory = 'booking' | 'message' | 'payment' | 'account';

interface PushOptions {
  category?: PushCategory;
  recipientType?: 'user' | 'provider' | 'admin';
}

const CATEGORY_PREF_FIELD: Record<PushCategory, string> = {
  booking: 'notifyBookingUpdates',
  message: 'notifyBookingMessages',
  payment: 'notifyPaymentAlerts',
  account: 'notifyAccountAlerts',
};

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Send a push to every active device of a user OR provider (push tokens are
   * stored keyed by the account id in `pushToken.userId` for both).
   *
   * When `opts.category` is given, the recipient's matching notification
   * toggle is honoured — a muted category is skipped.
   */
  async sendToUser(recipientId: string, payload: PushPayload, opts: PushOptions = {}) {
    if (!(await this.categoryAllowed(recipientId, opts))) {
      this.logger.debug(`Push muted by preference (${opts.category}) for ${recipientId}`);
      return;
    }

    const tokens = await this.prisma.pushToken.findMany({
      where: { userId: recipientId, isActive: true },
    });
    if (tokens.length === 0) {
      this.logger.debug(`No active push tokens for ${recipientId}`);
      return;
    }

    const messages = tokens.map((t) => ({
      to: t.token,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      sound: 'default' as const,
      priority: 'high' as const,
      channelId: 'default',
    }));

    let tickets: ExpoTicket[] = [];
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(messages),
      });

      const json = (await response.json().catch(() => null)) as
        | { data?: ExpoTicket[]; errors?: unknown }
        | null;

      if (!response.ok || !json) {
        this.logger.warn(
          `Expo push HTTP ${response.status} for ${recipientId}: ${JSON.stringify(json?.errors ?? {})}`,
        );
        return;
      }
      tickets = Array.isArray(json.data) ? json.data : [];
    } catch (error) {
      this.logger.error(`Expo push request failed for ${recipientId}`, error);
      return;
    }

    let delivered = 0;
    await Promise.all(
      tickets.map(async (ticket, i) => {
        if (ticket.status === 'ok') {
          delivered += 1;
          return;
        }
        const err = ticket.details?.error ?? ticket.message ?? 'unknown';
        this.logger.warn(`Push ticket error for ${recipientId}: ${err}`);

        // The token is gone (app uninstalled / reinstalled / logged out) — stop
        // sending to it.
        if (err === 'DeviceNotRegistered') {
          await this.prisma.pushToken
            .updateMany({ where: { token: messages[i].to }, data: { isActive: false } })
            .catch(() => undefined);
        }
      }),
    );

    this.logger.log(
      `Push to ${recipientId}: ${delivered}/${tickets.length} accepted by Expo`,
    );
  }

  async sendToMultipleUsers(recipientIds: string[], payload: PushPayload) {
    await Promise.all(recipientIds.map((id) => this.sendToUser(id, payload)));
  }

  /**
   * True when the recipient has not muted this category. Fails open: if we
   * cannot resolve the preference (unknown category, admin, missing record),
   * the push is allowed through.
   */
  private async categoryAllowed(recipientId: string, opts: PushOptions): Promise<boolean> {
    const { category, recipientType } = opts;
    if (!category) return true;

    const field = CATEGORY_PREF_FIELD[category] as
      | 'notifyBookingUpdates'
      | 'notifyBookingMessages'
      | 'notifyPaymentAlerts'
      | 'notifyAccountAlerts';
    const select = {
      notifyBookingUpdates: true,
      notifyBookingMessages: true,
      notifyPaymentAlerts: true,
      notifyAccountAlerts: true,
    } as const;

    try {
      if (recipientType === 'provider') {
        const p = await this.prisma.provider.findUnique({ where: { id: recipientId }, select });
        return p ? p[field] !== false : true;
      }
      if (recipientType === 'user' || recipientType === undefined) {
        const u = await this.prisma.user.findUnique({ where: { id: recipientId }, select });
        // Not a user row (e.g. a provider id passed without a type) — allow.
        return u ? u[field] !== false : true;
      }
    } catch {
      return true;
    }
    return true;
  }
}
