import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

export interface CrudChangeEvent {
  resource: string;
  action: string;
  id: string;
  [key: string]: any;
}

@Injectable({
  providedIn: 'root'
})
export class AdminSocketService {
  private socket: Socket | null = null;
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private crudSubject = new Subject<CrudChangeEvent>();
  private chatSubject = new Subject<any>();

  constructor() {
    if (this.isBrowser) {
      this.connect();
    }
  }

  connect(): void {
    if (!this.isBrowser) return;

    if (this.socket && this.socket.connected) {
      return;
    }

    const token =
      localStorage.getItem('adminToken') ||
      localStorage.getItem('urii-admin-token') ||
      localStorage.getItem('token') ||
      '';

    if (!token) {
      return;
    }

    const host = window.location.hostname;
    const socketUrl = `${window.location.protocol}//${host}:3002/admin`;

    this.socket = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000
    });

    this.socket.on('crud:changed', (data: CrudChangeEvent) => {
      this.crudSubject.next(data);
    });

    this.socket.on('chat:update', (data: any) => {
      this.chatSubject.next(data);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  onCrudChange(resource?: string): Observable<CrudChangeEvent> {
    if (resource) {
      return new Observable<CrudChangeEvent>((subscriber) => {
        const sub = this.crudSubject.subscribe((event) => {
          if (event.resource === resource) {
            subscriber.next(event);
          }
        });
        return () => sub.unsubscribe();
      });
    }
    return this.crudSubject.asObservable();
  }

  onChatUpdate(): Observable<any> {
    return this.chatSubject.asObservable();
  }

  joinChat(sessionId: string): void {
    if (this.socket && sessionId) {
      this.socket.emit('join:chat', sessionId);
    }
  }

  leaveChat(sessionId: string): void {
    if (this.socket && sessionId) {
      this.socket.emit('leave:chat', sessionId);
    }
  }
}
