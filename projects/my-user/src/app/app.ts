import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ChatbotWidgetComponent } from './layout/chatbot-widget/chatbot-widget';
import { HeaderComponent } from './layout/header.component/header.component';
import { FooterComponent } from './layout/footer.component/footer.component';
import { ToastNotifications } from './layout/toast-notifications/toast-notifications';
import { GlobalDialogComponent } from './layout/global-dialog/global-dialog';

@Component({
  imports: [RouterOutlet, ChatbotWidgetComponent, HeaderComponent, FooterComponent, ToastNotifications, GlobalDialogComponent],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('my-user');
}
