#!/usr/bin/env node
import { render } from 'ink';
import { SnakeGame } from './src/SnakeGame.js';

const app = render(
  <SnakeGame
    onExit={() => {
      app.unmount();
      process.exit(0);
    }}
  />,
);
