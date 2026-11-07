import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withRouterConfig } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import localeVi from '@angular/common/locales/vi';

registerLocaleData(localeVi, 'vi-VN');

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    provideRouter(
      routes, 
      withRouterConfig({ onSameUrlNavigation: 'reload' }) 
    ),
    provideClientHydration(),
  ],
};