// tests/test_briefing_bot_credit.py: the briefing's COMMENTS line for a level whose bot layer was generated.
import { commentsWithBotCredit, GENERATED_BOTS_CREDIT } from '../viewer/briefing-screen.js';

const generated = { generated: { generator: 'botgen', version: 5 } };
console.log(JSON.stringify({
  credit: GENERATED_BOTS_CREDIT,
  generated: commentsWithBotCredit('', generated),
  noComments: commentsWithBotCredit(undefined, generated),
  withWords: commentsWithBotCredit('  Hold the ridge.  ', generated),
  shipped: commentsWithBotCredit('Hold the ridge.', { strategies: [] }),
  shippedEmpty: commentsWithBotCredit(null, { strategies: [] }),
  noAi: commentsWithBotCredit('', null),
}));
