import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-support-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './support-admin.html',
  styleUrls: ['./support-admin.css']
})
export class SupportAdmin implements OnInit, OnDestroy {
  sessions: { [key: string]: any } = {};
  currentFilter: string = 'all'; // 'all', 'waiting', 'active'
  selectedSessionId: string | null = null;
  searchQuery: string = '';
  lastKnownSessionsJSON: string = '';
  
  adminReplyText: string = '';
  private pollInterval: any;

  ngOnInit(): void {
    this.loadSessions();
    this.lastKnownSessionsJSON = localStorage.getItem('urii_chat_sessions') || '{}';
    
    // Kiểm tra đồng bộ định kỳ
    if (typeof window !== 'undefined') {
      this.pollInterval = setInterval(() => this.checkAndSyncStorage(), 1500);
    }
  }

  ngOnDestroy(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }

  getSessionsArray(): any[] {
    return Object.values(this.sessions);
  }

  getWaitingCount(): number {
    return this.getSessionsArray().filter(s => s.status === 'waiting').length;
  }

  getFilteredSessions(): any[] {
    let list = this.getSessionsArray();

    // Lọc theo tìm kiếm
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(s => 
        (s.userName && s.userName.toLowerCase().includes(q)) || 
        (s.userEmail && s.userEmail.toLowerCase().includes(q))
      );
    }

    // Lọc theo Tab trạng thái
    if (this.currentFilter === 'waiting') {
      list = list.filter(s => s.status === 'waiting');
    } else if (this.currentFilter === 'active') {
      list = list.filter(s => s.status === 'active');
    }

    // Sắp xếp tin nhắn mới nhất lên đầu
    return list.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
  }

  loadSessions() {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        this.sessions = JSON.parse(localStorage.getItem('urii_chat_sessions') || '{}');
      } catch (e) {
        console.error('Error reading urii_chat_sessions:', e);
        this.sessions = {};
      }
    }
  }

  saveSessions() {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.setItem('urii_chat_sessions', JSON.stringify(this.sessions));
    }
  }

  formatTime(timestamp: number): string {
    if (!timestamp) return 'Gần đây';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }

  getInitials(name: string): string {
    if (!name) return 'KV';
    return name.split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase();
  }

  selectSession(sessionId: string) {
    this.selectedSessionId = sessionId;
    const session = this.sessions[sessionId];
    if (!session) return;

    if (session.unreadCount > 0) {
      session.unreadCount = 0;
      this.sessions[sessionId] = session;
      this.saveSessions();
    }
  }

  getSelectedSession() {
    if (!this.selectedSessionId) return null;
    return this.sessions[this.selectedSessionId] || null;
  }

  getLastMessage(session: any): string {
    if (!session.messages || session.messages.length === 0) return 'Chưa có tin nhắn';
    const lastMsg = session.messages[session.messages.length - 1];
    let prefix = 'Urii: ';
    if (lastMsg.sender === 'user') prefix = 'Bạn: ';
    if (lastMsg.sender === 'admin') prefix = 'Admin: ';
    return `${prefix}${lastMsg.text}`;
  }

  sendAdminMessage() {
    const text = this.adminReplyText.trim();
    if (!text || !this.selectedSessionId) return;

    const session = this.sessions[this.selectedSessionId];
    if (!session) return;

    let statusChanged = false;
    if (session.status !== 'active') {
      session.status = 'active';
      statusChanged = true;
      session.messages.push({
        text: 'Nhân viên tư vấn đã bắt đầu tiếp quản cuộc trò chuyện.',
        sender: 'admin',
        timestamp: Date.now(),
        isSystemLog: true
      });
    }

    session.messages.push({
      text: text,
      sender: 'admin',
      timestamp: Date.now()
    });
    session.lastMessageTime = Date.now();
    session.unreadCount = 0;

    this.sessions[this.selectedSessionId] = session;
    this.saveSessions();

    this.adminReplyText = '';
  }

  takeoverChat() {
    if (!this.selectedSessionId) return;
    const session = this.sessions[this.selectedSessionId];
    if (!session) return;

    session.status = 'active';
    session.messages.push({
      text: 'Nhân viên tư vấn đã bắt đầu tiếp quản cuộc trò chuyện.',
      sender: 'admin',
      timestamp: Date.now(),
      isSystemLog: true
    });
    session.lastMessageTime = Date.now();
    session.unreadCount = 0;

    this.sessions[this.selectedSessionId] = session;
    this.saveSessions();
  }

  handbackChat() {
    if (!this.selectedSessionId) return;
    const session = this.sessions[this.selectedSessionId];
    if (!session) return;

    session.status = 'ai';
    session.messages.push({
      text: 'Hệ thống đã chuyển giao lại quyền hỗ trợ cho Trợ lý ảo AI.',
      sender: 'bot',
      timestamp: Date.now(),
      isSystemLog: true
    });
    session.lastMessageTime = Date.now();

    this.sessions[this.selectedSessionId] = session;
    this.saveSessions();
  }

  setFilter(filter: string) {
    this.currentFilter = filter;
  }

  checkAndSyncStorage() {
    if (typeof window === 'undefined') return;
    const currentJSON = localStorage.getItem('urii_chat_sessions') || '{}';
    if (currentJSON !== this.lastKnownSessionsJSON) {
      this.lastKnownSessionsJSON = currentJSON;
      this.loadSessions();
    }
  }

  @HostListener('window:storage', ['$event'])
  onStorageChange(event: StorageEvent) {
    if (event.key === 'urii_chat_sessions') {
      this.loadSessions();
    }
  }
}