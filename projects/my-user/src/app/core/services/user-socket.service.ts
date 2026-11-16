import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

export interface SocketEvent {
  resource?: string;
  action?: string;
  id?: string;
  [key: string]: any;
}

@Injectable({
  providedIn: 'root'
})
export class UserSocketService {
  private socket: Socket | null = null;
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private crudSubject = new Subject<SocketEvent>();
  private userUpdateSubject = new Subject<SocketEvent>();
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
      localStorage.getItem('authToken') ||
      localStorage.getItem('urii.auth.token') ||
      '';

    const userId = localStorage.getItem('userId') || '';

    const host = window.location.hostname;
    const socketUrl = `${window.location.protocol}//${host}:3002`;

    this.socket = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000
    });

    this.socket.on('connect', () => {
      if (userId) {
        this.socket?.emit('identify', userId);
      }
    });

    this.socket.on('crud:changed', (data: SocketEvent) => {
      this.crudSubject.next(data);
    });

    this.socket.on('user:update', (data: SocketEvent) => {
      this.userUpdateSubject.next(data);
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

  onCrudChange(resource?: string): Observable<SocketEvent> {
    if (resource) {
      return new Observable<SocketEvent>((subscriber) => {
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

  onUserUpdate(resource?: string): Observable<SocketEvent> {
    if (resource) {
      return new Observable<SocketEvent>((subscriber) => {
        const sub = this.userUpdateSubject.subscribe((event) => {
          if (event.resource === resource) {
            subscriber.next(event);
          }
        });
        return () => sub.unsubscribe();
      });
    }
    return this.userUpdateSubject.asObservable();
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
