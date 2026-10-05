import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;
  private password?: string;
  private useTls = false;
  private tlsServername?: string;
  /**
   * Fallback store used whenever Redis isn't connected, so auth (refresh tokens,
   * OTPs) keeps working on a single instance without Redis. Values don't survive
   * a restart or span instances — configure REDIS_URL for anything real.
   */
  private readonly memory = new Map<string, { value: string; expiresAt: number | null }>();
  private warnedFallback = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('database.redisUrl', 'redis://localhost:6379');
    const parsed = new URL(url);
    this.password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
    this.useTls = parsed.protocol === 'rediss:';
    this.tlsServername = parsed.hostname;

    const host = parsed.hostname || 'localhost';
    const port = Number(parsed.port) || 6379;
    const localPlain = !this.useTls && (host === 'localhost' || host === '127.0.0.1');

    // docker-compose Redis requires a password; a bare Windows/WSL Redis often
    // does not. On localhost, try without AUTH first so we don't log
    // "server does not require a password". If Redis replies NOAUTH, reconnect
    // with REDIS_PASSWORD.
    this.client = this.createClient(host, port, localPlain ? undefined : this.password);
    this.bindClientEvents(this.client, {
      host,
      port,
      retryWithPassword: Boolean(localPlain && this.password),
    });
  }

  private createClient(host: string, port: number, password?: string) {
    return new Redis({
      host,
      port,
      password,
      tls: this.useTls ? { servername: this.tlsServername } : undefined,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
  }

  private bindClientEvents(
    client: Redis,
    options: { host: string; port: number; retryWithPassword: boolean },
  ) {
    let recovering = false;
    client.on('connect', () => this.logger.log('Redis connected'));
    client.on('error', (err) => {
      const needsAuth =
        options.retryWithPassword &&
        !recovering &&
        /NOAUTH|Authentication required|invalid password/i.test(err.message);

      if (needsAuth) {
        recovering = true;
        this.logger.log('Local Redis requires a password — reconnecting with REDIS_PASSWORD');
        client.disconnect();
        this.client = this.createClient(options.host, options.port, this.password);
        this.bindClientEvents(this.client, { ...options, retryWithPassword: false });
        return;
      }

      if (!recovering) {
        this.logger.error('Redis error', err);
      }
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  /**
   * Azure Managed Redis (OSS Cluster clustering policy) shards keys across nodes
   * and replies with -MOVED for keys the connected node doesn't own. Rather than a
   * full Cluster client (which connects to every shard up front and can hang the
   * whole app if one shard address isn't reachable — happened once already), just
   * follow the redirect for the one key involved: connect on demand to the node
   * named in the error, retry that single command, then close it.
   */
  private async withMovedRedirect<T>(fn: (client: Redis) => Promise<T>): Promise<T> {
    try {
      return await fn(this.client);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const match = /^MOVED \d+ (.+):(\d+)/.exec(message);
      if (!match) throw err;

      const [, host, port] = match;
      const redirected = new Redis({
        host,
        port: Number(port),
        password: this.password,
        // Redis Enterprise (what Azure Managed Redis runs on) issues one TLS cert
        // for the cluster's hostname, validated via SNI — not per-node IPs. Without
        // `servername` here, connecting straight to the MOVED target's raw IP fails
        // hostname verification (ERR_TLS_CERT_ALTNAME_INVALID).
        tls: this.useTls ? { servername: this.tlsServername } : undefined,
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });
      redirected.on('error', (err) => this.logger.error(`Redis redirect error (${host}:${port})`, err));

      try {
        await redirected.connect();
        return await fn(redirected);
      } finally {
        redirected.disconnect();
      }
    }
  }

  private useMemory(): boolean {
    if (this.client?.status === 'ready') return false;
    if (!this.warnedFallback) {
      this.warnedFallback = true;
      this.logger.warn('Redis unavailable — using in-memory fallback (single instance, not persisted). Set REDIS_URL.');
    }
    return true;
  }

  private memoryGet(key: string): string | null {
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return entry.value;
  }

  async get(key: string): Promise<string | null> {
    if (this.useMemory()) return this.memoryGet(key);
    return this.withMovedRedirect((client) => client.get(key));
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.useMemory()) {
      this.memory.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
      return;
    }
    await this.withMovedRedirect((client) =>
      ttlSeconds ? client.setex(key, ttlSeconds, value) : client.set(key, value),
    );
  }

  async del(key: string): Promise<void> {
    if (this.useMemory()) {
      this.memory.delete(key);
      return;
    }
    await this.withMovedRedirect((client) => client.del(key));
  }

  async exists(key: string): Promise<boolean> {
    if (this.useMemory()) return this.memoryGet(key) !== null;
    const result = await this.withMovedRedirect((client) => client.exists(key));
    return result === 1;
  }

  async incr(key: string): Promise<number> {
    if (this.useMemory()) {
      const next = Number(this.memoryGet(key) ?? 0) + 1;
      const expiresAt = this.memory.get(key)?.expiresAt ?? null;
      this.memory.set(key, { value: String(next), expiresAt });
      return next;
    }
    return this.withMovedRedirect((client) => client.incr(key));
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    if (this.useMemory()) {
      const value = this.memoryGet(key);
      if (value !== null) this.memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return;
    }
    await this.withMovedRedirect((client) => client.expire(key, ttlSeconds));
  }

  async publish(channel: string, message: string): Promise<void> {
    // No subscribers exist without Redis, so dropping the message is equivalent.
    if (this.useMemory()) return;
    await this.withMovedRedirect((client) => client.publish(channel, message));
  }

  async ping(): Promise<string> {
    return this.withMovedRedirect((client) => client.ping());
  }

  getClient(): Redis {
    return this.client;
  }
}
