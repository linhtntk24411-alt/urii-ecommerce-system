import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ChatbotWidgetComponent } from './layout/chatbot-widget/chatbot-widget';
import { FooterComponent } from './layout/footer.component/footer.component';
import { HeaderComponent } from './layout/header.component/header.component';

@Component({
  imports: [RouterOutlet, HeaderComponent, FooterComponent, ChatbotWidgetComponent],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('my-user');
}
