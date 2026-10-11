import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import App from './App';
import { TelemetryProvider } from './app/TelemetryProvider';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* reducedMotion="user": framer-motion drops transform animations when the OS asks for less motion. */}
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <TelemetryProvider>
          <App />
        </TelemetryProvider>
      </BrowserRouter>
    </MotionConfig>
  </StrictMode>,
);
