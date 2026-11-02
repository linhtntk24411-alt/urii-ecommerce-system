import { Component, OnInit, AfterViewInit, OnDestroy, Inject, PLATFORM_ID, ChangeDetectorRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

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
  statusDotColor: boolean = true; // true: xanh (AI), false: vàng/đỏ (Nhân viên)
  
  messages: ChatMessage[] = [];
  emojis: string[] = ['😊', '😂', '🥰', '👍', '🔥', '❤️', '✨', '⭐', '😭', '😮'];
  
  private currentSessionId: string = '';
  private memoryStorage: { [key: string]: string } = {};
  private syncInterval: any;

  constructor(
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object,
    private cdr: ChangeDetectorRef // Inject ChangeDetectorRef để ép Angular render giao diện tức thì
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

  // Toggle mở/đóng cửa sổ chat
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

  // --- QUẢN LÝ SESSION & LOCALSTORAGE AN TOÀN SSR ---
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
      const welcome: ChatMessage = {
        text: "Xin chào, Urii có thể giúp gì cho bạn?",
        chips: [
          { label: 'Xem giá bộ Kit', action: 'Xem giá bộ Kit' },
          { label: 'Màu sắc có sẵn', action: 'Màu sắc có sẵn' }
        ],
        timestamp: Date.now(),
        sender: 'bot'
      };
      session.messages.push(welcome);
      const sessions = this.getSessions();
      sessions[session.sessionId] = session;
      this.saveSessions(sessions);

      this.messages = [...session.messages];
      this.updateHeaderStatus('ai');
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
      const reply = this.getFallbackReply(text);

      const botMsg: ChatMessage = {
        text: typeof reply === 'string' ? reply : (reply.text || ''),
        sender: 'bot',
        timestamp: Date.now(),
        chips: typeof reply === 'object' ? reply.chips : undefined
      };

      const currentSessions = this.getSessions();
      const freshSession = currentSessions[session.sessionId] || session;
      freshSession.messages.push(botMsg);
      freshSession.lastMessageTime = Date.now();
      currentSessions[freshSession.sessionId] = freshSession;
      this.saveSessions(currentSessions);

      this.messages = [...freshSession.messages];
      this.cdr.detectChanges(); 
      this.scrollToBottom();
    }
  }

  handleChipClick(action: string): void {
    if (action === 'Yêu cầu đặt hàng' || action === 'Đặt hàng yêu cầu') {
      this.router.navigate(['/custom-order-request']);
      return;
    }

    if (action === 'Tư vấn từ nhân viên') {
      const session = this.getCurrentSession();
      const userMsg: ChatMessage = {
        text: 'Tư vấn từ nhân viên',
        sender: 'user',
        timestamp: Date.now()
      };
      session.messages.push(userMsg);
      session.status = 'waiting';
      session.unreadCount = (session.unreadCount || 0) + 1;

      const botMsg: ChatMessage = {
        text: 'Dạ, Urii đã gửi yêu cầu hỗ trợ đến nhân viên tư vấn. Bạn vui lòng đợi một chút nhé, nhân viên sẽ phản hồi bạn ngay ạ! ✨',
        sender: 'bot',
        timestamp: Date.now()
      };
      session.messages.push(botMsg);

      const sessions = this.getSessions();
      sessions[session.sessionId] = session;
      this.saveSessions(sessions);

      this.messages = [...session.messages];
      this.updateHeaderStatus('waiting');
      this.cdr.detectChanges();
      this.scrollToBottom();
      return;
    }

    this.userMessageText = action;
    this.sendMessage();
  }

  private getFallbackReply(userMessage: string): any {
    const text = this.normalizeText(userMessage);
    if (this.containsAny(text, ['hi', 'hello', 'shop oi', 'ad oi', 'xin chao', 'cho hoi'])) {
      return 'Dạ Urii xin chào bạn! Chúc bạn một ngày mới nhiều niềm vui. Bạn cần Urii hỗ trợ thông tin gì về bộ Kit hạt ủi sáng tạo ạ? ✨';
    }
    if (this.containsAny(text, ['mau', 'color', 'sac', 'bao nhieu mau'])) {
      return 'Bộ Kit Standard 24 màu bao gồm:\n\n🔴 Đỏ, 🟠 Cam, 🟡 Vàng\n🟢 Xanh Lá, 🔵 Xanh Dương\n💜 Tím, 🩶 Xám, ⚫ Đen\n⚪ Trắng, 🩷 Hồng, 🟤 Nâu\n\n+ Các màu pastel nhạt: Hồng nhạt, Xanh nhạt, Vàng nhạt...\n\nMỗi màu có số lượng hạt đủ để tạo nhiều tác phẩm đẹp!';
    }
    if (this.containsAny(text, ['gia', 'bao nhieu tien', 'price', 'tien'])) {
      return 'Dạ hiện tại bên Urii có sẵn đầy đủ 24 màu hạt nhựa lẻ cho bạn thoải mái lựa chọn ạ. Tất cả các màu đều đồng giá như nhau:\n\n🛍️ Giá gói hạt nhựa lẻ: 35.000đ/gói (Mỗi gói có khoảng 500 hạt)\n\nNgoài ra bên mình còn có các phụ kiện bán rời nếu bạn cần mua thêm:\n- Bảng khuôn nhựa lẻ (15x15cm): 50.000đ/cái\n- Nhíp sắt chuyên dụng: 25.000đ/cái\n- Giấy ủi chịu nhiệt: 10.000đ/xấp (5 tờ)\n\n🎁 Đặc biệt: Khi bạn đặt mua nhiều gói hạt hoặc mua combo kèm phụ kiện, Urii sẽ TẶNG KÈM thêm giấy ủi miễn phí cho mình nha!\n\nBạn muốn lấy những màu nào hoặc cần mua thêm phụ kiện gì không, nhắn em lên đơn cho mình liền nhé! ✨';
    }
    if (this.containsAny(text, ['dat', 'mua', 'order'])) {
      return 'Bạn có thể đặt hàng trực tiếp trên hệ thống hoặc gửi yêu cầu thiết kế riêng qua tính năng Custom Order của Urii nhé!';
    }
    return {
      text: 'Dạ hiện tại em chưa hiểu rõ ý của bạn lắm ạ. 🥺\n\nNếu bạn cần hỗ trợ từ nhân viên, hãy bấm nút dưới đây để gửi yêu cầu nhanh nha!',
      chips: [
        { label: '🛒 Gửi Yêu Cầu Đặt Hàng', action: 'Yêu cầu đặt hàng' },
        { label: '🧑‍💻 Tư vấn từ nhân viên', action: 'Tư vấn từ nhân viên' }
      ]
    };
  }

  private normalizeText(value: string): string {
    return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  }

  private containsAny(text: string, keywords: string[]): boolean {
    return keywords.some(keyword => text.includes(keyword));
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