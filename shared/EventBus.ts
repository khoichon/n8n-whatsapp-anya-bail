/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'events';
import type { SupportedEvent } from './Constants';
import type { EventSubscriber } from './Types';
import { rootLogger } from './Logger';

/**
 * Central EventBus that fans out Baileys socket events to multiple n8n Trigger Nodes
 * without creating extra WhatsApp connections.
 * One EventBus instance exists per session (managed by SessionManager).
 */
export class EventBus {
  private emitter: EventEmitter;
  private subscriptions = new Map<string, Set<EventSubscriber>>();

  constructor(private sessionId: string) {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
  }

  subscribe(event: SupportedEvent, subscriber: EventSubscriber): () => void {
    if (!this.subscriptions.has(event)) {
      this.subscriptions.set(event, new Set());
    }
    this.subscriptions.get(event)!.add(subscriber);
    this.emitter.on(event, subscriber as (...args: any[]) => void);
    rootLogger.debug(`EventBus[${this.sessionId}] subscriber added`, { event });
    return () => this.unsubscribe(event, subscriber);
  }

  unsubscribe(event: SupportedEvent, subscriber: EventSubscriber): void {
    this.subscriptions.get(event)?.delete(subscriber);
    this.emitter.off(event, subscriber as (...args: any[]) => void);
  }

  publish(event: SupportedEvent, data: unknown): void {
    rootLogger.debug(`EventBus[${this.sessionId}] publish`, { event });
    this.emitter.emit(event, data);
  }

  subscriberCount(event?: SupportedEvent): number {
    if (event) return this.subscriptions.get(event)?.size ?? 0;
    let total = 0;
    for (const set of this.subscriptions.values()) total += set.size;
    return total;
  }

  clearAll(): void {
    this.emitter.removeAllListeners();
    this.subscriptions.clear();
  }
}
