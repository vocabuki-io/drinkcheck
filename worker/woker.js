export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    try {
      const body = await request.json();
      const { date, staff, checker, items, memo, allItems, categories, suppliers } = body;

      if (!date || !staff || !items) {
        return json({ error: 'Missing required fields' }, 400);
      }

      const results = { discord: null, line: null };

      // Discord: full inventory grouped by supplier
      if (env.DISCORD_WEBHOOK_URL) {
        const discordMsg = buildDiscordMessage(date, staff, checker, items, memo, allItems, categories, suppliers);
        const res = await fetch(env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: discordMsg })
        });
        results.discord = res.ok ? 'ok' : 'error';
      }

      // LINE: shortages only
      if (env.LINE_CHANNEL_TOKEN && env.LINE_TARGET_ID) {
        const lineMsg = buildLineMessage(date, staff, checker, items, memo, allItems);
        const res = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + env.LINE_CHANNEL_TOKEN
          },
          body: JSON.stringify({
            to: env.LINE_TARGET_ID,
            messages: [{ type: 'text', text: lineMsg }]
          })
        });
        results.line = res.ok ? 'ok' : 'error';
      }

      return json({ ok: true, results }, 200);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders()
    }
  });
}

function buildDiscordMessage(date, staff, checker, checkedItems, memo, allItems, categories, suppliers) {
  let msg = '';
  msg += '\uD83D\uDCCB **\u5728\u5EAB\u30C1\u30A7\u30C3\u30AF\u5B8C\u4E86**\n';
  msg += '\u65E5\u4ED8: ' + date + '\n';
  msg += '\u62C5\u5F53: ' + staff + '\n';
  msg += '\u30C0\u30D6\u30EB\u30C1\u30A7\u30C3\u30AF: ' + checker + '\n\n';

  // Group by supplier
  const supplierGroups = {};
  for (const item of allItems) {
    const sid = item.supplier || 'other';
    if (!supplierGroups[sid]) supplierGroups[sid] = [];
    supplierGroups[sid].push(item);
  }

  const supplierNames = {};
  if (suppliers) {
    for (const s of suppliers) {
      supplierNames[s.id] = s.name;
    }
  }

  for (const sid of Object.keys(supplierGroups)) {
    const sname = supplierNames[sid] || sid;
    msg += '**\u3010' + sname + '\u3011**\n';
    for (const item of supplierGroups[sid]) {
      const v = checkedItems[item.id];
      if (!v) continue;
      const u1 = (item.units && item.units[0]) ? item.units[0] : '\u958B\u5C01';
      const u2 = (item.units && item.units[1]) ? item.units[1] : '\u672A\u958B\u5C01';
      msg += '\u30FB' + item.name + ': ' + u1 + v.opened + ' / ' + u2 + v.unopened + '\n';
    }
    msg += '\n';
  }

  if (memo) {
    msg += '\uD83D\uDCDD \u30E1\u30E2: ' + memo + '\n';
  }

  return msg;
}

function buildLineMessage(date, staff, checker, checkedItems, memo, allItems) {
  let msg = '';
  msg += '\uD83D\uDCCB \u5728\u5EAB\u30C1\u30A7\u30C3\u30AF\u5B8C\u4E86\n';
  msg += '\u65E5\u4ED8: ' + date + '\n';
  msg += '\u62C5\u5F53: ' + staff + '\n';
  msg += '\u30C0\u30D6\u30EB\u30C1\u30A7\u30C3\u30AF: ' + checker + '\n\n';

  // Find shortages
  const shortages = [];
  for (const item of allItems) {
    const v = checkedItems[item.id];
    if (!v) continue;
    const total = v.opened + v.unopened;
    if (total < item.parLevel) {
      const u1 = (item.units && item.units[0]) ? item.units[0] : '\u958B\u5C01';
      const u2 = (item.units && item.units[1]) ? item.units[1] : '\u672A\u958B\u5C01';
      shortages.push(
        '\u30FB' + item.name + '\uFF08' + u1 + v.opened + '/' + u2 + v.unopened + '\uFF09\u57FA\u6E96' + item.parLevel
      );
    }
  }

  if (shortages.length > 0) {
    msg += '\u26A0\uFE0F \u6B20\u54C1:\n' + shortages.join('\n') + '\n';
  } else {
    msg += '\u2705 \u6B20\u54C1\u306A\u3057\n';
  }

  if (memo) {
    msg += '\n\uD83D\uDCDD \u30E1\u30E2: ' + memo;
  }

  return msg;
}
