import { DialogService } from '../../core/services/dialog.service';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, AfterViewInit, OnDestroy, Inject, PLATFORM_ID, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, delay, finalize, map, Observable, of } from 'rxjs';

interface ChatMessage {
  targetUrl?: string;
  targetLabel?: string;
  text: string;
  sender: 'user' | 'bot' | 'admin';
  timestamp: number;
  chips?: { label: string; action: string }[];
}

interface ChatSession {
  sessionId: string;
  userName: string;
  userEmail: string;
  status: 'ai' | 'waiting' | 'active';
  lastMessageTime: number;
  unreadCount: number;
  messages: ChatMessage[];
}

interface ChatbotReply {
  targetUrl?: string;
  targetLabel?: string;
  text: string;
  chips?: { label: string; action: string }[];
}

interface ChatbotFaq {
  intent: string;
  keywords: string[];
  response: string;
  quickReplies: { label: string; action: string }[];
}

@Component({
  selector: 'app-chatbot-widget',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chatbot-widget.html',
  styleUrl: './chatbot-widget.css'
})
export class ChatbotWidgetComponent implements OnInit, AfterViewInit, OnDestroy {
  isChatOpen: boolean = false;
  isHistoryViewOpen: boolean = false;
  isEmojiPickerOpen: boolean = false;
  isTyping: boolean = false;
  userMessageText: string = '';
  
  botName: string = 'Trợ lý ảo Urii';
  botStatus: string = 'Đang trực tuyến';
  statusDotColor: boolean = true; 
  
  messages: ChatMessage[] = [];
  emojis: string[] = ['😊', '😂', '🥰', '👍', '🔥', '❤️', '✨', '⭐', '😭', '😮'];
  
  private currentSessionId: string = '';
  private memoryStorage: { [key: string]: string } = {};
  private syncInterval: any;
  private pendingBotReplies = 0;
  private readonly http = inject(HttpClient);
  private readonly dialogService = inject(DialogService);

  constructor(
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object,
    private cdr: ChangeDetectorRef 
  ) {}

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.currentSessionId = this.getOrCreateSessionId();
      this.loadChatHistory();
    }
  }

  ngAfterViewInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      // Đồng bộ định kỳ trạng thái chat
      this.syncInterval = setInterval(() => {
        this.syncChatUI();
      }, 1500);
    }
  }

  ngOnDestroy(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
  }

  toggleChatWindow(): void {
    this.isChatOpen = !this.isChatOpen;
    if (this.isChatOpen) {
      setTimeout(() => this.scrollToBottom(), 100);
    }
  }

  
  
  isUserLoggedIn(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    const email = localStorage.getItem('userEmail')?.trim();
    return localStorage.getItem('isLoggedIn') === 'true' && Boolean(email);
  }

  getCurrentUserEmail(): string {
    if (!isPlatformBrowser(this.platformId)) return '';
    return localStorage.getItem('userEmail')?.trim().toLowerCase() || '';
  }

  getUserSessions(): ChatSession[] {
    const email = this.getCurrentUserEmail();
    if (!email) return [];
    const sessions = this.getSessions();
    return Object.values(sessions)
      .filter((s) => s.userEmail && s.userEmail.trim().toLowerCase() === email && s.messages && s.messages.length > 0)
      .sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
  }

  toggleHistoryView(): void {
    if (!this.isUserLoggedIn()) {
      this.dialogService.promptLogin({
        title: 'Đăng nhập để xem lịch sử chat',
        description: 'Vui lòng đăng nhập tài khoản Urii để xem lại các cuộc trò chuyện và lịch sử tư vấn trước đây.',
        returnUrl: this.router.url
      });
      return;
    }
    this.isHistoryViewOpen = !this.isHistoryViewOpen;
    this.cdr.detectChanges();
  }

  switchSession(sessionId: string): void {
    const sessions = this.getSessions();
    if (!sessions[sessionId]) return;

    this.currentSessionId = sessionId;
    const userEmail = this.getCurrentUserEmail();
    const cleanEmail = userEmail ? userEmail.replace(/[^a-zA-Z0-9]/g, '_') : 'guest';
    this.safeSetItem(`urii_chat_session_id_${cleanEmail}`, sessionId);

    this.messages = [...(sessions[sessionId].messages || [])];
    this.updateHeaderStatus(sessions[sessionId].status || 'ai');
    this.isHistoryViewOpen = false;
    this.cdr.detectChanges();
    setTimeout(() => this.scrollToBottom(), 100);
  }

  deleteSession(sessionId: string, event: Event): void {
    event.stopPropagation();
    const sessions = this.getSessions();
    delete sessions[sessionId];
    this.saveSessions(sessions);

    if (this.currentSessionId === sessionId) {
      this.resetChat();
    } else {
      this.cdr.detectChanges();
    }
  }

  formatSessionDate(timestamp: number): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const timeStr = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    if (isToday) {
      return `Hôm nay lúc ${timeStr}`;
    }
    return `${date.toLocaleDateString('vi-VN')} lúc ${timeStr}`;
  }

  getSessionPreview(session: ChatSession): string {
    if (!session.messages || session.messages.length === 0) return 'Chưa có tin nhắn';
    const last = session.messages[session.messages.length - 1];
    return last.text.slice(0, 50) + (last.text.length > 50 ? '...' : '');
  }

  onInputKeyDown(event: KeyboardEvent, inputEl?: HTMLInputElement): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.sendMessage(inputEl);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.clearInput(inputEl);
    }
  }

  resetChat(): void {
    const isLoggedIn = this.safeGetItem('isLoggedIn') === 'true';
    const userEmail = isLoggedIn ? (this.safeGetItem('userEmail') || 'guest') : 'guest';
    const cleanEmail = userEmail.replace(/[^a-zA-Z0-9]/g, '_');
    const storageKey = `urii_chat_session_id_${cleanEmail}`;

    const newSessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    this.currentSessionId = newSessionId;
    this.safeSetItem(storageKey, newSessionId);

    const sessions = this.getSessions();
    sessions[newSessionId] = {
      sessionId: newSessionId,
      userName: this.safeGetItem('userName') || 'Khách vãng lai',
      userEmail: this.safeGetItem('userEmail') || '',
      status: 'ai',
      lastMessageTime: Date.now(),
      unreadCount: 0,
      messages: []
    };
    this.saveSessions(sessions);

    this.messages = [];
    this.userMessageText = '';
    this.updateHeaderStatus('ai');
    this.cdr.detectChanges();
    this.loadChatHistory();
  }

  clearInput(inputEl?: HTMLInputElement): void {
    this.userMessageText = '';
    if (inputEl) inputEl.value = '';
    const el = document.getElementById('chat-input') as HTMLInputElement;
    if (el) el.value = '';
  }

  closeChat(): void {
    this.isChatOpen = false;
  }

  toggleEmojiPicker(event: Event): void {
    event.stopPropagation();
    this.isEmojiPickerOpen = !this.isEmojiPickerOpen;
  }

  addEmoji(emoji: string): void {
    this.userMessageText += emoji;
    this.isEmojiPickerOpen = false;
  }

  triggerFileInput(): void {
    const fileInput = document.getElementById('chat-file-input') as HTMLInputElement;
    if (fileInput) fileInput.click();
  }

  private safeGetItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return this.memoryStorage[key] || null;
    }
  }

  private safeSetItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      this.memoryStorage[key] = value;
    }
  }

  private getOrCreateSessionId(): string {
    const isLoggedIn = this.safeGetItem('isLoggedIn') === 'true';
    const userEmail = isLoggedIn ? (this.safeGetItem('userEmail') || 'guest') : 'guest';
    const cleanEmail = userEmail.replace(/[^a-zA-Z0-9]/g, '_');
    const storageKey = `urii_chat_session_id_${cleanEmail}`;

    let sessionId = this.safeGetItem(storageKey);
    if (!sessionId) {
      sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      this.safeSetItem(storageKey, sessionId);
    }
    return sessionId;
  }

  private getSessions(): { [key: string]: ChatSession } {
    try {
      const val = this.safeGetItem('urii_chat_sessions');
      return val ? JSON.parse(val) : {};
    } catch (e) {
      return {};
    }
  }

  private saveSessions(sessions: { [key: string]: ChatSession }): void {
    try {
      this.safeSetItem('urii_chat_sessions', JSON.stringify(sessions));
    } catch (e) {}
  }

  private getCurrentSession(): ChatSession {
    const sessions = this.getSessions();
    const userEmail = this.getCurrentUserEmail();
    const userName = this.safeGetItem('userName') || (userEmail ? userEmail.split('@')[0] : 'Khách vãng lai');

    if (!sessions[this.currentSessionId]) {
      sessions[this.currentSessionId] = {
        sessionId: this.currentSessionId,
        userName,
        userEmail,
        status: 'ai',
        lastMessageTime: Date.now(),
        unreadCount: 0,
        messages: []
      };
      this.saveSessions(sessions);
    } else if (userEmail && (!sessions[this.currentSessionId].userEmail || sessions[this.currentSessionId].userEmail === 'guest')) {
      sessions[this.currentSessionId].userEmail = userEmail;
      sessions[this.currentSessionId].userName = userName;
      this.saveSessions(sessions);
    }
    return sessions[this.currentSessionId];
  }

  loadChatHistory(): void {
    const session = this.getCurrentSession();
    if (session.messages && session.messages.length > 0) {
      this.messages = [...session.messages];
      this.updateHeaderStatus(session.status);
    } else {
      this.pendingBotReplies += 1;
      this.isTyping = true;
      this.getWelcomeReply().pipe(
        finalize(() => {
          this.pendingBotReplies = Math.max(0, this.pendingBotReplies - 1);
          this.isTyping = this.pendingBotReplies > 0;
          this.cdr.detectChanges();
        }),
      ).subscribe({
        next: (reply) => {
          const currentSession = this.getCurrentSession();
          if (currentSession.messages.length === 0) {
            currentSession.messages.push({
              ...reply,
              timestamp: Date.now(),
              sender: 'bot',
            });
            currentSession.lastMessageTime = Date.now();
            const sessions = this.getSessions();
            sessions[currentSession.sessionId] = currentSession;
            this.saveSessions(sessions);
          }
          this.messages = [...currentSession.messages];
          this.updateHeaderStatus(currentSession.status);
          this.cdr.detectChanges();
          this.scrollToBottom();
        },
        error: (error: unknown) => {
          console.error('Lỗi tải lời chào chatbot:', error);
          this.messages = [{
            text: 'Không thể kết nối trợ lý lúc này. Bạn vui lòng thử lại sau nhé.',
            sender: 'bot',
            timestamp: Date.now(),
          }];
          this.cdr.detectChanges();
        },
      });
    }
    this.cdr.detectChanges();
  }

  updateHeaderStatus(status: string): void {
    if (status === 'ai') {
      this.botName = 'Trợ lý ảo Urii';
      this.botStatus = 'Đang trực tuyến';
      this.statusDotColor = true;
    } else if (status === 'waiting') {
      this.botName = 'Trợ lý ảo Urii';
      this.botStatus = 'Đang kết nối nhân viên...';
      this.statusDotColor = false;
    } else if (status === 'active') {
      this.botName = 'Nhân viên tư vấn';
      this.botStatus = 'Nhân viên đang hỗ trợ';
      this.statusDotColor = false;
    }
  }

  syncChatUI(): void {
    const session = this.getCurrentSession();
    if (session && session.messages && session.messages.length !== this.messages.length) {
      this.messages = [...session.messages];
      this.cdr.detectChanges();
    }
  }

  sendMessage(inputEl?: HTMLInputElement): void {
    const raw = inputEl ? inputEl.value : this.userMessageText;
    const text = (raw || this.userMessageText || '').trim();
    if (!text) return;

    this.userMessageText = '';
    if (inputEl) inputEl.value = '';
    const domEl = document.getElementById('chat-input') as HTMLInputElement;
    if (domEl) domEl.value = '';

    setTimeout(() => {
      this.userMessageText = '';
      if (inputEl) inputEl.value = '';
      const el = document.getElementById('chat-input') as HTMLInputElement;
      if (el) el.value = '';
      this.cdr.detectChanges();
    }, 0);
    const session = this.getCurrentSession();

    const userMsg: ChatMessage = {
      text: text,
      sender: 'user',
      timestamp: Date.now()
    };
    session.messages.push(userMsg);
    session.lastMessageTime = Date.now();

    if (session.status === 'active' || session.status === 'waiting') {
      session.unreadCount = (session.unreadCount || 0) + 1;
    }

    const sessions = this.getSessions();
    sessions[session.sessionId] = session;
    this.saveSessions(sessions);

    this.messages = [...session.messages];
    this.cdr.detectChanges(); 
    this.scrollToBottom();

    const normQuery = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
    if (['admin', 'tu van vien', 'gap nguoi', 'nhan vien', 'chat voi admin'].some(kw => normQuery.includes(kw)) && session.status === 'ai') {
      this.connectWithAdmin();
      return;
    }

    if (session.status === 'ai') {
      this.requestBotReply(text, session.sessionId);
    }
  }

  private requestBotReply(text: string, sessionId: string): void {
    this.pendingBotReplies += 1;
    this.isTyping = true;
    this.cdr.detectChanges();
    this.scrollToBottom();

    this.getBotReply(text).pipe(
      finalize(() => {
        this.pendingBotReplies = Math.max(0, this.pendingBotReplies - 1);
        this.isTyping = this.pendingBotReplies > 0;
        this.cdr.detectChanges();
      }),
    ).subscribe({
      next: (reply) => this.appendBotReply(reply, sessionId),
      error: (error: unknown) => {
        console.error('Lỗi tạo phản hồi chatbot:', error);
        this.appendBotReply({
          text: 'Xin lỗi, Urii chưa thể phản hồi lúc này. Bạn vui lòng thử lại sau nhé.',
        }, sessionId);
      },
    });
  }

  private appendBotReply(reply: ChatbotReply, sessionId: string): void {
    const currentSessions = this.getSessions();
    const freshSession = currentSessions[sessionId];
    if (!freshSession) return;

    freshSession.messages.push({
      text: reply.text,
      sender: 'bot',
      timestamp: Date.now(),
      chips: reply.chips,
      targetUrl: reply.targetUrl,
      targetLabel: reply.targetLabel,
    });
    freshSession.lastMessageTime = Date.now();
    currentSessions[sessionId] = freshSession;
    this.saveSessions(currentSessions);

    if (sessionId === this.currentSessionId) {
      this.messages = [...freshSession.messages];
      this.cdr.detectChanges();
      this.scrollToBottom();
    }
  }

  private getBotReply(userMessage: string): Observable<ChatbotReply> {
    const history = this.messages.slice(-6).map((m) => ({
      text: m.text,
      sender: m.sender,
    }));

    const context = {
      currentUrl: this.router.url,
      isLoggedIn: this.isUserLoggedIn(),
      userEmail: this.getCurrentUserEmail(),
    };

    return this.http.post<{
      success: boolean;
      reply: string;
      targetUrl?: string;
      targetLabel?: string;
      chips?: { label: string; action: string }[];
    }>('/api/chat/ai', {
      message: userMessage,
      history,
      context,
      sessionId: this.currentSessionId,
    }).pipe(
      map((res) => ({
        text: res.reply,
        targetUrl: res.targetUrl || undefined,
        targetLabel: res.targetLabel || undefined,
        chips: res.chips && res.chips.length > 0 ? res.chips : undefined,
      })),
      catchError((err) => {
        console.warn('Lỗi gọi API AI Chatbot, chuyển sang tìm kiếm FAQ dự phòng:', err);
        return this.getFaqs().pipe(
          map((response) => this.findFaqReply(response, userMessage)),
          delay(500),
        );
      }),
    );
  }

  private getWelcomeReply(): Observable<ChatbotReply> {
    return this.getFaqs().pipe(
      map((response) => {
        const greeting = this.toFaqs(response)
          .map((faq) => this.parseFaq(faq))
          .find((faq) => faq?.intent === 'greeting');
        return greeting
          ? { text: greeting.response, chips: greeting.quickReplies }
          : { text: 'Xin chào! Urii chưa có lời chào khả dụng. Bạn có thể nhập câu hỏi để mình tìm trong danh sách trợ giúp nhé.' };
      }),
      delay(1000),
    );
  }

  private getFaqs(): Observable<unknown> {
    return this.http.get<unknown>('/api/chatbot/faqs');
  }

  private findFaqReply(response: unknown, userMessage: string): ChatbotReply {
    const normalizedMessage = this.normalizeText(userMessage);
    const paddedMessage = ` ${normalizedMessage} `;
    let bestMatch: { faq: ChatbotFaq; score: number } | undefined;

    for (const record of this.toFaqs(response)) {
      const faq = this.parseFaq(record);
      if (!faq) continue;

      const matchedKeyword = faq.keywords
        .map((keyword) => this.normalizeText(keyword))
        .filter((keyword) => keyword && paddedMessage.includes(` ${keyword} `))
        .sort((first, second) => second.length - first.length)[0];
      if (matchedKeyword && (!bestMatch || matchedKeyword.length > bestMatch.score)) {
        bestMatch = { faq, score: matchedKeyword.length };
      }
    }

    if (bestMatch) {
      return {
        text: bestMatch.faq.response,
        chips: bestMatch.faq.quickReplies.length ? bestMatch.faq.quickReplies : undefined,
      };
    }

    const fallbackChips = this.toFaqs(response)
      .map((record) => this.parseFaq(record)?.quickReplies ?? [])
      .find((chips) => chips.length > 0);
    return {
      text: 'Dạ Urii chưa tìm thấy thông tin phù hợp. Bạn thử hỏi cách khác hoặc chọn một gợi ý bên dưới nhé.',
      chips: fallbackChips,
    };
  }

  private toFaqs(response: unknown): unknown[] {
    if (Array.isArray(response)) return response;
    return this.isRecord(response) && Array.isArray(response['faqs'])
      ? response['faqs']
      : [];
  }

  private parseFaq(value: unknown): ChatbotFaq | null {
    if (!this.isRecord(value) || typeof value['response'] !== 'string') return null;

    const keywords = Array.isArray(value['keywords'])
      ? value['keywords'].filter((keyword): keyword is string => typeof keyword === 'string')
      : [];
    const quickReplies = Array.isArray(value['quickReplies'])
      ? value['quickReplies'].flatMap((item): { label: string; action: string }[] => {
          if (typeof item === 'string' && item.trim()) {
            const text = item.trim();
            return [{ label: text, action: text }];
          }
          if (!this.isRecord(item)) return [];
          const label = this.toText(item['label'] ?? item['text'] ?? item['title'] ?? item['question']);
          const action = this.toText(item['action'] ?? item['value']) || label;
          return label ? [{ label, action }] : [];
        })
      : [];

    return {
      intent: this.normalizeText(this.toText(value['intent'])),
      keywords,
      response: value['response'],
      quickReplies,
    };
  }

  private normalizeText(value: string): string {
    return value
      .toLocaleLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private toText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  navigateToAction(url: string | undefined): void {
    if (!url) return;
    this.router.navigateByUrl(url);
  }

  
  connectWithAdmin(): void {
    const session = this.getCurrentSession();
    const userMsg: ChatMessage = {
      text: 'Yêu cầu liên hệ chat với Admin',
      sender: 'user',
      timestamp: Date.now()
    };
    session.messages.push(userMsg);
    session.status = 'waiting';
    session.unreadCount = (session.unreadCount || 0) + 1;
    session.lastMessageTime = Date.now();

    const botNotice: ChatMessage = {
      text: 'Dạ Urii đã gửi thông báo đến Quản trị viên/Admin rồi ạ! 🔔 Quản trị viên đã nhận được yêu cầu và sẽ phản hồi lại ngay cho bạn tại khung chat này. Bạn vui lòng đợi trong giây lát nhé! ✨',
      sender: 'bot',
      timestamp: Date.now() + 300,
      chips: [{ label: 'Hủy yêu cầu (Chat tiếp với AI)', action: 'Hủy yêu cầu' }]
    };
    session.messages.push(botNotice);

    const sessions = this.getSessions();
    sessions[session.sessionId] = session;
    this.saveSessions(sessions);

    this.messages = [...session.messages];
    this.updateHeaderStatus('waiting');
    this.cdr.detectChanges();
    this.scrollToBottom();

    // Gửi yêu cầu lên backend tạo notification cho Admin
    this.http.post('/api/chat/request-agent', {
      sessionId: session.sessionId,
      userName: session.userName,
      userEmail: session.userEmail,
      message: 'Khách hàng yêu cầu nhân viên tư vấn/admin hỗ trợ trực tiếp.'
    }).subscribe({
      next: () => console.log('Đã gửi thông báo cho admin'),
      error: (err) => console.warn('Lỗi gửi thông báo admin:', err)
    });
  }

  handleChipClick(action: string): void {
    if (!action) return;

    if (action.startsWith('/')) {
      this.router.navigateByUrl(action);
      return;
    }

    if (action === 'Yêu cầu đặt hàng' || action === 'Đặt hàng yêu cầu') {
      this.router.navigate(['/custom-order-request']);
      return;
    }

    if (['Tư vấn từ nhân viên', 'Gặp tư vấn viên', 'Tư vấn viên', 'Chat với Admin', 'Liên hệ Admin'].includes(action)) {
      this.connectWithAdmin();
      return;
    }

    this.userMessageText = action;
    this.sendMessage();
  }

  private scrollToBottom(): void {
    try {
      setTimeout(() => {
        const chatBody = document.getElementById('chat-body');
        if (chatBody) {
          chatBody.scrollTop = chatBody.scrollHeight;
        }
      }, 50);
    } catch (e) {}
  }

  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
}