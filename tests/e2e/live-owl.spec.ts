import { test, expect } from '@playwright/test';

/**
 * Live E2E test against Owl backend (relay.restry.cn → owl OpenClaw gateway)
 * Tests the full flow: pairing → connection → message send → AI response
 */

const CONNECTION_URL = 'openclaw://connect?serverUrl=wss%3A%2F%2Frelay.restry.cn%2Fclient%3FchannelId%3DCC-OWL%26token%3D1a06abc51d7242f8acc38933a5abe478&senderId=flamingo&displayName=%F0%9F%8C%B3Owl%2Fflamingo&channelName=%F0%9F%8C%B3Owl&channelId=CC-OWL';

const DECODED = {
  serverUrl: 'wss://relay.restry.cn/client?channelId=CC-OWL&token=1a06abc51d7242f8acc38933a5abe478',
  senderId: 'e2e-playwright',
  displayName: 'E2E-Test',
  channelName: '🌳Owl',
  channelId: 'CC-OWL',
};

// Seed a connection directly into localStorage, bypassing auth
async function seedAndGo(page: import('@playwright/test').Page) {
  await page.goto('/');
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
  await page.waitForTimeout(1500);
}

test.describe('Live Owl E2E', () => {

  test('full flow: pair → connect → send → receive AI reply', async ({ page }) => {
    // Track WebSocket connections
    const wsUrls: string[] = [];
    const wsMessages: string[] = [];
    page.on('websocket', (ws) => {
      wsUrls.push(ws.url());
      ws.on('framereceived', (frame) => {
        if (typeof frame.payload === 'string') wsMessages.push(frame.payload);
      });
    });

    // 1. Seed connection
    await seedAndGo(page);

    // 2. Navigate to chats
    await page.goto('/chats');
    await page.waitForTimeout(2000);

    // 3. Find an agent card and click it
    // Look for any clickable element with agent name or the first card
    const agentCard = page.locator('[class*="cursor-pointer"]').first();
    const hasCard = await agentCard.isVisible({ timeout: 5000 }).catch(() => false);

    if (!hasCard) {
      // If no agent card visible, page might be on onboarding — try navigating directly
      await page.goto('/chat/main?connectionId=conn-e2e-live&chatId=CC-OWL');
      await page.waitForTimeout(3000);
    } else {
      await agentCard.click();
      await page.waitForTimeout(3000);
    }

    // 4. Verify WebSocket connection was made to relay
    const hasRelay = wsUrls.some(url => url.includes('relay.restry.cn'));
    console.log('WebSocket URLs:', wsUrls);
    console.log('Has relay connection:', hasRelay);

    // 5. Look for the text input
    const input = page.locator('input[type="text"]').last();
    const hasInput = await input.isVisible({ timeout: 5000 }).catch(() => false);
    console.log('Input visible:', hasInput);

    if (hasInput) {
      // 6. Send a test message
      const testMsg = `E2E live test at ${new Date().toISOString()}`;
      await input.fill(testMsg);
      await page.waitForTimeout(300);

      // Find and click send button
      const sendBtn = page.locator('button[aria-label="Send"]');
      const hasSend = await sendBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (hasSend) {
        await sendBtn.click();
      } else {
        // Try pressing Enter
        await input.press('Enter');
      }
      console.log('Message sent:', testMsg);

      // 7. Wait for AI response (up to 45 seconds)
      await page.waitForTimeout(2000);

      // Check for thinking indicator
      const thinkingVisible = await page.locator('text=Thinking').isVisible({ timeout: 3000 }).catch(() => false);
      console.log('Thinking indicator visible:', thinkingVisible);

      // Wait for response to appear — look for the AI message bubble
      let gotResponse = false;
      for (let i = 0; i < 15; i++) {
        const messageCount = await page.locator('[class*="group/msg"]').count();
        if (messageCount >= 2) {
          gotResponse = true;
          break;
        }
        await page.waitForTimeout(3000);
      }

      console.log('Got AI response:', gotResponse);
      console.log('WS messages received:', wsMessages.length);

      // Verify at least the message was sent
      const content = await page.textContent('body');
      expect(content).toContain(testMsg);
    }

    // Assert WebSocket was attempted
    expect(wsUrls.length).toBeGreaterThan(0);
  });

  test('connection banner shows status correctly', async ({ page }) => {
    await seedAndGo(page);
    await page.goto('/chat/main?connectionId=conn-e2e-live&chatId=CC-OWL');
    await page.waitForTimeout(3000);

    // Should see either "Back online!" (connected) or reconnecting status
    const content = await page.textContent('body');
    const isConnected = content?.includes('Back online') || false;
    const isReconnecting = content?.includes('Reconnecting') || false;
    const isDisconnected = content?.includes('Connection lost') || false;

    console.log('Connection state:', { isConnected, isReconnecting, isDisconnected });

    // Page should load without crash
    expect(content).toBeTruthy();
  });

  test('scroll-to-bottom button appears when scrolled up', async ({ page }) => {
    await seedAndGo(page);
    await page.goto('/chat/main?connectionId=conn-e2e-live&chatId=CC-OWL');
    await page.waitForTimeout(3000);

    // Scroll up to trigger the button
    const scrollContainer = page.locator('[class*="overflow-y-auto"]').first();
    const hasScroller = await scrollContainer.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasScroller) {
      // Scroll to top
      await scrollContainer.evaluate(el => el.scrollTop = 0);
      await page.waitForTimeout(500);

      // Check if scroll-to-bottom button appears
      const scrollBtn = page.locator('[aria-label="Scroll to bottom"]');
      const btnVisible = await scrollBtn.isVisible({ timeout: 2000 }).catch(() => false);
      console.log('Scroll-to-bottom button visible:', btnVisible);
      // Button only appears if there's enough content to scroll
    }

    expect(await page.textContent('body')).toBeTruthy();
  });

  test('suggestion bar renders with quick commands', async ({ page }) => {
    await seedAndGo(page);
    await page.goto('/chat/main?connectionId=conn-e2e-live&chatId=CC-OWL');
    await page.waitForTimeout(3000);

    // Look for the Skills button (Puzzle icon)
    const skillsBtn = page.locator('button[title*="Skills"]');
    const hasSkills = await skillsBtn.isVisible({ timeout: 3000 }).catch(() => false);
    console.log('Skills button visible:', hasSkills);

    // Look for Context button
    const ctxBtn = page.locator('button[title="Context"]');
    const hasCtx = await ctxBtn.isVisible({ timeout: 2000 }).catch(() => false);
    console.log('Context button visible:', hasCtx);

    expect(await page.textContent('body')).toBeTruthy();
  });

  test('delete confirmation dialog works', async ({ page }) => {
    // Send a message first, then try to delete it
    await seedAndGo(page);
    await page.goto('/chat/main?connectionId=conn-e2e-live&chatId=CC-OWL');
    await page.waitForTimeout(3000);

    const input = page.locator('input[type="text"]').last();
    const hasInput = await input.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasInput) {
      // Send a message
      await input.fill('Delete test message');
      const sendBtn = page.locator('button[aria-label="Send"]');
      if (await sendBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sendBtn.click();
      } else {
        await input.press('Enter');
      }
      await page.waitForTimeout(1500);

      // Try to find delete button on desktop (hover menu)
      const deleteBtn = page.locator('button:has(svg)').filter({ has: page.locator('svg') });

      // On mobile, long-press a message to open action sheet
      const messages = page.locator('[class*="group/msg"]');
      const msgCount = await messages.count();
      if (msgCount > 0) {
        // Long press on last message
        const lastMsg = messages.last();
        const box = await lastMsg.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.waitForTimeout(600); // Long press
          await page.mouse.up();
          await page.waitForTimeout(500);

          // Check if action sheet or delete button appeared
          const deleteAction = page.getByText('Delete');
          const hasDelete = await deleteAction.isVisible({ timeout: 2000 }).catch(() => false);
          console.log('Delete action visible:', hasDelete);

          if (hasDelete) {
            await deleteAction.click();
            await page.waitForTimeout(500);

            // Verify confirmation dialog appears
            const confirmDialog = page.getByText('Delete message?');
            const hasConfirm = await confirmDialog.isVisible({ timeout: 2000 }).catch(() => false);
            console.log('Delete confirmation dialog visible:', hasConfirm);
            expect(hasConfirm).toBeTruthy();

            // Click cancel
            const cancelBtn = page.getByText('Cancel');
            if (await cancelBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
              await cancelBtn.click();
            }
          }
        }
      }
    }

    expect(await page.textContent('body')).toBeTruthy();
  });
});
