import { HttpClient } from '@angular/common/http';
import { Component, OnInit, AfterViewInit, OnDestroy, Inject, PLATFORM_ID, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { delay, finalize, map, Observable } from 'rxjs';

interface ChatMessage {
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
    if (!sessions[this.currentSessionId]) {
      sessions[this.currentSessionId] = {
        sessionId: this.currentSessionId,
        userName: this.safeGetItem('userName') || 'Khách vãng lai',
        userEmail: this.safeGetItem('userEmail') || '',
        status: 'ai',
        lastMessageTime: Date.now(),
        unreadCount: 0,
        messages: []
      };
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

  sendMessage(): void {
    const text = this.userMessageText.trim();
    if (!text) return;

    this.userMessageText = '';
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
    return this.getFaqs().pipe(
      map((response) => this.findFaqReply(response, userMessage)),
      delay(1000),
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

  handleChipClick(action: string): void {
    if (action === 'Yêu cầu đặt hàng' || action === 'Đặt hàng yêu cầu') {
      this.router.navigate(['/custom-order-request']);
      return;
    }

    if (['Tư vấn từ nhân viên', 'Gặp tư vấn viên', 'Tư vấn viên'].includes(action)) {
      const session = this.getCurrentSession();
      const userMsg: ChatMessage = {
        text: 'Tư vấn từ nhân viên',
        sender: 'user',
        timestamp: Date.now()
      };
      session.messages.push(userMsg);
      session.status = 'waiting';
      session.unreadCount = (session.unreadCount || 0) + 1;

      const sessions = this.getSessions();
      sessions[session.sessionId] = session;
      this.saveSessions(sessions);

      this.messages = [...session.messages];
      this.updateHeaderStatus('waiting');
      this.cdr.detectChanges();
      this.scrollToBottom();
      this.requestBotReply(action, session.sessionId);
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