// To-Do on phones and tablets (run by the mobile, small and tablet projects):
// the page fits without sideways scrolling, every control is a 44px target,
// and a folder's + Add works with its icon-only button.

import { test, expect } from './fixtures.mjs';
import { openApp } from './helpers.mjs';

async function openTodos(page) {
  await openApp(page, undefined, { view: null });
  await page.locator('.views [data-view="todos"]').click();
  await expect(page.locator('#page-todos')).toBeVisible();
}

test('To-Do fits the screen: no sideways scroll, 44px controls, + Add works', async ({ page }) => {
  await openTodos(page);
  const form = page.locator('#page-todos .todo-form');
  await form.locator('.todo-group-input').fill('Sinag');
  await form.locator('.todo-note-input').fill('Renew the domain before the 15th');
  await page.locator('#page-todos .todo-form .todo-add').click();
  await expect(page.locator('#page-todos .todo-item')).toHaveCount(1);

  const sinag = page.locator('#page-todos .todo-group[data-group="Sinag"]');
  const add = sinag.locator('.todo-group-add');
  await expect(add).toHaveAccessibleName('Add a note to Sinag');
  await add.click();
  const quick = sinag.locator('.todo-quick .todo-note-input');
  await quick.fill('Check the login page');
  await quick.press('Enter');
  await expect(sinag.locator('.todo-item')).toHaveCount(2);

  const report = await page.evaluate(() => {
    const problems = [];
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > width) problems.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${width}`);
    for (const node of document.querySelectorAll('#page-todos button, #page-todos input:not([type="file"]), #page-todos textarea')) {
      const r = node.getBoundingClientRect();
      if (!r.width) continue; // hidden
      const name = node.getAttribute('aria-label') || node.textContent.trim() || node.className;
      if (r.left < 0 || r.right > width + 0.5) problems.push(`${name} sticks out`);
      if (node.matches('button') && Math.min(r.width, r.height) < 43.5) problems.push(`${name} is only ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    // The round tick is drawn at 24px in a 44px column of its row.
    for (const item of document.querySelectorAll('#page-todos .todo-item:not(.is-editing)')) {
      const column = parseFloat(getComputedStyle(item).gridTemplateColumns);
      if (column < 43.5) problems.push(`the tick column is only ${column}px`);
    }
    return problems;
  });
  expect(report).toEqual([]);

  // The Open / Done / All switch spans the width on phones.
  const tabs = await page.locator('#page-todos .todo-tabs').boundingBox();
  const card = await page.locator('#page-todos .todo-card').boundingBox();
  if (page.viewportSize().width <= 640) expect(tabs.width).toBeGreaterThan(card.width - 4);

  // For design review: this screen size, with the To-Do page on screen.
  await expect(page.locator('#app-loading')).toBeHidden();
  await expect(page.locator('.views [data-view="todos"]')).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: `test-results/design/todos-${test.info().project.name}.png`, fullPage: true });
});
