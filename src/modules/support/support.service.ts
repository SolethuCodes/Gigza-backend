import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

const PERSON_SELECT = { id: true, firstName: true, lastName: true, email: true } as const;
const AUTHOR_SELECT = { id: true, firstName: true, lastName: true, role: true } as const;

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async getActivityLogs(page = 1, limit = 50, search?: string, action?: string) {
    const where: { action?: string; OR?: Array<Record<string, unknown>> } = {};
    if (action && action !== 'all') where.action = action;
    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { entityType: { contains: search, mode: 'insensitive' } },
        { entityId: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const [logs, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where: where as never,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
          provider: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.activityLog.count({ where: where as never }),
    ]);
    return { logs, total, page, limit };
  }

  async getErrorLogs(page = 1, filters: { resolved?: string; context?: string; search?: string } = {}) {
    const where: Prisma.ErrorLogWhereInput = {};
    if (filters.resolved === 'open') where.isResolved = false;
    if (filters.resolved === 'resolved') where.isResolved = true;
    if (filters.context && filters.context !== 'all') where.context = filters.context;
    if (filters.search) {
      where.OR = [
        { message: { contains: filters.search, mode: 'insensitive' } },
        { errorCode: { contains: filters.search, mode: 'insensitive' } },
        { endpoint: { contains: filters.search, mode: 'insensitive' } },
        { context: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    const [logs, total] = await Promise.all([
      this.prisma.errorLog.findMany({
        where,
        skip: (page - 1) * 50,
        take: 50,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.errorLog.count({ where }),
    ]);
    return { logs, total, page, limit: 50 };
  }

  getSystemAlerts() {
    return this.prisma.systemAlert.findMany({ where: { isResolved: false }, orderBy: { createdAt: 'desc' } });
  }

  async createAlert(type: string, severity: string, title: string, description: string, metadata?: Record<string, unknown>) {
    return this.prisma.systemAlert.create({
      data: { type, severity, title, description, metadata: metadata as never },
    });
  }

  async resolveAlert(id: string, resolvedBy: string) {
    return this.prisma.systemAlert.update({ where: { id }, data: { isResolved: true, resolvedAt: new Date(), resolvedBy } });
  }

  async resolveError(id: string) {
    return this.prisma.errorLog.update({ where: { id }, data: { isResolved: true } });
  }

  async reportClientError(input: {
    type?: string;
    message?: string;
    event?: string;
    screen?: string;
    stack?: string;
    platform?: string;
    appVersion?: string;
    statusCode?: number;
    userId?: string;
  }) {
    const type = (input.type || 'CLIENT_ERROR').slice(0, 80);
    const message = (input.message || 'Unspecified client error').slice(0, 1000);
    const event = (input.event || '').slice(0, 500);
    const screen = (input.screen || '').slice(0, 200);
    const since = new Date(Date.now() - 5 * 60 * 1000);

    const duplicate = await this.prisma.errorLog.findFirst({
      where: {
        context: 'mobile',
        message,
        endpoint: screen || undefined,
        createdAt: { gte: since },
      },
    });
    if (duplicate) {
      return { error: duplicate, alert: null, duplicate: true };
    }

    const error = await this.prisma.errorLog.create({
      data: {
        errorCode: type,
        message,
        stack: [event && `Event: ${event}`, input.stack].filter(Boolean).join('\n').slice(0, 4000) || undefined,
        context: 'mobile',
        userId: input.userId,
        endpoint: screen || undefined,
        statusCode: input.statusCode,
      },
    });

    const alert = await this.createAlert(
      'CLIENT_ERROR',
      input.statusCode && input.statusCode >= 500 ? 'high' : 'medium',
      `${type.replace(/_/g, ' ')} on ${screen || 'the app'}`,
      [message, event && `Event: ${event}`, input.platform && `Platform: ${input.platform}`, input.appVersion && `Version: ${input.appVersion}`]
        .filter(Boolean)
        .join(' · '),
      {
        errorLogId: error.id,
        screen,
        event,
        platform: input.platform,
        appVersion: input.appVersion,
      },
    );

    return { error, alert, duplicate: false };
  }

  async getTicketStats() {
    const grouped = await this.prisma.supportTicket.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const counts = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0, total: 0 };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
      counts.total += row._count._all;
    }
    return {
      total: counts.total,
      open: counts.OPEN,
      inProgress: counts.IN_PROGRESS,
      waiting: counts.OPEN + counts.IN_PROGRESS,
      resolved: counts.RESOLVED + counts.CLOSED,
    };
  }

  async getTickets(page = 1, limit = 20, filters: {
    status?: string;
    priority?: string;
    category?: string;
    search?: string;
  } = {}) {
    const where: Prisma.SupportTicketWhereInput = {};
    if (filters.status && filters.status !== 'all') where.status = filters.status.toUpperCase() as never;
    if (filters.priority && filters.priority !== 'all') where.priority = filters.priority.toUpperCase() as never;
    if (filters.category && filters.category !== 'all') where.category = filters.category;
    if (filters.search) {
      where.OR = [
        { subject: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { category: { contains: filters.search, mode: 'insensitive' } },
        { user: { email: { contains: filters.search, mode: 'insensitive' } } },
        { user: { firstName: { contains: filters.search, mode: 'insensitive' } } },
        { user: { lastName: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        include: {
          user: { select: PERSON_SELECT },
          assignedTo: { select: PERSON_SELECT },
          assignedAdmin: { select: PERSON_SELECT },
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return { tickets, total, page, limit };
  }

  async getTicketDetail(id: string) {
    return this.prisma.supportTicket.findUniqueOrThrow({
      where: { id },
      include: {
        user: { select: PERSON_SELECT },
        assignedTo: { select: PERSON_SELECT },
        assignedAdmin: { select: PERSON_SELECT },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: AUTHOR_SELECT },
            admin: { select: PERSON_SELECT },
          },
        },
      },
    });
  }

  async updateTicket(
    id: string,
    data: { status?: string; priority?: string; assignedToId?: string; assignedAdminId?: string; resolution?: string },
    actor: { id: string; type: 'user' | 'provider' | 'admin' },
  ) {
    const before = await this.prisma.supportTicket.findUniqueOrThrow({ where: { id } });
    const closing = data.status === 'RESOLVED' || data.status === 'CLOSED';
    const payload: Prisma.SupportTicketUpdateInput = {};
    if (data.status) payload.status = data.status as never;
    if (data.priority) payload.priority = data.priority as never;
    if (data.assignedToId !== undefined) payload.assignedTo = data.assignedToId ? { connect: { id: data.assignedToId } } : { disconnect: true };
    if (data.assignedAdminId !== undefined) payload.assignedAdmin = data.assignedAdminId ? { connect: { id: data.assignedAdminId } } : { disconnect: true };
    if (data.resolution !== undefined) payload.resolution = data.resolution;
    if (closing) payload.resolvedAt = new Date();
    else if (data.status) payload.resolvedAt = null;

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: payload,
      include: {
        user: { select: PERSON_SELECT },
        assignedTo: { select: PERSON_SELECT },
        assignedAdmin: { select: PERSON_SELECT },
      },
    });

    await this.audit.log({
      actorId: actor.id,
      actorType: actor.type,
      action: closing ? 'TICKET_RESOLVED' : data.assignedAdminId || data.assignedToId ? 'TICKET_ASSIGNED' : 'TICKET_UPDATED',
      entityType: 'SupportTicket',
      entityId: id,
      metadata: {
        fromStatus: before.status,
        toStatus: updated.status,
        priority: updated.priority,
      },
    });
    return updated;
  }

  async addTicketMessage(
    ticketId: string,
    actor: { id: string; type: 'user' | 'provider' | 'admin' },
    body: string,
    isInternal = false,
  ) {
    const ticket = await this.prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
    const message = await this.prisma.supportTicketMessage.create({
      data: {
        ticketId,
        body,
        isInternal,
        authorId: actor.type === 'admin' ? undefined : actor.id,
        adminId: actor.type === 'admin' ? actor.id : undefined,
      },
      include: {
        author: { select: AUTHOR_SELECT },
        admin: { select: PERSON_SELECT },
      },
    });

    if (!isInternal && ticket.status === 'OPEN') {
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: 'IN_PROGRESS',
          assignedAdminId: actor.type === 'admin' ? actor.id : undefined,
          assignedToId: actor.type === 'user' ? actor.id : undefined,
        },
      });
    }

    await this.audit.log({
      actorId: actor.id,
      actorType: actor.type,
      action: isInternal ? 'TICKET_INTERNAL_NOTE' : 'TICKET_REPLIED',
      entityType: 'SupportTicket',
      entityId: ticketId,
    });

    // Notify the ticket owner when support (an admin) replies.
    if (!isInternal && actor.type === 'admin' && ticket.userId) {
      void this.notifications
        .send(
          ticket.userId,
          'SYSTEM_ALERT',
          'Support replied',
          `New reply on your ticket: "${ticket.subject}"`,
          { ticketId, type: 'support' },
          'user',
        )
        .catch(() => undefined);
    }

    return message;
  }

  // ── Customer-facing ────────────────────────────────────────────────────────

  /** A signed-in customer/provider opens a support request describing a problem. */
  async createUserTicket(
    actor: { id: string; type: 'user' | 'provider' | 'admin'; email?: string },
    input: { subject?: string; description: string; category?: string },
  ) {
    const isUser = actor.type === 'user';
    const raw = input.description.trim().slice(0, 4000);
    // SupportTicket.userId FKs to the users table, so only link real customers.
    // For a provider, keep the row unlinked and note who it's from in the body.
    const description = isUser
      ? raw
      : `[From provider ${actor.email ?? actor.id}]\n\n${raw}`.slice(0, 4000);
    const subject = (input.subject?.trim() || raw.split('\n')[0]).slice(0, 140) || 'Support request';
    const category = input.category?.trim().slice(0, 60) || 'general';

    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId: isUser ? actor.id : null,
        subject,
        description,
        category,
        status: 'OPEN',
        priority: 'MEDIUM',
        messages: { create: { authorId: isUser ? actor.id : null, body: description } },
      },
    });

    await this.createAlert(
      'SUPPORT_TICKET',
      'medium',
      `New support request: ${subject}`,
      description.slice(0, 300),
      { ticketId: ticket.id },
    ).catch(() => undefined);

    return ticket;
  }

  /** The tickets a customer/provider has opened, newest first, with the thread. */
  async getUserTickets(actor: { id: string; type: 'user' | 'provider' | 'admin' }) {
    if (actor.type !== 'user') return [];
    return this.prisma.supportTicket.findMany({
      where: { userId: actor.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          where: { isInternal: false },
          orderBy: { createdAt: 'asc' },
          select: { id: true, body: true, createdAt: true, authorId: true, adminId: true },
        },
      },
    });
  }
}
