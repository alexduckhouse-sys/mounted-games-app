import { act } from '@testing-library/react';
import { afterEach, vi, type Mock } from 'vitest';

type Asked = Mock<(message: string) => void> & { stop: () => void; titles: string[] };

const running = new Set<Asked>();
afterEach(() => { for (const item of [...running]) item.stop(); });

/**
 * Answers every ConfirmDialog that opens, through its real buttons, and records the message of each one (titles are in `titles`). Calling it again replaces the previous answerer.
 * Pass `true` to confirm each, `false` to cancel each, or a list of answers used in turn. It stops after the test.
 */
export function autoConfirm(answers: boolean | boolean[] = true): Asked {
  for (const item of [...running]) item.stop();
  const asked = vi.fn<(message: string) => void>() as Asked;
  asked.titles = [];
  const queue = Array.isArray(answers) ? [...answers] : null;
  const seen = new WeakSet<Element>();
  const observer = new MutationObserver(() => {
    for (const dialog of document.querySelectorAll('[role="alertdialog"]')) {
      if (seen.has(dialog)) continue;
      seen.add(dialog);
      const yes = queue ? queue.shift() ?? true : answers === true;
      asked.titles.push(dialog.querySelector('h2')?.textContent ?? '');
      asked(dialog.querySelector('.mg-confirm-body')?.textContent ?? '');
      const buttons = dialog.querySelectorAll('button');
      const button = yes ? buttons[buttons.length - 1] : buttons[0];
      void act(async () => { button.click(); });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  asked.stop = () => { observer.disconnect(); running.delete(asked); };
  running.add(asked);
  return asked;
}
