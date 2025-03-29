const { chromium } = require('playwright');

(async () => {
  // 启动浏览器
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 访问成都限号网站（请根据实际情况填写网址）
  await page.goto('http://www.chengdu.gov.cn/'); // 替换为实际的网址

  // 等待页面加载
  await page.waitForTimeout(3000);

  // 查找限号信息（请根据实际情况修改选择器）
  await page.click('selector-for-limit-info'); // 替换为访问限号信息的按钮或链接的选择器

  // 等待限号信息加载
  await page.waitForSelector('selector-for-limit-info-display'); // 替换为显示限号信息的选择器

  // 获取限号信息
  const limitInfo = await page.textContent('selector-for-limit-info-display'); // 替换为实际的选择器

  // 打印限号信息
  console.log('今天成都限号情况:', limitInfo);

  // 关闭浏览器
  await browser.close();
})();