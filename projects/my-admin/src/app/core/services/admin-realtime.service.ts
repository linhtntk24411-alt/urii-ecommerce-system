import { Injectable, Inject, PLATFORM_ID, OnDestroy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

export interface AdminCrudChange {
  resource: string;
  action: string;
  id: string;
}

@Injectable({
  providedIn: 'root'
})
export class AdminRealtimeService implements OnDestroy {
  private socket: Socket | null = null;
  private readonly crudChangedSubject = new Subject<AdminCrudChange>();
  private readonly chatMessageSubject = new Subject<any>();
  private readonly chatStatusSubject = new Subject<any>();
  private readonly connectedSubject = new Subject<boolean>();

  readonly crudChanged$: Observable<AdminCrudChange> = this.crudChangedSubject.asObservable();
  readonly chatMessage$: Observable<any> = this.chatMessageSubject.asObservable();
  readonly chatStatus$: Observable<any> = this.chatStatusSubject.asObservable();
  readonly connected$: Observable<boolean> = this.connectedSubject.asObservable();

  constructor(@Inject(PLATFORM_ID) private platformId: object) {
    if (isPlatformBrowser(this.platformId)) {
      this.connect();
      window.addEventListener('storage', (e) => {
        if (e.key === 'adminToken' || e.key === 'token') {
          this.reconnect();
        }
      });
    }
  }

  connect(): void {
    if (!isPlatformBrowser(this.platformId) || this.socket) return;

    const token = localStorage.getItem('adminToken')
      || localStorage.getItem('urii-admin-token')
      || localStorage.getItem('token')
      || '';

    if (!token) return;

    const socketUrl = window.location.port === '4200' ? 'http://localhost:3002/admin' : '/admin';

    try {
      this.socket = io(socketUrl, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 2000,
        reconnectionAttempts: 10
      });

      this.socket.on('connect', () => {
        this.connectedSubject.next(true);
      });

      this.socket.on('disconnect', () => {
        this.connectedSubject.next(false);
      });

      // Lắng nghe sự kiện thay đổi dữ liệu từ server (orders, products, notifications, chat...)
      this.socket.on('crud:changed', (data: AdminCrudChange) => {
        this.crudChangedSubject.next(data);
      });

      // Lắng nghe tin nhắn chat từ khách
      this.socket.on('chat:message', (data: any) => {
        this.chatMessageSubject.next(data);
      });

      this.socket.on('chat:status', (data: any) => {
        this.chatStatusSubject.next(data);
      });
    } catch (err) {
      console.warn('Lỗi kết nối Admin Realtime Socket:', err);
    }
  }

  reconnect(): void {
    this.disconnect();
    this.connect();
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connectedSubject.next(false);
    }
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
