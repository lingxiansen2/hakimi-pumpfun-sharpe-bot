import { runBot } from './vendor/agentfun-bot.ts';
import { createStrategy } from './strategy.ts';

await runBot(createStrategy());
