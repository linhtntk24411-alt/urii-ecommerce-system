import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ChatbotWidgetComponent } from './layout/chatbot-widget/chatbot-widget';
import { HeaderComponent } from './layout/header.component/header.component';
import { FooterComponent } from './layout/footer.component/footer.component';

@Component({
  imports: [RouterOutlet, ChatbotWidgetComponent, HeaderComponent, FooterComponent],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('my-user');
}
