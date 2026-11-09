import { Injectable, Inject, PLATFORM_ID, OnDestroy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

export interface RealtimeNotification {
  id: string;
  typeId: string;
  title: string;
  message: string;
  desc?: string;
  actionUrl?: string;
  isRead: boolean;
  createdAt: string | Date;
}

export interface RealtimeChatMessage {
  sessionId: string;
  text: string;
  sender: 'user' | 'admin' | 'bot';
  timestamp: number;
  isSystemLog?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class UserRealtimeService implements OnDestroy {
  private socket: Socket | null = null;
  private readonly notificationSubject = new Subject<RealtimeNotification>();
  private readonly chatMessageSubject = new Subject<RealtimeChatMessage>();
  private readonly chatStatusSubject = new Subject<{ sessionId: string; status: string; systemLog?: string }>();
  private readonly catalogUpdatedSubject = new Subject<{ resource: string; action: string; id: string }>();
  private readonly connectedSubject = new Subject<boolean>();

  readonly notification$: Observable<RealtimeNotification> = this.notificationSubject.asObservable();
  readonly chatMessage$: Observable<RealtimeChatMessage> = this.chatMessageSubject.asObservable();
  readonly chatStatus$: Observable<{ sessionId: string; status: string; systemLog?: string }> = this.chatStatusSubject.asObservable();
  readonly catalogUpdated$: Observable<{ resource: string; action: string; id: string }> = this.catalogUpdatedSubject.asObservable();
  readonly connected$: Observable<boolean> = this.connectedSubject.asObservable();

  constructor(@Inject(PLATFORM_ID) private platformId: object) {
    if (isPlatformBrowser(this.platformId)) {
      this.connect();
      // Lắng nghe sự kiện đăng nhập/đăng xuất để kết nối lại với token mới
      window.addEventListener('auth:changed', () => this.reconnect());
      window.addEventListener('storage', (e) => {
        if (e.key === 'authToken' || e.key === 'isLoggedIn') {
          this.reconnect();
        }
      });
    }
  }

  connect(): void {
    if (!isPlatformBrowser(this.platformId) || this.socket) return;

    const token = localStorage.getItem('authToken') || '';
    const socketUrl = window.location.port === '4201' ? 'http://localhost:3002/user' : '/user';

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

      // Lắng nghe thông báo cá nhân mới từ server
      this.socket.on('notification:new', (notif: RealtimeNotification) => {
        this.notificationSubject.next(notif);
      });

      // Lắng nghe tin nhắn chat từ admin
      this.socket.on('chat:message', (msg: RealtimeChatMessage) => {
        this.chatMessageSubject.next(msg);
      });

      // Lắng nghe thay đổi trạng thái chat (ví dụ admin tiếp quản hoặc chuyển lại bot)
      this.socket.on('chat:status', (data: { sessionId: string; status: string; systemLog?: string }) => {
        this.chatStatusSubject.next(data);
      });

      // Lắng nghe cập nhật sản phẩm / map
      this.socket.on('catalog:updated', (data: { resource: string; action: string; id: string }) => {
        this.catalogUpdatedSubject.next(data);
      });
    } catch (err) {
      console.warn('Lỗi kết nối User Realtime Socket:', err);
    }
  }

  reconnect(): void {
    this.disconnect();
    this.connect();
  }

  joinChat(sessionId: string): void {
    if (this.socket && sessionId) {
      this.socket.emit('chat:join', sessionId);
    }
  }

  leaveChat(sessionId: string): void {
    if (this.socket && sessionId) {
      this.socket.emit('chat:leave', sessionId);
    }
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
