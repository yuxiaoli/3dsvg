import { test, expect } from '@playwright/test';

// Read the renderer's preserved drawing buffer, not the DOM overlay. Comparing
// against an empty SVG prevents a background-only canvas from passing.
async function readFrame(canvas) {
  return canvas.evaluate((element) => {
    const gl = element.getContext('webgl2') || element.getContext('webgl');
    if (!gl || gl.isContextLost()) throw new Error('A live WebGL context is required');
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    if (!width || !height) throw new Error('The WebGL drawing buffer is empty');
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const sample = [];
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const offset = (Math.floor((y + 0.5) * height / 64) * width
          + Math.floor((x + 0.5) * width / 64)) * 4;
        sample.push(...pixels.subarray(offset, offset + 4));
      }
    }
    return sample;
  });
}

function changedPixels(before, after) {
  let changed = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (Math.max(...[0, 1, 2, 3].map((channel) =>
      Math.abs(before[i + channel] - after[i + channel]))) > 8) changed++;
  }
  return changed;
}

async function stableFrame(canvas) {
  let previous = await readFrame(canvas);
  let stable = 0;
  await expect.poll(async () => {
    const current = await readFrame(canvas);
    stable = changedPixels(previous, current) <= 2 ? stable + 1 : 0;
    previous = current;
    return stable;
  }, { message: 'The scene should settle with animation disabled', intervals: [500] }).toBeGreaterThanOrEqual(3);
  return previous;
}

test('built-in SVG renders, extrudes and rotates on the Pages export', async ({ page }, testInfo) => {
  const errors = [];
  const failedAssets = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /WebGL|THREE\.|shader|context lost/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on('response', (response) => {
    if (response.url().startsWith('http://127.0.0.1:4173/3dsvg/_next/') && !response.ok()) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto('./', { waitUntil: 'domcontentloaded' });
  // These icon selectors correspond to the existing Code and Settings2 toolbar
  // buttons, which currently have tooltip text but no accessible labels.
  const codeButton = page.locator('button:has(svg.lucide-code)');
  await codeButton.click();
  const editor = page.locator('textarea').filter({ visible: true });
  await editor.fill('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>');
  await page.locator('button:has(svg.lucide-settings-2)').click();
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  const animation = page.locator('select').filter({ has: page.locator('option[value="none"]') });
  await animation.selectOption('none');
  await expect(animation).toHaveValue('none');

  const canvas = page.locator('canvas[data-engine]');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveCSS('opacity', '1');
  const empty = await stableFrame(canvas);
  const webgl = await canvas.evaluate((element) => {
    const gl = element.getContext('webgl2') || element.getContext('webgl');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { version: gl.getParameter(gl.VERSION), renderer: debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  });
  console.log('WebGL renderer:', JSON.stringify(webgl));

  await codeButton.click();
  await editor.fill('');
  await page.getByRole('button', { name: 'Load example (star)', exact: true }).click();
  await expect(editor).toHaveValue(/<path/);
  await expect.poll(async () => changedPixels(empty, await readFrame(canvas)),
    { message: 'The built-in star must visibly render above the empty scene' }).toBeGreaterThan(100);
  const star = await stableFrame(canvas);
  expect(changedPixels(empty, star)).toBeGreaterThan(100);
  await page.screenshot({ path: testInfo.outputPath('star.png') });

  await page.getByRole('button', { name: 'Object', exact: true }).click();
  const depth = page.getByText('Depth', { exact: true }).locator('../..').getByRole('slider');
  await expect(depth).toHaveAttribute('aria-valuenow', '1');
  await depth.focus();
  await depth.press('End');
  await expect(depth).toHaveAttribute('aria-valuenow', '10');
  await expect.poll(async () => changedPixels(star, await readFrame(canvas)),
    { message: 'Changing extrusion depth must change the rendered object' }).toBeGreaterThan(50);
  const extruded = await stableFrame(canvas);
  expect(changedPixels(star, extruded)).toBeGreaterThan(50);

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 110, start.y + 45, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => changedPixels(extruded, await readFrame(canvas)),
    { message: 'Dragging the canvas must rotate the rendered object' }).toBeGreaterThan(50);
  const rotated = await stableFrame(canvas);
  expect(changedPixels(extruded, rotated)).toBeGreaterThan(50);
  await page.screenshot({ path: testInfo.outputPath('extruded-and-rotated.png') });

  expect(failedAssets, 'All local Next.js assets must load').toEqual([]);
  expect(errors, 'No fatal application or WebGL errors').toEqual([]);
  console.log('Pages smoke passed:', JSON.stringify({ ...webgl,
    starPixels: changedPixels(empty, star),
    extrusionPixels: changedPixels(star, extruded),
    rotationPixels: changedPixels(extruded, rotated) }));
});
