import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no 2D canvas and logs an error whenever Pixi probes for one. Scene tests never
// render, so an absent context is all they need.
if (typeof HTMLCanvasElement !== 'undefined') HTMLCanvasElement.prototype.getContext = () => null;

afterEach(() => {
  cleanup();
});
