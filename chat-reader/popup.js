const button = document.getElementById('open');
const status = document.getElementById('status');
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id) throw new Error('No active tab');
    const result = await chrome.tabs.sendMessage(tab.id, {type: 'OPEN_PANEL'});
    status.textContent = result?.ok ? '已打开，请查看页面右下角。' : '请先打开 ChatGPT 网页并刷新一次，再重试。';
  } catch {
    status.textContent = '请先打开 ChatGPT 网页并刷新一次，再重试。';
  } finally {
    button.disabled = false;
  }
});
