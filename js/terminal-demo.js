/**
 * RPCortex — Hero terminal animation for the landing page.
 * Plays three looping demo scenes in the #term-body element.
 */
(function () {
  'use strict';

  var body = document.getElementById('term-body');
  if (!body) return;

  var PROMPT = 'root@nebula:~';

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderText(text) {
    if (!text) return '&nbsp;';
    if (text.startsWith('[@]')) return '<span class="ok">[@]</span>' + esc(text.slice(3));
    if (text.startsWith('[:]')) return '<span class="info">[:]</span>' + esc(text.slice(3));
    if (text.startsWith('[?]')) return '<span class="twarn">[?]</span>' + esc(text.slice(3));
    var ri = text.indexOf('root@nebula');
    if (ri !== -1) {
      return esc(text.slice(0, ri)) +
        '<span style="color:var(--text);font-weight:700">root@nebula</span>' +
        esc(text.slice(ri + 10));
    }
    return esc(text);
  }

  function addLine(html) {
    var div = document.createElement('div');
    div.className = 'term-line out';
    div.innerHTML = html;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  async function typeCmd(promptLine, text) {
    var cmdEl = document.createElement('span');
    var curEl = document.createElement('span');
    curEl.className = 'cursor';
    curEl.textContent = '\u2588';
    promptLine.appendChild(cmdEl);
    promptLine.appendChild(curEl);
    for (var i = 0; i < text.length; i++) {
      cmdEl.textContent += text[i];
      body.scrollTop = body.scrollHeight;
      await sleep(42 + Math.random() * 38);
    }
    await sleep(160);
    curEl.remove();
  }

  var SCENES = [
    /* ── Scene 1: wifi connect ── */
    [
      { cmd: 'wifi connect Example', outputs: [
        { t: '' },
        { t: 'Password (blank for open network) \u00b7\u00b7> \u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7', w: 340 },
        { t: "[:] Connecting to 'Example'...", w: 460 },
        { t: '[:] \u00a0 still connecting...', w: 1350 },
        { t: '[@] Connected!  IP: 192.168.1.42  Gateway: 192.168.1.1', w: 950 },
      ]}
    ],
    /* ── Scene 2: pkg update + install ── */
    [
      { cmd: 'pkg update', outputs: [
        { t: '' },
        { t: '[:] [1/1] Fetching: raw.githubusercontent.com...', w: 280 },
        { t: '[@] \u00a0 Cached 292 bytes from repo 0.', w: 520 },
        { t: '[@] Update complete. 1/1 repo(s) refreshed.', w: 140 },
      ]},
      { cmd: 'pkg install HelloWorld', pre: 700, outputs: [
        { t: '' },
        { t: "[:] Found 'HelloWorld'. Downloading...", w: 180 },
        { t: '[:] Connecting to raw.githubusercontent.com:443...', w: 480 },
        { t: '[:] HTTP 200', w: 200 },
        { t: '[@] Downloaded 907 bytes. Installing...', w: 340 },
        { t: "[@] Package 'HelloWorld' v1.0.1 installed.", w: 180 },
      ]}
    ],
    /* ── Scene 3: fetch (Pico 2 W) ── */
    [
      { cmd: 'fetch', outputs: [
        { t: '' },
        { t: '' },
        { t: '      :::::::::  :::::::::   ::::::::    ', w: 40 },
        { t: '     :+:    :+: :+:    :+: :+:    :+:    root@nebula', w: 40 },
        { t: '    +:+    +:+ +:+    +:+ +:+            \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500', w: 40 },
        { t: '   +#++:++#:  +#++:++#+  +#+                   OS : RPCortex v0.8.1-beta4 (rp2)', w: 40 },
        { t: '  +#+    +#+ +#+        +#+                 Board : Raspberry Pi Pico 2 W', w: 40 },
        { t: ' #+#    #+# #+#        #+#    #+#             CPU : RP2350', w: 40 },
        { t: '###    ### ###         ########              Freq : 150 MHz', w: 40 },
        { t: '                                          Runtime : MicroPython 1.27.0', w: 40 },
        { t: '                                              RAM : 284 KB used / 520 KB total  (54%)', w: 40 },
        { t: '                                            Flash : 1.8 MB used / 14336 KB total', w: 40 },
        { t: '                                             Temp : 27.4 \u00b0C  (onboard)', w: 40 },
        { t: '                                           Uptime : 3m 47s', w: 40 },
        { t: '                                             WiFi : Connected  (192.168.1.42)', w: 40 },
        { t: '                                              UID : e6:63:b0:02:a3:c5:d4:1c', w: 40 },
        { t: '                                            Shell : Launchpad  (RPCortex Nebula)', w: 40 },
        { t: '' },
      ]}
    ],
  ];

  async function runScene(scene) {
    body.innerHTML = '';
    body.style.opacity = '1';

    for (var ci = 0; ci < scene.length; ci++) {
      var cmd = scene[ci];
      if (cmd.pre) await sleep(cmd.pre);

      var promptLine = document.createElement('div');
      promptLine.className = 'term-line';
      var promptEl = document.createElement('span');
      promptEl.className = 'prompt';
      promptEl.textContent = PROMPT + '> ';
      promptLine.appendChild(promptEl);
      body.appendChild(promptLine);
      body.scrollTop = body.scrollHeight;

      await sleep(480 + Math.random() * 220);
      await typeCmd(promptLine, cmd.cmd);

      for (var oi = 0; oi < cmd.outputs.length; oi++) {
        var out = cmd.outputs[oi];
        await sleep(out.w !== undefined ? out.w : 110);
        addLine(renderText(out.t));
      }
    }

    var finalLine = document.createElement('div');
    finalLine.className = 'term-line';
    finalLine.innerHTML = '<span class="prompt">' + esc(PROMPT) + '&gt;</span><span class="cursor">\u2588</span>';
    body.appendChild(finalLine);
    body.scrollTop = body.scrollHeight;

    await sleep(2800);

    body.style.transition = 'opacity 0.55s';
    body.style.opacity = '0';
    await sleep(660);
    body.style.transition = '';
  }

  async function run() {
    await sleep(500);
    var i = 0;
    while (true) {
      await runScene(SCENES[i % SCENES.length]);
      i++;
    }
  }

  run();
})();
