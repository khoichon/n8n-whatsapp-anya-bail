/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'events';
import type { EventSubscriber, WhatsAppEventName } from './Types';

/**
 * Same fan-out design as `shared/EventBus.ts` (one instance per session,
 * lets multiple Trigger/Events nodes share a single connection) but
 * generic over `WhatsAppEventName` instead of the legacy-only
 * `SupportedEvent` union, so it can carry the broader event set the
 * official backend exposes.
 */
export class BackendEventBus {
  private emitter = new EventEmitter();
  private subscriptions = new Map<string, Set<EventSubscriber>>();

  constructor(private sessionId: string) {
    this.emitter.setMaxListeners(100);
  }

  subscribe(event: WhatsAppEventName, subscriber: EventSubscriber): () => void {
    if (!this.subscriptions.has(event)) this.subscriptions.set(event, new Set());
    this.subscriptions.get(event)!.add(subscriber);
    this.emitter.on(event, subscriber as (...args: any[]) => void);
    return () => this.unsubscribe(event, subscriber);
  }

  unsubscribe(event: WhatsAppEventName, subscriber: EventSubscriber): void {
    this.subscriptions.get(event)?.delete(subscriber);
    this.emitter.off(event, subscriber as (...args: any[]) => void);
  }

  publish(event: WhatsAppEventName, data: unknown): void {
    this.emitter.emit(event, data);
  }

  clearAll(): void {
    this.emitter.removeAllListeners();
    this.subscriptions.clear();
  }
}
