/**
 * Interactive browser test — opens a visible Chromium browser,
 * seeds the connection, and navigates through the app for manual observation.
 *
 * Run: node tests/e2e/browser-test.mjs
 */
import { chromium } from '@playwright/test';

const DECODED = {
  serverUrl: 'wss://relay.restry.cn/client?channelId=CC-OWL&token=1a06abc51d7242f8acc38933a5abe478',
  senderId: 'e2e-playwright',
  displayName: 'E2E-Test',
  channelName: '🌳Owl',
  channelId: 'CC-OWL',
};

async function main() {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 300,
    args: ['--window-size=430,932'],
  });

  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    locale: 'en-US',
  });

  const page = await context.newPage();

  // Track WebSocket
  page.on('websocket', (ws) => {
    console.log('🔌 WS opened:', ws.url());
    ws.on('framereceived', (f) => {
      if (typeof f.payload === 'string' && f.payload.length < 500) {
        try {
          const d = JSON.parse(f.payload);
          console.log('  ⬇️', d.type || 'unknown', d.data?.content?.slice(0, 80) || '');
        } catch { console.log('  ⬇️ frame:', f.payload.slice(0, 100)); }
      }
    });
    ws.on('framesent', (f) => {
      if (typeof f.payload === 'string' && f.payload.length < 500) {
        try {
          const d = JSON.parse(f.payload);
          console.log('  ⬆️', d.type || 'unknown', d.data?.content?.slice(0, 80) || '');
        } catch {}
      }
    });
  });

  console.log('1️⃣  Opening app...');
  await page.goto('http://localhost:4026/');
  await page.waitForTimeout(1500);

  console.log('2️⃣  Seeding connection...');
  await page.evaluate((d) => {
    const conn = {
      id: 'conn-e2e-live',
      name: d.channelName,
      displayName: d.displayName,
      serverUrl: d.serverUrl,
      token: '',
      chatId: d.channelId,
      channelId: d.channelId,
      senderId: d.senderId,
    };
    localStorage.setItem('openclaw.connections', JSON.stringify([conn]));
    localStorage.setItem('openclaw.activeConnectionId', conn.id);
  }, DECODED);

  await page.reload();
  await page.waitForTimeout(2000);

  console.log('3️⃣  Navigating to /chats...');
  await page.goto('http://localhost:4026/chats');
  await page.waitForTimeout(2000);

  // Try to click on first agent
  const agentCard = page.locator('[class*="cursor-pointer"]').first();
  if (await agentCard.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('4️⃣  Clicking agent card...');
    await agentCard.click();
    await page.waitForTimeout(3000);
  } else {
    console.log('4️⃣  No agent card found, navigating directly to chat...');
    await page.goto('http://localhost:4026/chat/main?connectionId=conn-e2e-live&chatId=CC-OWL');
    await page.waitForTimeout(3000);
  }

  // Try to find and use the input
  const input = page.locator('input[type="text"]').last();
  if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('5️⃣  Sending test message...');
    await input.fill('Hello from E2E browser test! 🧪');
    await page.waitForTimeout(500);

    const sendBtn = page.locator('button[aria-label="Send"]');
    if (await sendBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await sendBtn.click();
    } else {
      await input.press('Enter');
    }

    console.log('6️⃣  Waiting for AI response (up to 30s)...');
    await page.waitForTimeout(30000);
  } else {
    console.log('⚠️  No input found — app may be on auth/onboarding page');
    console.log('   Current URL:', page.url());
    console.log('   Page title:', await page.title());

    // Take a screenshot for debugging
    await page.screenshot({ path: '/tmp/clawline-e2e-screenshot.png' });
    console.log('   Screenshot saved to /tmp/clawline-e2e-screenshot.png');
  }

  console.log('\n🎯 Browser will stay open for 60s for manual inspection...');
  console.log('   Press Ctrl+C to close earlier.\n');
  await page.waitForTimeout(60000);

  await browser.close();
}

main().catch(console.error);
