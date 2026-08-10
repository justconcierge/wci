import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const timeZone = 'America/New_York';
const rooms = ['The Dome Room', 'The Garden Room', 'The Aviary Room', 'The Opulent Room', 'The Asian Room', 'The Angel Room', 'The Blue Room', 'The Rose Suite'];
const dateParts = (offset = 0) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(Date.now() + offset * 86400000));
  const value = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};
const displayDate = value => new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'short', day: 'numeric' })
  .format(new Date(`${value}T12:00:00-04:00`)).replace('Aug ', 'Aug. ');
const shortDate = value => new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' })
  .format(new Date(`${value}T12:00:00-04:00`)).replace('Aug ', 'Aug. ');

const browser = await chromium.launch({ headless: true });
try {
  const surflight = await browser.newPage();
  await surflight.goto('https://surflight.org/musicals-and-plays', { waitUntil: 'domcontentloaded' });
  const eventText = await surflight.locator('.eventlist-event').allTextContents();
  const events = {};
  for (const raw of eventText) {
    const text = raw.replace(/\u202f/g, ' ').replace(/\s+/g, ' ').trim();
    const title = text.split(/(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),/)[0].trim();
    const match = text.match(/(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4}).*?(\d{1,2}:\d{2}\s*[AP]M)/);
    if (!title || !match) continue;
    const month = String(new Date(`${match[1]} 1, ${match[3]}`).getMonth() + 1).padStart(2, '0');
    const date = `${match[3]}-${month}-${match[2].padStart(2, '0')}`;
    (events[date] ||= []).push(`${title} · ${match[4].replace(/\s+/g, ' ')}`);
  }

  const start = dateParts(1);
  const end = dateParts(15);
  const calendar = await browser.newPage();
  await calendar.goto(`https://secure.thinkreservations.com/williamscottageinn/reservations/availability?start_date=${start}&end_date=${end}&number_of_adults=2&number_of_children=0`, { waitUntil: 'domcontentloaded' });
  await calendar.waitForTimeout(1600);
  const lines = (await calendar.locator('body').innerText()).split('\n').map(line => line.trim()).filter(Boolean);
  const roomRows = {};
  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index];
    const from = lines.indexOf(room);
    if (from < 0) continue;
    const next = rooms.slice(index + 1).map(nextRoom => lines.indexOf(nextRoom)).filter(position => position > from)[0] || lines.length;
    roomRows[room] = lines.slice(from + 1, next).filter(line => line === 'Is available' || line === 'Not available');
  }
  let firstAvailable = -1;
  for (let day = 0; day < 15; day += 1) {
    if (rooms.some(room => roomRows[room]?.[day] === 'Is available')) { firstAvailable = day; break; }
  }
  const firstDate = firstAvailable >= 0 ? dateParts(firstAvailable + 1) : null;
  const availableRooms = firstAvailable >= 0 ? rooms.filter(room => roomRows[room]?.[firstAvailable] === 'Is available').map(room => room.replace(/^The /, '')) : [];
  const availability = firstDate ? {
    summary: `Next available stay · ${displayDate(firstDate)} · ${availableRooms.join(' · ')}`,
    title: 'Plan your next stay',
    detail: `Rooms shown are available for arrival on ${shortDate(firstDate)}.`,
    href: `https://secure.thinkreservations.com/williamscottageinn/reservations/availability?start_date=${firstDate}&end_date=${dateParts(firstAvailable + 2)}&number_of_adults=2&number_of_children=0`
  } : {
    summary: 'See the current booking calendar for availability.',
    title: 'Plan your next stay',
    detail: 'Availability changes quickly.',
    href: 'https://secure.thinkreservations.com/williamscottageinn/reservations'
  };
  await writeFile('daily-concierge.json', `${JSON.stringify({ updated: dateParts(), events, availability }, null, 2)}\n`);
} finally {
  await browser.close();
}
