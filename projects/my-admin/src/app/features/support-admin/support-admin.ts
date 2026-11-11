import { Component, OnInit, OnDestroy, HostListener, ChangeDetectorRef, Inject, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AdminApiService } from '../../core/services/admin-api.service';
import { AdminSocketService } from '../../core/services/admin-socket.service';
import { AdminRealtimeService } from '../../core/services/admin-realtime.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-support-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './support-admin.html',
  styleUrls: ['./support-admin.css']
})
export class SupportAdmin implements OnInit, OnDestroy {
  private readonly socket = inject(AdminSocketService);
  sessions: { [key: string]: any } = {};
  currentFilter: string = 'all'; // 'all', 'waiting', 'active'
  selectedSessionId: string | null = null;
  searchQuery: string = '';
  lastKnownSessionsJSON: string = '';
  
  adminReplyText: string = '';
  activeTab: 'chat' | 'faqs' = 'chat';

  // Quản lý kịch bản FAQs Chatbot (Thêm, Sửa, Xóa)
  faqs: any[] = [];
  faqSearchQuery: string = '';
  isLoadingFaqs: boolean = false;
  faqModalOpen: boolean = false;
  isEditingFaq: boolean = false;
  editingFaqId: string | null = null;
  faqForm = {
    intent: '',
    title: '',
    keywords: '',
    response: '',
    quickReplies: ''
  };
  isSavingFaq: boolean = false;
  faqSaveError: string = '';
  deleteFaqModalOpen: boolean = false;
  faqToDelete: any = null;
  isDeletingFaq: boolean = false;

  private pollInterval: any;
  private routeSub: any;
  private realtimeSub = new Subscription();

  constructor(
    private cdr: ChangeDetectorRef,
    private adminApi: AdminApiService,
    private route: ActivatedRoute,
    @Inject(PLATFORM_ID) private platformId: object,
    private adminRealtime: AdminRealtimeService
  ) {}

  ngOnInit(): void {
    this.loadSessions();
    this.realtimeSub.add(this.socket.onChatUpdate().subscribe(() => this.loadSessions()));
    this.realtimeSub.add(this.socket.onCrudChange('chat').subscribe(() => this.loadSessions()));
    this.realtimeSub.add(this.adminRealtime.crudChanged$.subscribe((event) => {
      if (event.resource === 'chat') {
        this.loadSessions(true);
      }
    }));

    this.realtimeSub.add(this.adminRealtime.chatMessage$.subscribe((msg) => {
      if (msg && msg.sessionId === this.selectedSessionId) {
        this.loadSessions(true);
      }
    }));
    this.lastKnownSessionsJSON = typeof localStorage !== 'undefined' ? (localStorage.getItem('urii_chat_sessions') || '{}') : '{}';

    // Lắng nghe queryParams để tự động chọn phiên chat khi click từ thông báo
    this.routeSub = this.route.queryParams.subscribe(params => {
      const sid = params['sessionId'];
      if (sid) {
        this.selectedSessionId = sid;
        if (this.sessions[sid]) {
          this.selectSession(sid);
        }
      }
    });
    
    // Kiểm tra đồng bộ định kỳ từ server backend
    if (isPlatformBrowser(this.platformId)) {
      this.pollInterval = setInterval(() => this.loadSessions(true), 2500);
    }
  }

  ngOnDestroy(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    if (this.routeSub) {
      this.routeSub.unsubscribe();
    }
    if (this.realtimeSub) {
      this.realtimeSub.unsubscribe();
    }
  }

  getSessionsArray(): any[] {
    return Object.values(this.sessions);
  }

  getWaitingCount(): number {
    return this.getSessionsArray().filter(s => s.status === 'waiting').length;
  }

  setFilter(filter: string) {
    this.currentFilter = filter;
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

  loadSessions(silent = false) {
    if (!silent && typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        const local = JSON.parse(localStorage.getItem('urii_chat_sessions') || '{}');
        if (local && Object.keys(local).length > 0) {
          this.sessions = local;
        }
      } catch (e) {
        this.sessions = {};
      }
    }

    // Tải đồng bộ từ MongoDB backend
    const token = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('adminToken') || localStorage.getItem('urii-admin-token') || localStorage.getItem('token') || '')
      : '';

    fetch('/api/chat/sessions', {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : (data?.sessions || []);
        if (list && Array.isArray(list)) {
          const map: { [key: string]: any } = {};
          let prevSelectedMsgCount = 0;
          if (this.selectedSessionId && this.sessions[this.selectedSessionId]) {
            prevSelectedMsgCount = this.sessions[this.selectedSessionId].messages?.length || 0;
          }

          list.forEach((s: any) => {
            const key = s.sessionId || s._id;
            map[key] = {
              ...s,
              sessionId: key,
              lastMessageTime: s.lastMessageTime || (s.updatedAt ? new Date(s.updatedAt).getTime() : Date.now())
            };
          });

          this.sessions = map;
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('urii_chat_sessions', JSON.stringify(map));
          }

          // Nếu có selectedSessionId từ route mà chưa được focus
          if (this.selectedSessionId && this.sessions[this.selectedSessionId]) {
            const newMsgCount = this.sessions[this.selectedSessionId].messages?.length || 0;
            if (newMsgCount > prevSelectedMsgCount) {
              this.scrollToBottom();
            }
          }

          this.cdr.detectChanges();
        }
      })
      .catch(err => {
        if (!silent) console.error('Lỗi tải chat sessions từ backend:', err);
      });
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

  getUserAvatarUrl(session: any): string {
    const avatar = String(session?.avatar || session?.userAvatar || '').trim();
    if (
      avatar.startsWith('http://') ||
      avatar.startsWith('https://') ||
      avatar.startsWith('data:')
    ) {
      return avatar;
    }

    return this.adminApi.getLibraryMapImageUrl(avatar || 'images/avatar_user.jpeg');
  }

  onUserAvatarError(event: Event): void {
    const image = event.target as HTMLImageElement;
    const fallbackUrl = this.adminApi.getLibraryMapImageUrl('images/avatar-non.jpg');
    if (image.src !== fallbackUrl) {
      image.src = fallbackUrl;
    }
  }

  selectSession(sessionId: string) {
    this.selectedSessionId = sessionId;
    this.socket.joinChat(sessionId);
    const session = this.sessions[sessionId];
    if (!session) return;

    if (session.unreadCount > 0) {
      session.unreadCount = 0;
      this.sessions[sessionId] = session;
      this.saveSessions();
    }
    this.scrollToBottom();
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
    this.cdr.detectChanges();
    this.scrollToBottom();

    const token = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('adminToken') || localStorage.getItem('urii-admin-token') || localStorage.getItem('token') || '')
      : '';
    fetch(`/api/chat/sessions/${encodeURIComponent(this.selectedSessionId)}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ text, sender: 'admin' })
    })
      .then(() => this.loadSessions(true))
      .catch(err => console.error('Lỗi gửi tin nhắn admin:', err));

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
    this.cdr.detectChanges();
    this.scrollToBottom();

    const token = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('adminToken') || localStorage.getItem('urii-admin-token') || localStorage.getItem('token') || '')
      : '';
    fetch(`/api/chat/sessions/${encodeURIComponent(this.selectedSessionId)}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ status: 'active', systemLog: 'Nhân viên tư vấn đã bắt đầu tiếp quản cuộc trò chuyện.' })
    })
      .then(() => this.loadSessions(true))
      .catch(err => console.error('Lỗi đổi trạng thái chat:', err));
  }

  handbackChat() {
    if (!this.selectedSessionId) return;
    const session = this.sessions[this.selectedSessionId];
    if (!session) return;

    session.status = 'ai';
    session.messages.push({
      text: 'Nhân viên đã trả lại phiên chat cho Urii Bot tự động tư vấn.',
      sender: 'bot',
      timestamp: Date.now(),
      isSystemLog: true
    });
    session.lastMessageTime = Date.now();

    this.sessions[this.selectedSessionId] = session;
    this.saveSessions();
    this.cdr.detectChanges();
    this.scrollToBottom();

    const token = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('adminToken') || localStorage.getItem('urii-admin-token') || localStorage.getItem('token') || '')
      : '';
    fetch(`/api/chat/sessions/${encodeURIComponent(this.selectedSessionId)}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ status: 'ai', systemLog: 'Nhân viên đã trả lại phiên chat cho Urii Bot tự động tư vấn.' })
    })
      .then(() => this.loadSessions(true))
      .catch(err => console.error('Lỗi trả phiên chat cho bot:', err));
  }

  switchTab(tab: 'chat' | 'faqs'): void {
    this.activeTab = tab;
    if (tab === 'faqs') {
      this.loadFaqs();
    }
  }

  loadFaqs(): void {
    this.isLoadingFaqs = true;
    const token = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('adminToken') || localStorage.getItem('urii-admin-token') || localStorage.getItem('token') || '')
      : '';
    fetch('/api/chat/faqs', {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(res => res.json())
      .then(data => {
        this.isLoadingFaqs = false;
        this.faqs = Array.isArray(data) ? data : [];
        this.cdr.detectChanges();
      })
      .catch(err => {
        this.isLoadingFaqs = false;
        console.error('Lỗi tải danh sách FAQ:', err);
        this.cdr.detectChanges();
      });
  }

  getFilteredFaqs(): any[] {
    if (!this.faqSearchQuery || !this.faqSearchQuery.trim()) {
      return this.faqs;
    }
    const q = this.faqSearchQuery.toLowerCase().trim();
    return this.faqs.filter(faq => {
      const title = (faq.title || '').toLowerCase();
      const intent = (faq.intent || '').toLowerCase();
      const response = (faq.response || '').toLowerCase();
      const keywords = (faq.keywords || []).map((k: string) => String(k).toLowerCase()).join(' ');
      return title.includes(q) || intent.includes(q) || response.includes(q) || keywords.includes(q);
    });
  }

  openCreateFaqModal(): void {
    this.isEditingFaq = false;
    this.editingFaqId = null;
    this.faqSaveError = '';
    this.faqForm = {
      intent: '',
      title: '',
      keywords: '',
      response: '',
      quickReplies: ''
    };
    this.faqModalOpen = true;
    this.cdr.detectChanges();
  }

  openEditFaqModal(faq: any): void {
    this.isEditingFaq = true;
    this.editingFaqId = faq.id || faq._id;
    this.faqSaveError = '';
    this.faqForm = {
      intent: faq.intent || '',
      title: faq.title || '',
      keywords: Array.isArray(faq.keywords) ? faq.keywords.join(', ') : '',
      response: faq.response || '',
      quickReplies: Array.isArray(faq.quickReplies) ? faq.quickReplies.join(', ') : ''
    };
    this.faqModalOpen = true;
    this.cdr.detectChanges();
  }

  closeFaqModal(): void {
    this.faqModalOpen = false;
    this.faqSaveError = '';
    this.isSavingFaq = false;
  }

  saveFaq(): void {
    if (!this.faqForm.title.trim() || !this.faqForm.intent.trim() || !this.faqForm.response.trim()) {
      this.faqSaveError = 'Vui lòng điền đầy đủ Tiêu đề, Mã Intent và Câu trả lời.';
      return;
    }

    const keywords = this.faqForm.keywords
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0);

    const quickReplies = this.faqForm.quickReplies
      .split(',')
      .map(r => r.trim())
      .filter(r => r.length > 0);

    const payload = {
      title: this.faqForm.title.trim(),
      intent: this.faqForm.intent.trim(),
      keywords,
      response: this.faqForm.response.trim(),
      quickReplies
    };

    this.isSavingFaq = true;
    this.faqSaveError = '';

    const token = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('adminToken') || localStorage.getItem('urii-admin-token') || localStorage.getItem('token') || '')
      : '';

    const url = this.isEditingFaq && this.editingFaqId
      ? `/api/chat/faqs/${encodeURIComponent(this.editingFaqId)}`
      : '/api/chat/faqs';
    const method = this.isEditingFaq ? 'PUT' : 'POST';

    fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    })
      .then(async res => {
        this.isSavingFaq = false;
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Không thể lưu kịch bản FAQ.');
        }
        return res.json();
      })
      .then(() => {
        this.closeFaqModal();
        this.loadFaqs();
      })
      .catch(err => {
        this.isSavingFaq = false;
        this.faqSaveError = err.message || 'Lỗi kết nối máy chủ.';
        this.cdr.detectChanges();
      });
  }

  openDeleteFaqModal(faq: any): void {
    this.faqToDelete = faq;
    this.deleteFaqModalOpen = true;
    this.cdr.detectChanges();
  }

  closeDeleteFaqModal(): void {
    this.deleteFaqModalOpen = false;
    this.faqToDelete = null;
    this.isDeletingFaq = false;
  }

  confirmDeleteFaq(): void {
    if (!this.faqToDelete) return;
    const targetId = this.faqToDelete.id || this.faqToDelete._id;
    this.isDeletingFaq = true;

    const token = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('adminToken') || localStorage.getItem('urii-admin-token') || localStorage.getItem('token') || '')
      : '';

    fetch(`/api/chat/faqs/${encodeURIComponent(targetId)}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(async res => {
        this.isDeletingFaq = false;
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Không thể xóa FAQ.');
        }
        return res.json();
      })
      .then(() => {
        this.closeDeleteFaqModal();
        this.loadFaqs();
      })
      .catch(err => {
        this.isDeletingFaq = false;
        alert(err.message || 'Lỗi xóa FAQ.');
        this.cdr.detectChanges();
      });
  }

  private scrollToBottom(): void {
    if (typeof document === 'undefined') return;
    setTimeout(() => {
      const el = document.getElementById('admin-chat-messages');
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }, 60);
  }
}
