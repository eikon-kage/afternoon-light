// Click-through smoke test in demo mode. Usage: npm run dev, then `node scripts/smoke.mjs [url]`.
// Needs Google Chrome installed (puppeteer-core drives it; set CHROME_PATH to override).
import puppeteer from 'puppeteer-core'

const URL_ = (process.argv[2] || 'http://localhost:5173') + '/?demo'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] })
const errors = []
async function fresh(width, height) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.setViewport({ width, height })
  await page.goto(URL_, { waitUntil: 'networkidle0' })
  return page
}
// React-controlled inputs need the native setter + an input event.
const setValue = (page, sel, v) => page.$eval(sel, (el, v) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}, v)
const clickText = (page, sel, text) => page.$$eval(sel, (els, text) => { const el = els.find((e) => e.textContent.trim() === text); el?.click(); return Boolean(el) }, text)

/* ---------- wide layout ---------- */
{
  const page = await fresh(1400, 900)
  await page.waitForSelector('.ev')
  check('wide: week grid renders', (await page.$$('.ev')).length > 5)

  await clickText(page, '.topbar button', '+ New task')
  await page.waitForSelector('.modal')
  await setValue(page, '#taskTitle', 'Smoke test task')
  await setValue(page, '#taskStart', '16:00')
  await sleep(50)
  await clickText(page, '.modal .chip', '1h')
  await page.click('.modal button[type=submit]')
  await sleep(200)
  const created = await page.$$eval('.ev', (els) => els.find((e) => e.textContent.includes('Smoke test task'))?.getAttribute('title'))
  check('wide: create task with time and duration', created === '16:00–17:00 · Smoke test task', created)

  const evSel = await page.$$eval('.ev', (els) => { const i = els.findIndex((e) => e.textContent.includes('Smoke test task')); els[i].id = 'smoke-ev'; return '#smoke-ev' })
  await page.click(`${evSel} .cb`)
  await sleep(100)
  check('wide: tick a block done', await page.$eval(evSel, (e) => e.classList.contains('done')))
  await page.click(`${evSel} .cb`)

  const box = await (await page.$(evSel)).boundingBox()
  await page.mouse.move(box.x + 30, box.y + 8)
  await page.mouse.down()
  await page.mouse.move(box.x + 30, box.y + 40, { steps: 4 })
  await page.mouse.move(box.x + 30, box.y + 8 + 56, { steps: 4 })
  await page.mouse.up()
  await sleep(200)
  const moved = await page.$$eval('.ev', (els) => els.find((e) => e.textContent.includes('Smoke test task'))?.getAttribute('title'))
  check('wide: drag block one hour later', moved === '17:00–18:00 · Smoke test task', moved)

  const box2 = await (await page.$$eval('.ev', (els) => { const e = els.find((x) => x.textContent.includes('Smoke test task')); e.id = 'smoke-ev'; return true }), page.$('#smoke-ev')).then((h) => h.boundingBox())
  await page.mouse.move(box2.x + 30, box2.y + box2.height - 3)
  await page.mouse.down()
  await page.mouse.move(box2.x + 30, box2.y + box2.height - 3 + 28, { steps: 4 })
  await page.mouse.up()
  await sleep(200)
  const resized = await page.$$eval('.ev', (els) => els.find((e) => e.textContent.includes('Smoke test task'))?.getAttribute('title'))
  check('wide: resize block by 30 min', resized === '17:00–18:30 · Smoke test task', resized)

  await page.$$eval('.ev', (els) => els.find((e) => e.textContent.includes('Smoke test task')).click())
  await sleep(150)
  check('wide: click opens edit sheet', (await page.$eval('#taskTitle', (e) => e.value)) === 'Smoke test task')
  await page.keyboard.press('Escape')
  await sleep(100)

  await page.click('.icon[aria-label=Search]')
  await setValue(page, '#search', 'Smoke')
  await sleep(100)
  check('wide: search filters blocks', (await page.$$('.ev')).length === 1)
  await setValue(page, '#search', '')
  await page.keyboard.press('Escape')

  await clickText(page, '.sseg.top button', 'Month')
  await sleep(150)
  check('wide: month view', (await page.$$('.mg-c')).length >= 28)
  await clickText(page, '.sseg.top button', 'Stats')
  await sleep(150)
  check('wide: stats view', Boolean(await page.$('.stats.wide .kpi')))
  await clickText(page, '.stats .sseg button', 'October')
  await sleep(100)
  check('wide: month heatmap', (await page.$$('.cal .hc')).length >= 28)
  await page.click('.avatar')
  await sleep(150)
  check('wide: settings view', Boolean(await page.$('.settings .sw2')))

  await page.keyboard.press('w')
  await sleep(100)
  await page.keyboard.press('n')
  await sleep(150)
  check('wide: N opens a new task', Boolean(await page.$('.modal')))
  await page.click('.modal button[type=submit]')
  await sleep(100)
  check('wide: empty title is refused', Boolean(await page.$('.modal .err')))
  await page.keyboard.press('Escape')

  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(300)
  check('wide: demo data survives reload', await page.$$eval('.ev', (els) => els.some((e) => e.textContent.includes('Smoke test task'))))
  await page.close()
}

/* ---------- phone layout ---------- */
{
  const page = await fresh(390, 844)
  await page.waitForSelector('.m-app .row')

  // a task to do every day
  await setValue(page, '#quickAdd', '')
  await page.click('.add .ink') // empty quick add opens the full sheet
  await page.waitForSelector('.modal')
  await setValue(page, '#taskTitle', 'Drink water')
  await setValue(page, '#taskStart', '08:00')
  await sleep(50)
  await clickText(page, '.modal .chip', 'Every day')
  await page.click('.modal button[type=submit]')
  await sleep(200)
  const rowText = () => page.$$eval('.row', (els) => els.find((e) => e.textContent.includes('Drink water'))?.textContent ?? '')
  check('repeat: daily task shows today with its rule', (await rowText()).includes('Every day'))
  await page.$$eval('.wd', (els) => els[els.findIndex((e) => e.classList.contains('sel')) + 1]?.click())
  await sleep(200)
  check('repeat: it is already there tomorrow', (await rowText()).includes('Drink water'))
  await page.$$eval('.row', (els) => els.find((e) => e.textContent.includes('Drink water')).querySelector('.rb').click())
  await page.waitForSelector('.modal')
  await clickText(page, '.modal .text', 'Delete')
  await clickText(page, '.modal .soft', 'Skip this day')
  await sleep(200)
  check('repeat: skip removes only that day', (await rowText()) === '')
  await page.$$eval('.wd', (els) => els[els.findIndex((e) => e.classList.contains('sel')) + 1]?.click())
  await sleep(200)
  check('repeat: the day after is still there', (await rowText()).includes('Drink water'))
  await page.$$eval('.row', (els) => els.find((e) => e.textContent.includes('Drink water')).querySelector('.rb').click())
  await page.waitForSelector('.modal')
  await clickText(page, '.modal .text', 'Delete')
  await clickText(page, '.modal .soft', 'Stop repeating')
  await sleep(200)
  await page.$$eval('.wd', (els) => els[els.findIndex((e) => e.classList.contains('sel')) + 1]?.click())
  await sleep(200)
  check('repeat: stop repeating clears the days after', (await rowText()) === '')
  await clickText(page, '.tabs .tab', 'Today')
  await sleep(150)
  check('repeat: earlier days stay as history', (await rowText()).includes('Drink water'))
  check('repeat: demo streak is shown', await page.$$eval('.row', (els) => els.some((e) => /\d+-day streak/.test(e.textContent))))
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check('phone: no horizontal overflow', overflow <= 0, `${overflow}px`)

  await setValue(page, '#quickAdd', 'Phone quick task')
  await page.click('.add .ink')
  await sleep(150)
  check('phone: quick add lands in Inbox', await page.$$eval('.row', (els) => els.some((e) => e.textContent.includes('Phone quick task'))))

  await page.$$eval('.row', (els) => els.find((e) => e.textContent.includes('Phone quick task')).querySelector('.cb').click())
  await sleep(150)
  check('phone: tick a task', await page.$$eval('.row', (els) => els.find((e) => e.textContent.includes('Phone quick task')).classList.contains('done')))

  const before = await page.$eval('.hd h1', (e) => e.textContent)
  await page.$$eval('.wd', (els) => els[els.length - 1].click())
  await sleep(150)
  const after = await page.$eval('.hd h1', (e) => e.textContent)
  check('phone: switch day from the week strip', before !== after, `${before} → ${after}`)

  for (const tab of ['Week', 'Stats', 'Settings']) {
    await clickText(page, '.tabs .tab', tab)
    await sleep(150)
  }
  check('phone: tabs render', Boolean(await page.$('.settings')))
  await clickText(page, '.tabs .tab', 'Week')
  await sleep(100)
  await clickText(page, '.sseg button', 'Groups')
  await sleep(100)
  await setValue(page, '#newGroup', 'Side projects')
  await page.click('.groups .add .ink')
  await sleep(100)
  check('phone: add a group', await page.$$eval('.gname', (els) => els.some((e) => e.textContent === 'Side projects' || e.value === 'Side projects')))
  await page.close()
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
process.exit(results.every((r) => r.ok) ? 0 : 1)
